# OCR 部位自动选择 —— 实施方案 v3

> **本文档取代** `ocr-category-matching-plan.md`（v1）与 `ocr-category-matching-final-plan.md`（v2）。
>
> v3 是在 v1/v2 基础上**回到代码逐行核实**后重写的执行版。诊断结论与六层匹配主体思路沿用，
> 但修正了 v1/v2 中 6 处与实现不符的地方（见文末「附录 A：相对 v1/v2 的修正」），
> 其中 3 处会导致上线后出 bug，请以此版为准。

---

## 一、目标与非目标

**目标**

1. 把「图片上的部位文字」准确映射到系统部位（`PaintItemCategory`），提升自动采纳率。
2. 失配不再静默丢失，而是以「待确认」形式暴露给用户。
3. 人工校正能沉淀为别名，系统越用越准。

**非目标**

- 不改 `quantity`（幅数）/ `newPartQuantity`（新件数）的识别逻辑。
- 不做车型/车牌/工单号的识别优化（已有独立规则链路）。
- 不引入向量模型 / 语义匹配（中文部位词短，字面相似度足够，先不上重方案）。

---

## 二、现状诊断

链路：`llmOcr.recognize()`（LLM 输出）→ `ocrService.matchItemsToCategories()`（精确查表）→ `controller`（过滤）→ `workOrderService.quickCreate()`。

### 2.1 六个问题（按严重度排序）

| # | 问题 | 位置 | 严重度 |
|---|---|---|---|
| **P0** | **失配项被静默丢弃**，用户完全感知不到「有一项没识别出来」 | `work-order.controller.ts:123-125` | 🔴 最高 |
| **P1** | 零容错精确匹配 `nameToId[matchedName]`，差一个字就失配 | `ocr.service.ts:213-224` | 🔴 高 |
| **P2** | 5 类别名来源中有 3 类 OCR **完全没用**（详见 2.3） | `ocr.service.ts:177-211` | 🟠 中高 |
| **P3** | `rawText` 在 prompt 里没要求输出，**item 级 rawText 永远是空串**，失配后无法补救 | `llm-ocr.service.ts:109/122`（prompt 无 rawText 字段） | 🟠 中高 |
| **P4** | 三个 OCR 入口默认 `basic`，**默认不识别部位** | controller `:89` / `:320`，`pending-image.service.ts:97` | 🟡 中 |
| **P5** | 人工校正零沉淀，且无置信度概念，前端只能全量核对 | 全链路 | 🟡 中 |

#### P0 详解（v1/v2 均未发现，用户体感最强的 bug）

```123:125:backend/apps/base-system/src/api/paint/work-order/rest/work-order.controller.ts
        ocrItems = (ocrResult.items || [])
          .filter(it => it.matched && it.categoryId)
          .map(it => ({ categoryId: it.categoryId!, quantity: it.quantity, newPartQuantity: it.newPartQuantity }));
```

`filter(it => it.matched && it.categoryId)` 把未匹配的项**直接丢掉**。
用户看到的是「部位少了几条」而不是「这条没识别出来，请确认」——比提示用户选更糟，
也是「每次都要手工重选」抱怨的主要来源。**本方案必须一并修掉。**

#### P4 详解

| 入口 | 默认 mode | 是否识别部位 |
|---|---|---|
| `POST /quick-create`（单张快速建单） | `basic` | ❌ |
| `POST /ocr-recognize`（独立识别接口） | `basic` | ❌ |
| `POST /batch-ocr-preview`（批量预览） | `all` | ✅ |
| 图片池上传 | 硬编码 `basic` | ❌ |

### 2.2 关键盲点：历史数据「学不了」

`PaintWorkOrderItem` 只有 `categoryId`，**没存「图片上原来写的什么」**（schema `:445-461`）。
所以「从历史工单自动挖掘别名」这条路现在是断的，必须先加溯源埋点才能学。

### 2.3 数据与资产盘点（v3 修正：别名来源共 5 类）

