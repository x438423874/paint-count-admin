# OCR 部位自动选择 —— 优化方案

> 目标：在现有 OCR 建单链路上，把"图片上的部位文字"更准确地自动映射到系统部位（`PaintItemCategory`），
> 降低人工核对成本，并让系统从历史校正中持续学习。
>
> 适用范围：后端 `api/paint` 的 OCR 链路（`llm-ocr.service.ts` / `ocr.service.ts` / `pending-image.service.ts`）
> 以及前端 `work-order-operate-drawer.vue` 的部位选择交互。

---

## 一、结论

**能做，但现状链路有硬伤：匹配环节零容错，而且历史数据目前"学不了"（缺埋点）。**

建议落地路径：用确定性规则（归一化 + 多级字典 + 模糊匹配）吃掉 80% 的常规 case，
把 LLM 从"唯一依靠"降级为"兜底 + 发现新别名"。再补一条"人工校正 → 回写沉淀"的闭环，
让系统越用越准。

---

## 二、现状诊断：为什么现在部位匹配率低

当前是「LLM 猜 + 后端精确查表」两段式，中间**没有任何缓冲**。

`ocr.service.ts` 的匹配核心：

```ts
return llmItems.map(item => {
  const matchedName = item.matchedName || '';
  const categoryId = nameToId[matchedName] || '';   // 纯字典精确查表
  return {
    categoryId: categoryId || undefined,
    matchedName,
    rawText: item.rawText || '',
    quantity: Number(item.quantity) || 1,
    newPartQuantity: Number(item.newPartQuantity) || 0,
    matched: !!categoryId,
  };
});
```

`nameToId[matchedName]` 是**纯字典精确查表**。大模型只要多返回一个"喷"字、带个空格、
用了口语（"前保险杠" vs 系统"前后杠"），就整条失配，`matched=false`，用户只能手工重选。

具体 6 个问题：

| # | 问题 | 位置 |
|---|---|---|
| 1 | 零容错精确匹配，差一个字就失配 | `ocr.service.ts` matchItemsToCategories |
| 2 | **Excel 链路已积累 60+ 条经验别名**（机盖=前头盖/引擎盖、叶子板=翼子板…），OCR 链路完全没用上 | `work-order-excel.service.ts` CATEGORY_NAME_ALIASES |
| 3 | `rawText` 在 prompt 里**没要求模型输出**，永远为空 → 失配后无法二次补救 | `llm-ocr.service.ts` 的 prompt 只要求 `matchedName/quantity/newPartQuantity` |
| 4 | 图片池固定用 `basic` 模式，**压根不识别部位** | `pending-image.service.ts`（recognizeWithTemplate(buffer, shopId, 'basic')） |
| 5 | 人工校正无回写：用户每次手改部位，系统零沉淀 | 全链路 |
| 6 | 无置信度：前端分不出"高置信"和"瞎猜"，只能全量核对 | `OcrItem` 只有布尔 `matched` |

---

## 三、数据盘点：系统里到底有什么能用的

| 数据 | 位置 | 可用度 |
|---|---|---|
| 部位主数据（name/code/sortOrder） | `paint_item_category` | ✅ 直接用 |
| 模板别名（**单值**） | `paint_standard_template_item.alias` | ⚠️ 稀疏，一个部位只有 1 个别名 |
| 门店标准别名 | `paint_standard.alias` | ⚠️ 同上 |
| **Excel 经验别名 60+ 条** | 硬编码 `CATEGORY_NAME_ALIASES` | ✅ 可直接复用到 OCR |
| 历史工单项 | `paint_work_order_item` | ❌ **只有 categoryId，没存原始文本** |
| OCR 快照 | `paint_pending_image.ocrRawJson` | ❌ 只存 basic，不含 items |
| 门店 OCR 配置 | `paint_shop.ocrConfig` | ✅ |

**关键结论（也是可行性核心）**：历史工单虽然量大，但 `PaintWorkOrderItem` 只存了 `categoryId`，
**没存"图片上原来写的什么"**——所以「从历史数据自动学习别名」这条路**现在是断的**，必须先加埋点才能学。

建议先跑摸底（确认数据量级与别名覆盖率）：

