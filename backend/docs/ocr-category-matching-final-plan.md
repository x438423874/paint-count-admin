# OCR 部位自动选择 —— 最终落地方案

> 本文是在 `ocr-category-matching-plan.md`（六层匹配方案）基础上，
> 合并评审意见后的**最终执行版本**。
>
> 相比原方案唯一的实质调整：L4 的 prompt 从"要求模型只从列表里选（返回名字）"
> 强化为"**封闭集编号选择**（返回候选编号）"，从源头杜绝模型自由发挥。
> 其余六层匹配、数据结构、分期计划均沿用原方案。

---

## 一、目标

在现有 OCR 建单链路上，把"图片上的部位文字"更准确地自动映射到系统部位（`PaintItemCategory`），
降低人工核对成本，并让系统从历史校正中持续学习（越用越准）。

---

## 二、现状问题（诊断结论）

当前链路是「LLM 猜 + 后端精确查表」两段式，中间无任何缓冲：

| # | 问题 | 位置 |
|---|---|---|
| 1 | 零容错精确匹配（`nameToId[matchedName]`），差一个字就失配 | `ocr.service.ts` matchItemsToCategories |
| 2 | Excel 链路已积累 60+ 条经验别名（机盖=前头盖/引擎盖…），OCR 链路没用上 | `work-order-excel.service.ts` `CATEGORY_NAME_ALIASES` |
| 3 | prompt 没要求模型输出 `rawText`，该字段永远为空 → 失配后无法二次补救 | `llm-ocr.service.ts` |
| 4 | 图片池固定 `basic` 模式，压根不识别部位 | `pending-image.service.ts` |
| 5 | 人工校正无回写，用户每次手改部位系统零沉淀 | 全链路 |
| 6 | 无置信度，前端分不出"高置信"和"瞎猜"，只能全量核对 | `OcrItem` 只有布尔 `matched` |

关键盲点：`PaintWorkOrderItem` 只存了 `categoryId`、没存"图片上原来写的什么"，
**「从历史数据自动学习别名」这条路目前是断的**，必须先加溯源埋点。

---

## 三、数据盘点

| 数据 | 位置 | 可用度 |
|---|---|---|
| 部位主数据（name/code/sortOrder） | `paint_item_category` | ✅ 直接用 |
| 模板别名（单值） | `paint_standard_template_item.alias` | ⚠️ 稀疏，一个部位只有 1 个别名 |
| 门店标准别名 | `paint_standard.alias` | ⚠️ 同上 |
| Excel 经验别名 60+ 条 | 硬编码 `CATEGORY_NAME_ALIASES` | ✅ 可直接复用到 OCR |
| 历史工单项 | `paint_work_order_item` | ❌ 只有 categoryId，没存原文 |
| OCR 快照 | `paint_pending_image.ocrRawJson` | ❌ 只存 basic，不含 items |
| 门店 OCR 配置 | `paint_shop.ocrConfig` | ✅ |

---

## 四、方案：六层匹配 + 校正闭环

思路：**用确定性规则吃掉 80% 的 case，把 LLM 从"唯一依靠"降级为"兜底 + 发现新别名"。**

### L0 归一化（零成本，立刻见效）

对 LLM 返回的 `matchedName` 和字典 key 双侧做同一套清洗（必须先于任何匹配）：

- 去空白 / 全角空格、全角 → 半角、繁 → 简
- 去无意义词缀：`喷漆 / 喷 / 做漆 / 油漆 / 钣金 / 修复 / 翻新 / 部位 / 项` 等
- 统一括号：`（）→ ()`
- 中文数字 → 阿拉伯数字

### L1 多级字典（精确命中，可解释）

按优先级查，命中即返回并记录 `matchLevel`：

1. 系统部位名（`paint_item_category.name`）
2. 部位编码（`code`）
3. 模板别名（`paint_standard_template_item.alias`）
4. 门店标准别名（`paint_standard.alias`）
5. **复用 Excel 的 `CATEGORY_NAME_ALIASES`**（抽成共享模块 `paint-category-alias.ts`，两条链路统一维护）
6. 学习库别名（L5 沉淀，带命中计数，按门店维度）

### L2 模糊匹配（吃掉"差一个字"）

L1 未命中时启用，按门店维度做：

- 双向包含：用最长公共子串 / 最长公共子序列打分
- 编辑距离：短文本用 Levenshtein，阈值 ≤ 1（长度 ≤ 4）或 ≤ 2（更长）
- 首字 / 尾字锚定：`XX盖` → 强约束到以"盖"结尾的部位
- 打分：`score = 0.5 * LCS相似度 + 0.3 * (1 - 归一化编辑距离) + 0.2 * 首字命中`

**关键**：只在 L2 命中**唯一高分**时自动采纳；top1 与 top2 分差 < 0.1 判为"歧义"，
交人工选（推 top3 候选）。

### L3 频次先验（消歧 + 兜底）

从 `paint_work_order_item` 统计各门店各部位历史频次：

- L2 歧义时，用频次给候选排序（同分优先高频部位）
- 完全失配时，给前端推荐"该店最常用的 5 个部位"作为快捷选择

不需要原始文本，只用现有 `categoryId` 就能算。

### L4 LLM（保留并强化 prompt：封闭集编号选择）