| # | 来源 | 形态 | 容量 | OCR 现状 |
|---|---|---|---|---|
| 1 | `paint_item_category.name` / `.code` | 主数据 | 全部 | ✅ 已用 |
| 2 | `paint_standard_template_item.alias` | 单值 | 1 别名/部位 | ✅ 已用 |
| 3 | `paint_standard.alias` | 单值（门店标准） | 1 别名/部位 | ❌ **未用** |
| 4 | **`paint_shop.categoryAliasMap`** | **JSON：别名 → categoryId[]（多值）** | 不定 | ❌ **未用** |
| 5 | 硬编码 `CATEGORY_NAME_ALIASES` | 标准名 → 别名[] | **23 个标准名 / 46 个别名** | ❌ 未用（仅 Excel 链路） |
| 6 | 历史工单项 `paint_work_order_item` | 仅 categoryId | 大 | ❌ 无原文，不可用 |

**v3 关键修正**：v1/v2 都漏了第 4 项。它**已经有完整的存储和 CRUD 接口**
（`GET/PUT /paint/shop/:id/category-alias-map`，见 `shop.controller.ts:80-98`），
Excel 链路也在用（`work-order-excel.service.ts:554-577`，且已兼容「旧版单字符串」格式）。

**含义**：「门店别名落库」这件事**不需要新建表**，直接复用 `categoryAliasMap` 即可；
新建的学习表只服务于「自动沉淀」这一个目的。这显著缩小了改动面。

> 另修正 v1/v2 的数量描述：`CATEGORY_NAME_ALIASES` 是 23 个标准名 / 46 个别名，不是「60+ 条」。

### 2.4 摸底 SQL（实施前先跑，确认量级与覆盖）

```sql
SELECT COUNT(*) AS 部位总数        FROM paint_item_category;
SELECT COUNT(*) AS 全局部位        FROM paint_item_category WHERE shop_id IS NULL;
SELECT COUNT(*) AS 有别名的模板项  FROM paint_standard_template_item WHERE alias IS NOT NULL AND alias <> '';
SELECT COUNT(*) AS 有别名的标准    FROM paint_standard WHERE alias IS NOT NULL AND alias <> '';
SELECT COUNT(*) AS 配了别名映射的门店 FROM paint_shop WHERE category_alias_map IS NOT NULL AND category_alias_map <> '';
SELECT COUNT(*) AS 历史工单项      FROM paint_work_order_item;
SELECT COUNT(*) AS 图片池快照      FROM paint_pending_image WHERE ocr_raw_json IS NOT NULL;
```

---

## 三、方案：六层匹配 + 校正闭环

**思路**：用确定性规则吃掉 80% 的 case，把 LLM 从「唯一依靠」降级为「兜底 + 发现新别名」。

### L0 归一化

对 LLM 输出与字典 key **双侧**做同一套清洗（必须先于任何匹配）：

- 去空白 / 全角空格，全角 → 半角，繁 → 简
- 去无意义词缀：`喷漆 / 喷 / 做漆 / 油漆 / 钣金 / 修复 / 翻新 / 部位 / 项`
- 括号统一 `（）→ ()`，中文数字 → 阿拉伯

⚠️ **必须处理的冲突风险**：去词缀后可能撞车（部位「前杠」与「前杠喷漆」归一化后都成「前杠」）。
处理规则：**归一化后若映射到多个 categoryId，则该归一化 key 判为冲突，不写入字典，**
记 warn 日志并上报指标；原样 key 仍保留。这条不做会导致比现在更糟的错误匹配。

### L1 多级字典（精确命中，可解释）

按优先级查，命中即返回并记录 `matchLevel`：

1. 系统部位名 `paint_item_category.name`
2. 部位编码 `code`
3. 模板别名 `paint_standard_template_item.alias`
4. 门店标准别名 `paint_standard.alias`　　　　　　← 新增
5. 门店别名映射 `paint_shop.categoryAliasMap`　　← 新增（多值）
6. 内置别名字典（复用 `CATEGORY_NAME_ALIASES`）　← 新增，抽共享模块
7. 学习库别名（`PaintOcrCategoryAlias`，`status=active + hitCount≥3`）

### L2 模糊匹配

L1 未命中时启用，按门店维度：