```sql
SELECT COUNT(*) AS 部位数          FROM paint_item_category;
SELECT COUNT(*) AS 有别名模板项    FROM paint_standard_template_item WHERE alias IS NOT NULL AND alias <> '';
SELECT COUNT(*) AS 历史工单项      FROM paint_work_order_item;
SELECT COUNT(*) AS OCR快照         FROM paint_pending_image WHERE ocr_raw_json IS NOT NULL;
```

---

## 四、方案：六层匹配 + 校正闭环

思路：**用确定性规则吃掉 80% 的 case，把 LLM 从"唯一依靠"降级为"兜底 + 发现新别名"。**

### L0 归一化（零成本，立刻见效）

对 LLM 返回的 `matchedName` 和字典 key 双侧做同一套清洗（**必须先于任何匹配**）：

- 去空白 / 全角空格、全角 → 半角、繁 → 简
- 去掉无意义词缀：`喷漆 / 喷 / 做漆 / 油漆 / 钣金 / 修复 / 翻新 / 部位 / 项` 等
- 统一括号：`（）→ ()`
- 数字统一：中文数字 → 阿拉伯

### L1 多级字典（精确命中，可解释）

按优先级查，命中即返回并记录 `matchLevel`（命中来源可解释，便于运营排查）：

1. 系统部位名（`paint_item_category.name`）
2. 部位编码（`code`）
3. 模板别名（`paint_standard_template_item.alias`）
4. 门店标准别名（`paint_standard.alias`）
5. **复用 Excel 的 `CATEGORY_NAME_ALIASES`**（抽成共享模块，两条链路统一维护）
6. 学习库别名（L5 沉淀，带命中计数，按门店维度）

### L2 模糊匹配（吃掉"差一个字"）

L1 未命中时启用，按门店维度做（不同店叫法差异大）：

- 双向包含：`前保险杠` ⊃ `前后杠`？用**最长公共子串 / 最长公共子序列**打分
- 编辑距离：短文本用 Levenshtein，阈值 ≤ 1（长度 ≤ 4）或 ≤ 2（更长）
- 首字 / 尾字锚定：`XX盖` → 强约束到所有以"盖"结尾的部位
- 打分：`score = 0.5 * LCS相似度 + 0.3 * (1 - 归一化编辑距离) + 0.2 * 首字命中`

**关键**：只在 L2 命中**唯一高分**时才自动采纳；若 top1 与 top2 分差 < 0.1，判为"歧义"，
交人工选（推 top3 候选）。

### L3 频次先验（消歧 + 兜底）

从 `paint_work_order_item` 统计各门店各部位的历史频次，用于：

- L2 歧义时，用频次给候选排序（同分时优先高频部位）
- 完全失配时，给前端推荐"该店最常用的 5 个部位"作为快捷选择

这个**不需要原始文本**，只用现有 `categoryId` 就能算。

### L4 LLM（保留并改进 prompt）

- prompt 要求模型**同时输出 `rawText`（图上原文）和 `confidence`**
- 把门店别名一起塞进候选列表（现在只塞了模板 alias，漏了 `paint_standard.alias`）
- 要求模型**只从列表里选**，禁止自由发挥（现在是"未匹配则 matchedName 为空"，模型经常瞎填）
- 保持 `temperature=0.1`，并延续现有的内容寻址缓存（sha256(buffer)+mode）

### L5 校正闭环（长期收益最大，也最依赖埋点）

用户每次手工改部位 = 一条高质量标注。落库 → 自动进学习库 → 命中 N 次后提升为正式别名。
这是让历史数据"可学习"的前提。

---

## 五、数据结构改动

新建一张学习表即可，**不动现有表结构**：

```prisma
model PaintOcrCategoryAlias {
  id           String   @id @default(cuid())
  shopId       String?  @map("shop_id")     // null = 全局别名
  rawText      String   @map("raw_text")    // 图片原文 / LLM 原始 matchedName
  categoryId   String   @map("category_id")
  source       String   @map("source")      // manual=人工校正 | llm=模型建议 | import=批量导入
  hitCount     Int      @default(1) @map("hit_count")
  confirmCount Int      @default(0) @map("confirm_count")  // 被人工采纳次数
  status       String   @default("pending") // pending=待确认 | active=生效 | rejected=已否决
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([shopId, rawText, categoryId])
  @@index([shopId, status])
  @@map("paint_ocr_category_alias")
}
```

配套在 `PaintWorkOrderItem` 加一个**可选**的溯源字段（这是让历史数据"可学习"的关键）：