- **候选编号化**：把门店部位候选列表（name + code + alias）带编号注入 prompt，
  要求模型返回 `categoryIndex`（列表编号）+ `rawText`（图上原文）+ `confidence`，
  **禁止自由输出部位名**。后端按编号反查 `categoryId`，从根本上杜绝"多一个字/口语化"导致的失配。
  - 编号在两次调用间不稳定的问题：编号解析失败时回退用返回的名字走 L0-L2 匹配，安全兜底。
- 候选列表补齐 `paint_standard.alias`（现在只塞了模板 alias）
- 保持 `temperature=0.1`，延续现有内容寻址缓存（sha256(buffer)+mode）

### L5 校正闭环（长期收益最大）

用户每次手工改部位 = 一条高质量标注。落库 → 自动进学习库 → 命中 N 次后提升为正式别名。

---

## 五、数据结构改动

新建一张学习表，**不动现有表结构**：

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

`PaintWorkOrderItem` 加一个**可选**溯源字段（让历史数据"可学习"的关键）：

```prisma
// 仅 OCR 建单时写入，用于沉淀「原文 → 部位」样本
sourceRawText String? @map("source_raw_text") @db.VarChar(100)
```

> `status` 逻辑：人工校正（manual）直接 `active`；LLM 建议（llm）先 `pending`，
> 被人工确认 3 次才转 `active`，避免把模型的错误固化成脏数据。

---

## 六、接口与交互

### 后端（放在 `ocr.service.ts` 内，对外接口签名不变）

`OcrItem` 增加字段，`matched` 保留兼容：

```ts
confidence: number;        // 0~1
matchLevel: 'exact' | 'alias' | 'fuzzy' | 'llm' | 'none';
candidates?: { categoryId: string; name: string; score: number }[];  // 歧义时 top3
```

新增接口：

- `POST /paint/work-order/ocr-correction`：校正回写，body `{ shopId, rawText, fromCategoryId, toCategoryId }`
- `GET  /paint/standard/ocr-aliases`：别名库管理接口（运营维护、批量导入、否决脏数据）

### 前端（`work-order-operate-drawer.vue` 部位列）

- 高置信（exact/alias + confidence ≥ 0.9）：正常展示，不打扰
- 中置信（fuzzy）：选中 + 浅黄底 + tooltip「由『前保险杠』模糊匹配为『前后杠』，点击可改」
- 低置信 / 歧义（none / 多候选）：标红 + 展开 top3 快捷按钮，一键切换
- 右侧给「该店常用部位」快捷添加条（来自 L3 频次）

效果：用户从"每条都要选"变成"只审有问题的几条"。

---

## 七、落地步骤（4 期）

| 期 | 内容 | 成本 | 预期效果 |
|---|---|---|---|
| **P1** | L0 归一化 + L1 多级字典（含复用 Excel 别名）+ prompt 补 `rawText`/`confidence`/编号选择 | 小 | 匹配率明显提升，全程可解释、零风险 |
| **P2** | L2 模糊匹配 + 置信度分级 + 前端分级展示 | 中 | 吃掉"差一个字"，用户只需审少量条目 |
| **P3** | L3 频次先验 + 校正回写入库 + 别名管理页 | 中 | 开始积累样本 |
| **P4** | 学习库自动转正（pending→active）+ 图片池建单补 items 识别 + 效果看板 | 中 | 越用越准，形成飞轮 |

**评估指标**：先录 100~200 张历史工单图做基线集，每期跑一遍看：

- 自动采纳率（exact + alias 且人工未改）
- top1 准确率、top3 召回率
- 平均每条工单的人工干预次数（最终业务指标）

**灰度**：先在 1~2 家部位叫法最乱的门店开，跑稳再全量。

---

## 八、待拍板项

1. **别名归属**：`CATEGORY_NAME_ALIASES` 建议抽到共享模块 `paint-category-alias.ts`（OCR/Excel 共用）；
   长期最好落库（门店维度差异大，硬编码维护不动）。是否直接落库？
2. **图片池是否开启部位识别**：现在 `basic` 是有意为之（省 token）。建议只在"从图片池建单"时补一次 items 识别（P4 做）。是否接受该成本？

---

## 附：改动涉及的关键文件清单

| 文件 | 改动类型 |
|---|---|
| `apps/base-system/src/api/paint/service/llm-ocr.service.ts` | 改 prompt（编号选择 + rawText / confidence / 候选别名补齐） |
| `apps/base-system/src/api/paint/service/ocr.service.ts` | 重写 matchItemsToCategories：归一化 / 多级字典 / 模糊匹配 / 频次先验 |
| `apps/base-system/src/api/paint/service/work-order-excel.service.ts` | 别名字典抽共享模块 |
| `apps/base-system/src/api/paint/pending-image/service/pending-image.service.ts` | 建单时补 items 识别（P4） |
| `apps/base-system/src/api/paint/work-order/rest/work-order.controller.ts` | 新增 ocr-correction 接口 |
| `frontend/src/views/paint/work-order/modules/work-order-operate-drawer.vue` | 部位列置信度分级交互 |
| `backend/prisma/schema.prisma` | 新增 PaintOcrCategoryAlias + PaintWorkOrderItem.sourceRawText |
| `backend/docs/ocr-category-matching-final-plan.md` | 本文档 |