- 双向包含：最长公共子串 / 最长公共子序列
- 编辑距离：Levenshtein，阈值 ≤1（长度 ≤4）或 ≤2（更长）
- 首尾字锚定：`XX盖` → 强约束到以「盖」结尾的部位
- 打分：`score = 0.5 * LCS相似度 + 0.3 * (1 - 归一化编辑距离) + 0.2 * 首字命中`

**采纳规则**：仅当 top1 唯一高分、且 `top1 - top2 ≥ 0.1` 时自动采纳；否则判「歧义」，
不自动采纳，推 top3 给人工选。

### L3 频次先验

从 `paint_work_order_item` 按 `shopId` 统计部位频次（**不需要原文，现有 categoryId 就能算**）：

- L2 歧义时按频次给候选排序
- 完全失配时给前端推荐「该店常用 top5」作为快捷选择

### L4 LLM（编号化 + 缓存安全修正）

**prompt 改动**（三个分支都要改，重点在 `all` / `items` 分支）：

- 候选列表带编号注入，要求返回 `categoryIndex`（列表下标）+ `rawText`（图上原文）+ `confidence`
- **同时保留 `matchedName` 作为可选兜底字段**（仅在编号解析失败时使用）
- 候选列表**补齐** `paint_standard.alias` 与 `categoryAliasMap`（现在只塞了模板 alias）

输出 schema：

```json
{"items":[{"rawText":"前保险杠","categoryIndex":3,"matchedName":"前后杠","quantity":1,"newPartQuantity":0,"confidence":0.9}]}
```

**候选列表裁剪**（v3 新增，v1/v2 遗漏）：部位多的门店全量注入会拉长 prompt、拉低选号准确率。

- 有历史数据：按 L3 频次取 top 30
- 无历史数据：按 `sortOrder` 取前 40
- 硬上限 50 条；超出时只保留「高频 top30 + 名称相似 top10」
- 编号顺序**必须稳定**（按 `categoryId` 字典序），否则缓存指纹抖动

**交叉校验**（v3 新增）：后端拿到 `categoryIndex` 反查 name，与模型返回的 `matchedName` 比对，
不一致则判定「模型看错行」，降级走 L0-L2（用 `rawText` + `matchedName`）。

**⚠️ 缓存安全（v1/v2 的致命缺陷，必须配套修改）**

现有缓存 key 是 `sha256(buffer) + ':' + mode`（`llm-ocr.service.ts:194-196`），**不含 shopId**。
其安全性依赖第 43-45 行注释的前提：「LLM 输出仅依赖图片内容，门店匹配在 OcrService 按当前 shop 重做」。

**改成编号输出后该前提被打破**：`categoryIndex` 依赖门店候选列表，
同一张图在 A 店缓存后，B 店命中会拿到 A 店的编号，而两店列表顺序不同 → **部位错配**。
且 TTL 24h，运营改了别名也不会失效。

修法（三选一，推荐 B）：

| 方案 | 做法 | 评价 |
|---|---|---|
| A | cache key 加 `shopId` | 安全，但跨店同图无法复用缓存 |
| **B** ✅ | **cache key 加候选列表指纹** | 安全，且别名相同的门店仍可共享缓存；别名一改指纹就变，**缓存自动失效，无需手动清理** |
| C | 放弃编号，只输出 `rawText`+`matchedName` | 保持缓存语义，但失去编号化的准确率收益 |

B 的 key 公式：

```ts
const fingerprint = categories?.length
  ? createHash('sha256')
      .update(categories.map(c => `${c.id}|${c.name}|${c.code}|${c.alias || ''}`).join('\n'))
      .digest('hex')
      .slice(0, 8)
  : '-';
const cacheKey = `${sha256(buffer)}:${mode}:${fingerprint}`;
```

> 注：`CategoryContext` 现无 `id` 字段，需补上（用于稳定排序与指纹）。
> 另需把 `max_completion_tokens` 从 800 提到 **1200**（输出多了 rawText/confidence/index）。

### L5 校正闭环

用户每次手工改部位 = 一条高质量标注 → 落学习库 → 命中达标后转 `active` → 回写 `categoryAliasMap`。

---

## 四、置信度分级（v3 新增，v1/v2 缺失）