```prisma
// 仅 OCR 建单时写入，用于沉淀「原文 → 部位」样本
sourceRawText String? @map("source_raw_text") @db.VarChar(100)
```

> `status` 的意义：人工校正（manual）直接 `active`；LLM 建议（llm）先 `pending`，
> 被人工确认 3 次才转 `active`，避免把模型的错误固化成脏数据。

---

## 六、接口与交互

### 后端（放在 `ocr.service.ts` 内，对外接口签名不变）

`OcrItem` 增加三个字段，`matched` 保留兼容：

```ts
confidence: number;        // 0~1
matchLevel: 'exact' | 'alias' | 'fuzzy' | 'llm' | 'none';
candidates?: { categoryId: string; name: string; score: number }[];  // 歧义时 top3
```

新增接口：

- `POST /paint/work-order/ocr-correction`：校正回写，body `{ shopId, rawText, fromCategoryId, toCategoryId }`
- `GET  /paint/standard/ocr-aliases`：别名库管理页（运营维护、批量导入、否决脏数据）

### 前端（`work-order-operate-drawer.vue` 的部位列）

- **高置信**（`exact` / `alias`，confidence ≥ 0.9）→ 正常显示，**不打扰**
- **中置信**（`fuzzy`）→ 选中 + 浅黄底 + tooltip「由『前保险杠』模糊匹配为『前后杠』，点击可改」
- **低置信 / 歧义**（`none` / `llm` + 多候选）→ 标红 + 展开 top3 快捷按钮，一键切换
- 右侧给「该店常用部位」快捷添加条（来自 L3 频次）

效果：用户从"每条都要选"变成"只审有问题的几条"。

---

## 七、落地步骤（建议分 4 期）

| 期 | 内容 | 成本 | 预期效果 |
|---|---|---|---|
| **P1** | L0 归一化 + L1 多级字典（含复用 Excel 别名）+ prompt 补 `rawText`/`confidence` | 小（1~2 天） | 匹配率明显提升，且**全程可解释、零风险** |
| **P2** | L2 模糊匹配 + 置信度分级 + 前端分级展示 | 中 | 吃掉"差一个字"，用户只需审少量条目 |
| **P3** | L3 频次先验 + 校正回写入库 + 别名管理页 | 中 | 开始积累样本 |
| **P4** | 学习库自动转正（pending→active）+ 图片池开启 items 模式 + 效果看板 | 中 | 越用越准，形成飞轮 |

**评估指标**：先录 100~200 张历史工单图做基线集，每期跑一遍看

- 自动采纳率（exact + alias 且人工未改）
- top1 准确率、top3 召回率
- 平均每条工单的人工干预次数（最终业务指标）

**灰度**：先在 1~2 家部位叫法最乱的门店开，跑稳再全量。

---

## 八、需要拍板的点

1. **别名归属**：`CATEGORY_NAME_ALIASES` 现在硬编码在 Excel 服务里。建议抽到共享模块
   （如 `paint-category-alias.ts`），OCR 和 Excel 两条链路共用；长期看**最好落库**（门店维度差异大，硬编码维护不动）。要不要直接落库？
2. **图片池是否开启部位识别**：现在 `basic` 模式是有意为之（省 token、图片池主要做图片归档）。
   开启会让 OCR 成本翻倍。建议只在"从图片池建单"时才补一次 items 识别。

---

## 附：改动涉及的关键文件清单

| 文件 | 改动类型 |
|---|---|
| `apps/base-system/src/api/paint/service/llm-ocr.service.ts` | 改 prompt（补 rawText / confidence / 候选别名） |
| `apps/base-system/src/api/paint/service/ocr.service.ts` | 重写 matchItemsToCategories，加归一化 / 多级字典 / 模糊匹配 / 频次先验 |
| `apps/base-system/src/api/paint/service/work-order-excel.service.ts` | 别名字典抽共享模块 |
| `apps/base-system/src/api/paint/pending-image/service/pending-image.service.ts` | 建单时补 items 识别 |
| `apps/base-system/src/api/paint/work-order/rest/work-order.controller.ts` | 新增 ocr-correction 接口 |
| `frontend/src/views/paint/work-order/modules/work-order-operate-drawer.vue` | 部位列置信度分级交互 |
| `backend/prisma/schema.prisma` | 新增 PaintOcrCategoryAlias + PaintWorkOrderItem.sourceRawText |
| `backend/docs/ocr-category-matching-plan.md` | 本文档 |