v1/v2 只说「confidence ≥ 0.9 不打扰」，但 L2 的 score 天然到不了 0.9，会导致 fuzzy 永远显示为「需确认」、分级逻辑失效。**必须显式定义各层到 confidence 的映射**：

| 匹配层 | confidence | 前端分级 |
|---|---|---|
| L1-1/2 部位名 / code 精确 | 0.98 | 高（静默） |
| L1-3/4/5 模板别名 / 标准别名 / 门店别名映射 | 0.95 | 高（静默） |
| L1-6 内置别名字典 | 0.92 | 高（静默） |
| L1-7 学习库 active | 0.90 | 高（静默） |
| L2 模糊唯一高分 | `min(0.85, 0.5 + score * 0.4)` | 中（黄底提示） |
| L2 歧义（未自动采纳） | 0.50 | 低（红条 + top3） |
| L3 频次推荐（未采纳） | 0.30 | 低（红条 + top3） |
| L4 模型给出 | `modelConfidence * 0.8` | 按值分级 |
| none 完全失配 | 0 | 低（红条） |

分级阈值：**高 ≥ 0.90 静默 │ 中 0.60~0.90 黄底 │ 低 < 0.60 红条 + 候选**

---

## 五、数据结构改动

### 5.1 新建学习表

```prisma
model PaintOcrCategoryAlias {
  id           String   @id @default(cuid())
  shopId       String?  @map("shop_id")     // null = 全局
  rawText      String   @map("raw_text")    // 图片原文（学习库主键语义）
  categoryId   String   @map("category_id")
  source       String   @map("source")      // manual=人工校正 | llm=模型建议 | import=批量导入
  hitCount     Int      @default(1) @map("hit_count")
  confirmCount Int      @default(0) @map("confirm_count")  // 被人工采纳次数
  status       String   @default("pending") // pending | active | rejected
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime? @updatedAt @map("updated_at")

  @@unique([shopId, rawText, categoryId])
  @@index([shopId, status])
  @@map("paint_ocr_category_alias")
}
```

> `status` 逻辑：`manual` 直接 `active`；`llm` 先 `pending`，
> `confirmCount ≥ 3` 才转 `active`，避免把模型错误固化成脏数据。

### 5.2 `PaintWorkOrderItem` 加一个可空溯源字段

```prisma
// 仅 OCR 建单时写入：图片上的部位原文，用于沉淀「原文 → 部位」样本
sourceRawText String? @map("source_raw_text") @db.VarChar(100)
```

**为什么不能省**（v1/v2 未论证）：学习库只在「人工校正」时写入负向样本；
而「OCR 命中且用户未修改」的**正向样本**同样有价值，`sourceRawText` 是唯一能记录它们的字段。
成本仅一个可空列，不加则正向样本永久丢失。

### 5.3 不需要改的

`paint_shop.categoryAliasMap` 已是 JSON Text，直接复用，学习库转正后回写此处即可，
**无需为门店别名新建表或加列**。

---

## 六、接口与交互

### 6.1 后端

`OcrItem` 扩展（`matched` 保留兼容）：

```ts
confidence: number;                    // 0~1，按第四节映射
matchLevel: 'exact' | 'code' | 'alias' | 'learned' | 'fuzzy' | 'llm' | 'none';
candidates?: { categoryId: string; name: string; score: number }[];  // 歧义/失配时 top3
```

**修改的接口**

| 接口 | 改动 |
|---|---|
| `POST /paint/work-order/quick-create` | ① 失配项不再丢弃，以 `categoryId=null` 透出（修 P0）<br>② 默认 `ocrMode` 由 `basic` 改为 `all`（修 P4，可灰度） |
| `POST /paint/work-order/ocr-recognize` | 默认 mode 同上 |
| `POST /paint/work-order/batch-ocr-preview` | 透出 `confidence` / `matchLevel` / `candidates` |

**新增接口**

| 接口 | 说明 |
|---|---|
| `POST /paint/work-order/ocr-category-correction` | 校正回写，body `{ shopId, rawText, fromCategoryId, toCategoryId }` |
| `GET  /paint/standard/ocr-aliases` | 学习库列表（分页 + 按 status 过滤） |
| `POST /paint/standard/ocr-aliases/:id/approve` | 人工转正（pending → active，并回写 `categoryAliasMap`） |
| `POST /paint/standard/ocr-aliases/:id/reject` | 否决脏数据 |

### 6.2 前端

⚠️ **注意命名陷阱**：现有 `ocr-correct-modal.vue` 只校正**基础资料**
（orderNo/plateNumber/customerName/phone/carModel/vin/brand/date），**不涉及部位**。
部位校正交互需要新做，但可复用其「左图右表单」的交互范式。

| 位置 | 改动 |
|---|---|
| `batch-ocr-modal.vue` | 部位列表按置信度分级渲染（高静默 / 中黄底 / 低红条 + top3 一键切换） |
| `work-order-operate-drawer.vue` | ① 失配项以「待确认」红条展示而非消失（修 P0）<br>② 右侧加「该店常用部位」快捷条（L3 频次） |
| 新增 `ocr-category-correction-modal.vue` | 部位校正弹窗（可选，P3 做） |

---

## 七、分期落地

| 期 | 内容 | 改动面 | 预期 |
|---|---|---|---|
| **P1** | L0 归一化（含冲突检测）+ L1 多级字典（补 3 类别名来源）<br>+ **修 P0 静默丢弃** + 修 P4 默认 mode | 后端为主，前端仅展示失配项 | 匹配率明显提升，**纯增益、可解释、零风险** |
| **P2** | L2 模糊匹配 + 置信度分级 + 前端分级交互 | 前后端 | 吃掉「差一个字」，用户只审少量条目 |
| **P3** | L4 编号化 + **缓存指纹修正** + L3 频次 + 校正回写 + 学习库 | 前后端 + DDL | 开始积累样本 |
| **P4** | 学习库自动转正 + 图片池建单补 items 识别 + 效果看板 | 后端 | 越用越准，形成飞轮 |

**为什么 P1 是纯增益**：L1 第 1 优先级仍是「部位名精确匹配」，行为与现状一致；
新增的只是原本会失配的兜底路径。唯一变坏可能是 L0 归一化撞车 —— 已用「冲突则不入库」堵住。

**评估方法**

- 基线集：录 100~200 张历史工单图。**注意：历史工单只有 categoryId 没有原文，
  基线集必须人工标注一遍**，这步工作量要单列。
- 指标：自动采纳率 / top1 准确率 / top3 召回率 / **平均每条工单的人工干预次数**（最终业务指标）

**灰度**：先在 1~2 家部位叫法最乱的门店开，跑稳再全量。

---

## 八、风险与回滚

| 风险 | 应对 |
|---|---|
| 归一化撞车导致错配 | 归一化后映射到多个 categoryId 时判冲突、不入库 + 告警 |
| L2 模糊匹配误匹配（如「前门」vs「后门」） | 仅唯一高分采纳；歧义推 top3；P2 先只读记录、不自动采纳，观察一周再放开 |
| 编号化导致跨店缓存错配 | cache key 加候选列表指纹（方案 B） |
| 新逻辑线上异常 | `paint_shop.ocrConfig` 加 `categoryMatching: 'legacy' \| 'layered'`，<br>单店切回 `legacy` 即秒级回滚，无需发版 |
| LLM 输出变长被截断 | `max_completion_tokens` 800 → 1200 |
| prompt 改动后模型不遵循 | 编号解析失败 → 回退 `matchedName` 走 L0-L2；再加交叉校验兜底 |

> `ocrConfig` 已是 JSON Text 且有 `try/catch` 兜底（`ocr.service.ts:281-287`），
> 加字段向后兼容，旧数据无该字段按默认处理。

---

## 九、待确认项（确认后即可开工）

1. **默认 `ocrMode` 是否由 `basic` 改为 `all`？** 会让单张建单也走部位识别，OCR 调用成本上升
   （当前 `all` 与 `basic` 是同一次调用、仅 prompt 不同，增量成本≈0，主要是输出 token）。
   建议改。
2. **`categoryMatching` 灰度开关默认值**：默认 `layered`（新逻辑全量生效，单店可切回）
   还是默认 `legacy`（逐店开启）？建议 `layered`，因 P1 是纯增益。
3. **内置别名字典**（`CATEGORY_NAME_ALIASES`，23 标准名/46 别名）是否首批就导入
   `categoryAliasMap` 作为全局基线？建议导入（可编辑，比硬编码好维护）。
4. **P2 模糊匹配是否先只读观察一周**再放开自动采纳？建议是。
5. 图片池建单补 items 识别放 P4 是否接受（会翻倍图片池的 OCR 成本）？

---

## 十、改动文件清单

| 文件 | 期 | 改动 |
|---|---|---|
| `apps/base-system/src/api/paint/service/paint-category-matcher.ts` | P1 | **新建**：L0 归一化 + L1 多级字典 + L2 模糊匹配 + 置信度映射（纯函数，易单测） |
| `apps/base-system/src/api/paint/service/paint-category-alias.ts` | P1 | **新建**：内置别名字典（从 `work-order-excel.service.ts` 抽出，两链路共用） |
| `apps/base-system/src/api/paint/service/ocr.service.ts` | P1-P3 | 重写 `matchItemsToCategories`；`getShopCategories` 补齐 3 类别名来源 + 候选裁剪 |
| `apps/base-system/src/api/paint/service/llm-ocr.service.ts` | P2-P3 | prompt 编号化 + rawText/confidence；**cache key 加候选指纹**；maxTokens 800→1200；`CategoryContext` 加 `id` |
| `apps/base-system/src/api/paint/service/work-order-excel.service.ts` | P1 | 别名字典改为引用共享模块 |
| `apps/base-system/src/api/paint/service/pending-image.service.ts` | P4 | 建单时补 items 识别 |
| `apps/base-system/src/api/paint/work-order/rest/work-order.controller.ts` | P1-P3 | 修 P0 静默丢弃、修 P4 默认 mode、新增校正接口 |
| `apps/base-system/src/api/paint/standard/rest/*.ts` | P3 | 新增别名库管理接口 |
| `frontend/src/views/paint/work-order/modules/batch-ocr-modal.vue` | P2 | 置信度分级渲染 |
| `frontend/src/views/paint/work-order/modules/work-order-operate-drawer.vue` | P1-P2 | 失配项「待确认」展示、常用部位快捷条 |
| `backend/prisma/schema.prisma` | P3 | 新增 `PaintOcrCategoryAlias` + `PaintWorkOrderItem.sourceRawText` |

---

## 附录 A：相对 v1/v2 的修正

| # | v1/v2 的说法 | 核实后的事实 | 影响 |
|---|---|---|---|
| 1 | 「Excel 已积累 60+ 条经验别名」 | 实际 23 个标准名 / 46 个别名 | 描述准确化 |
| 2 | 别名来源 4 类（漏 `categoryAliasMap`） | 实际 5 类，且 `categoryAliasMap` 已有完整 CRUD 接口 | **门店别名无需新建表**，改动面缩小 |
| 3 | 「L4 改编号选择」即可 | 现有 cache key 不含 shopId，编号化会**跨店错配** | 🔴 **不改会出线上 bug**，必须加候选指纹 |
| 4 | 未提及失配项被丢弃 | controller 直接 `filter` 丢弃失配项 | 🔴 **用户体感最强的问题**，需一并修 |
| 5 | 「图片池固定 basic」 | 三个入口默认都是 `basic`，不止图片池 | 影响面更大 |
| 6 | 「confidence ≥ 0.9 不打扰」 | L2 的 score 天然到不了 0.9，分级会失效 | 🟠 需显式定义各层映射（见第四节） |
| 7 | 未提候选列表裁剪 | 部位多的门店全量注入会拉低选号准确率 | 🟠 需加裁剪 + 稳定排序 |
| 8 | 未提归一化撞车风险 | 「前杠」与「前杠喷漆」归一化后冲突 | 🟠 需冲突检测，否则比现状更糟 |
| 9 | 「前端部位列置信度交互」 | `ocr-correct-modal.vue` 只校基础资料、不含部位 | 需新做，非改造 |
