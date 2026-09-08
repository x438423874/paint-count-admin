# 讯锐 2025-12 工单「OCR 自动选择部位」优化方案 V2

> 与 V1（`ocr-auto-select-part-xunrui-dec-plan.md`）的关系：**不推翻，只升级**。
> V1 的 P0 止血三项、L0-L3 匹配分层、P2 校正闭环设计全部保留，本文不重复其细节；
> V2 在其基础上新增 6 项优化、修正 2 处勘误，并把验收方式升级为
> 「黄金测试集自动回归」——用 19 条已审核工单的人工标注免费测准，达标才碰草稿。
>
> 数据快照：2026-09-08 下午实测。**注意：这批数据正被人工并行处理，快照会过期，执行前必须重查（见 §1.2）。**

---

## 〇、V2 相对 V1 的改动总览

| # | 优化点 | 级别 | V1 为什么不够 |
|---|---|---|---|
| 1 | **OCR 缓存键加入提示词版本号** | P0'（并入止血） | 缓存键只有 `sha256(图片)+mode`，改完提示词 24h 内重跑命中的仍是**旧提示词的缓存**，P1 的调优与验收全部失真，且无任何报错迹象 |
| 2 | **黄金测试集自动回归** | 流程（先于一切批量动作） | V1 用随机 20 张人工肉眼评估；现有 19 条已审核工单 = 图片 + 人工确认部位，可脚本化自动对比，得到可复现的准确率数字和验收门 |
| 3 | **模板别名多值化** | P1' | `alias` 是 varchar(50) 单值，"前后杠"需要映射 前杠/后杠/前保险杠… 装不下；且前端部位选择器用 alias **替代**部位名展示，塞逗号串会乱 |
| 4 | **提示词按比亚迪 4S 工单格式重写** | P1' | V1 只说"增强"；具体到讯锐格式：部位藏在「维修项目」表格的自由文本里（"喷漆前杠，右前叶"），需教模型逐行拆分、忽略非喷漆项、"更换"计入新件数；items 模式 max_tokens=600 有截断风险 |
| 5 | **批量补录改「预览 → 确认 → 应用」两阶段** | P1' | V1 依赖现有"只填空不覆盖"一次性写库，76 单里模糊匹配错一条就静默进账（12 月要对账）；且未匹配原文没有聚合出口，别名永远靠猜 |
| 6 | **执行纪律固化** | 运维 | 数据在移动（快照间 13 条被人工审核）、限流 20/min、多页图只识别第一张、完成后应封单 |

**V1 勘误 2 处**见 §五（SQL 列名错误、目标工单过滤口径）。

---

## 一、数据现状（2026-09-08 下午快照）

### 1.1 讯锐 2025-12 工单分布

| 状态 | 数量 | 有图 | 有部位 | 说明 |
|---|---|---|---|---|
| DRAFT | **139** | 76 | 0 | **目标对象：76 条有图草稿** |
| AUDITED | 19 | 19 | 19 | **黄金测试集**（§2.2），不再改动 |
| 合计 | 158 | 95 | 19 | `settlement_month='2025-12'` 口径 |

- 模板 `tpl_rh_xr_001`：45 个部位，`alias` 全空；
  门店 `categoryAliasMap` 已有 **27 个键**（Excel 导入方向：`标准名/列名 → [categoryId]`，可反向利用，见 §2.3）。
- 全局部位 68 个，V1 的"候选收窄到模板 45 个"结论不变。
- 无图的 63 条草稿全部是 2026-08-13 10:44 同一秒批量导入的；图片池 `paint_pending_image` 该店 **0 条**遗留，原图不可找回，只能人工补录或找店方要图。

### 1.2 ⚠️ 并发警告

同日 14:00 → 15:30 两次快照间：DRAFT 152→139，AUDITED 6→19——**有人正在手工处理这批工单**。
因此：目标集数量、"是否有部位"都是移动的。批量动作前必须用 §附B 的 SQL 运行时重查；
黄金集（已审核）不再 OCR 回写，只作只读评估。

### 1.3 阻塞项检查（均已排除）

- **封单**：`paint_settlement_month` 无 2025-12 行（该店已封 2026-01/02/04/06/07），2025-12 更新不被阻塞；全部处理完并审核后**建议封单**防再改。
- **限流**：`POST /paint/work-order/ocr` 20 次/分钟，76 单串行 ≥ 4 分钟（每张 LLM 耗时 2~4s），无阻塞。
- **多页图**：黄金集里 3 条有 2~3 张图。生产批量补录只 OCR `images[0]`——回归与批量保持同一语义，部位在第 2 页的单属已知限制，靠预览人工兜底。

---

## 二、V2 新增优化详述

### 2.1 【P0'】缓存键加入提示词版本号

**文件**：`backend/apps/base-system/src/api/paint/service/llm-ocr.service.ts`

现状（`buildCacheKey`）：

```ts
private buildCacheKey(buffer: Buffer, mode: OcrMode): string {
  return `${createHash('sha256').update(buffer).digest('hex')}:${mode}`;
}
```

**后果**：缓存 TTL 24h。改完提示词立刻重跑同一批图，命中的是旧提示词的结果——
准确率纹丝不动，看起来像"优化无效"，实际上是**调优循环和验收全部失效**，且无报错。

**改法**：

```ts
private static readonly PROMPT_VERSION = 'v2-4s-format'; // 每次改 prompt 必须递增
// key = sha256(buffer):mode:promptVersion[:shopKey]
```

- 若提示词按门店注入定制片段（§2.4 的讯锐示例），`shopId`（或其 ocrConfig 摘要）也要进 key；
- 上线后旧缓存自然过期即可，无需清理。

### 2.2 【流程】黄金测试集：19 条已审核工单 = 免费标注

V1 的 20 张随机抽样 + 肉眼评估升级为**可复现的自动回归**：

1. 取 2025-12 全部已审核工单（快照 19 条，均有图、均有人工确认的部位明细）；
2. 对每单第一张图跑 items 模式 OCR（与生产批量补录完全同路径同参数）；
3. 与 `paint_work_order_item` 的人工标注对比，输出报告：
   - **项命中率**：识别出的 categoryId 命中标注集合的比例；
   - **单命中率**：全部识别项都命中（无多识别）的单占比；
   - **漏识别**：标注有、OCR 没提取到的部位（提示词问题）；
   - **匹配失败**：提取到但 `matched=false` 的原文列表（别名缺口，§2.5 闭环用）；
   - 多页单单独标注（第 2 页部位的漏识别不计入提示词问题）。
4. **验收门**：项命中率 ≥ 85% 且模板外部位为 0，才允许对草稿批量执行；
   不达标 → 按匹配失败报告补别名/改提示词 → 重测（内容缓存按 §2.1 带版本失效，重测真实有效）。

对比按"每单 (categoryId → quantity) 集合"进行，quantity 允许 ±1 容差（新件数与幅数最终有人工预览把关，见 §2.5）。

### 2.3 【P1'】模板别名多值化

**现状两个问题**：

- `paint_standard_template_item.alias` 是 varchar(50) **单值**，讯锐模板 45 项全部为空；
- 前端部位选择器直接用 alias **替代**部位名展示
  （`work-order-operate-drawer.vue:361`：`name: s.alias || s.category?.name || ''`），
  塞入"前杠,后杠,前保险杠"这类串会把选择器标签也弄乱。

**方案**：约定 **alias 支持逗号分隔多值**（`前杠,后杠,前保险杠`），三处配套：

| 位置 | 改动 |
|---|---|
| 服务端匹配（`ocr.service.ts`） | 构建 nameToId 时按逗号拆开逐个注册（含现有 `paint_standard.alias`、内置 `CATEGORY_NAME_ALIASES`） |
| 提示词注入（`llm-ocr.service.ts`） | 部位清单展示为 `名称(别名1/别名2)`，只在讯锐等定制门店注入 |
| 前端展示（`work-order-operate-drawer.vue`） | 取第一段展示：`(s.alias || '').split(',')[0] || s.category?.name`（一行） |

**与 `categoryAliasMap` 合并**：该店已有 27 键 Excel 别名映射
（`GET/PUT /paint/shop/:id/category-alias-map` 接口现成，`shop.controller.ts:84-98`）。
注意方向相反（`标准名 → [categoryId]`），接入时**反向索引**成 `别名 → categoryId` 并入 L1 字典
（V1 §六已提出，V2 补充：该 map 的键里已有"后盖里面""杠/门饰条"这类多称呼，含 `/` 与 `,` 两种分隔，拆分时都处理）。

讯锐首批建议别名（依据 V1 失配样本 + 图片实拍）：

| 模板部位 | alias 多值 |
|---|---|
| 前后杠 | `前杠,后杠,前保险杠,后保险杠` |
| 叶子板 | `前叶,后叶,左前叶,右前叶,翼子板` |
| 机盖 | `前机盖,引擎盖,发动机盖` |
| 后盖 | `尾盖,后备箱盖,行李箱盖` |
| 车门 | `前门,后门,左前门,右前门,门` |
| 倒车镜 | `后视镜,反光镜` |
| 拖车盖 | `拖车钩盖,拖车钩饰盖` |

> V1 的归一化红线保留：`半喷 / 里外 / 内侧` 有业务含义（区分系数），任何清洗不得剥离。

### 2.4 【P1'】提示词按比亚迪 4S 工单格式重写

**文件**：`llm-ocr.service.ts` items 分支（现 117-123 行，maxTokens=600）

讯锐工单实测特征（见 V1 §二与本文快照图片）：部位不是独立栏位，而是
「维修项目」表格 `项目名称/材料名称` 列里的自由文本，顿号/逗号分隔，
且混有非喷漆项（"30分钟精洗服务"）、修复与更换并存。

提示词要点（保持 `temperature=0.1`）：

1. 只看「维修项目」表格的名称列；按逗号/顿号把每个项目名**拆成多个部位词**逐个匹配候选表；
2. 忽略非喷漆项：清洗、精洗、钣金、四轮定位等；拿不准的宁可不输出（`勿编造` 保留）；
3. **"更换"字样的部位 → `newPartQuantity` 计数**，其余为喷漆幅数——新件数影响幅数加成系数，漏了直接算错钱；
4. 候选表带编号注入，要求模型返回 `categoryIndex + rawText + confidence`，禁止自由发挥部位名；
   编号解析失败时回退 `matchedName` 走 L0-L2（V1 设计保留）；
5. 附 2 个 few-shot 示例（直接用真实工单文案，如"喷漆前杠，右前叶 → 前后杠×1 + 叶子板×1"、"更换中网，拖车盖，右前杠饰条 → 中网 + 拖车盖 + 保险杠饰板，均计新件"）；
6. **maxTokens 600 → 1000**：V1 基线里已出现单图 8 个部位项，600 有 JSON 截断风险；
7. 可选 A/B：`thinking: { type: 'disabled' }` 改为配置开关 `LLM_OCR_THINKING`，对黄金集跑一轮对比
   （M3 是推理模型，杂乱 4S 表格可能受益；回填是一次性任务，成本可忽略；开启时 maxTokens 需相应加大）。

### 2.5 【P1'】批量补录改「预览 → 确认 → 应用」两阶段

**现状风险**：前端 `handleBatchOcrFill` 逐单 OCR → 直接 `updateWorkOrder` 写库。
76 单里只要模糊匹配错一条，就是**静默错账**（12 月对账月份）。

**设计**（复用现有接口，不改写库路径）：

1. **预览**：同样的批量循环，但只展示不写库——每单列出：识别部位 → 匹配到的系统部位（含匹配级别）、
   quantity / newPartQuantity、按模板系数预览的幅数、未匹配原文（黄标）；
2. **聚合报告**：所有未匹配原文按频次排序汇总成一张表——这就是**别名缺口清单**，
   补进 alias（§2.3）→ 重跑预览 → 通常一轮即可把匹配率拉满；
3. **确认**：人工在预览表里可删除/改选单条，确认后一次性应用（走现有 `updateWorkOrder`，
   幅数按模板系数自动重算——`work-order.service.ts` 更新路径已验证）；
4. **轻量替代**（若两阶段赶不上 12 月节奏）：保留现有一键模式，但
   ① 跑完必须输出未匹配聚合报告；② 人工抽查 ≥ 10%（约 8 单），重点核对幅数非 0、新件数合理。

### 2.6 执行纪律

1. 批量前运行时重查目标集（§附B SQL），并确认 2025-12 未封单；
2. 已审核工单一律不碰（现有"仅 DRAFT/PENDING"过滤已保证，勿改此语义）；
3. 意识到有人并行手工处理：批量执行选在人工停歇时段，避免同单竞争；
4. 全部草稿补齐、审核完成后，**封单 2025-12**；
5. 63 条无图单不阻塞流程：找店方补原图（走图片池）或人工录入，与 OCR 批量并行推进。

---

## 三、修订后的阶段划分与排期

| 阶段 | 内容（V2 增量加粗） | 涉及文件 | 预估 |
|---|---|---|---|
| **P0'** | V1 P0-1/2/3 全部保留 + **缓存键版本号** + **黄金集回归脚本** | `ocr.service.ts`、`work-order.service.ts`、`llm-ocr.service.ts`、`index.vue`、新增回归脚本 | V1 的 1 人日 + **0.5 人日** |
| Gate | **黄金集项命中率 ≥ 85% 且模板外部位 = 0**，否则迭代（补别名/改提示词再测） | — | — |
| **P1'** | V1 L0-L3 + **别名多值化（三处）** + **4S 格式提示词重写** + **两阶段预览** | `ocr.service.ts`、`llm-ocr.service.ts`、`paint-category-alias.ts`(新)、`index.vue`、`work-order-operate-drawer.vue` | V1 的 1.5 人日 + **1 人日** |
| **P2** | V1 原样保留（置信度分级 + 校正回写 + 图片池补 items） | 见 V1 §七 | 不变 |
| 执行 | 黄金集达标后：76 条草稿走预览 → 补别名迭代 → 确认应用 → 抽查 → 审核 → **封单** | — | 半天内 |

验收指标在 V1 表格基础上，主验收改为**黄金集自动回归**（可重复、零标注成本）；
V1 的 20 张随机基线保留作历史对照（59.5% / 55%）。

---

## 四、V1 保留项清单（细节以 V1 为准，不再展开）

- **P0-1** OCR 候选收窄到门店模板 45 项（含收窄后 matchedName 为空的回退全量匹配，仅提示不写库）；
- **P0-2** 系数缺失不再 `?? 0` 静默落库：OCR 路径跳过 + warning 返回前端，手工路径保留；
- **P0-3** 前端 `batchOcrFillMode` / `quickOcrMode` 默认值 `'basic'` → `'all'`（智能推荐），文案注明"仅基础资料"不识别部位；
- **L0-L3** 归一化 → 多级字典（模板名/code/alias/standard.alias/categoryAliasMap 反向/内置字典）→ 模糊匹配（唯一高分才自动采纳）→ 频次先验；
- **P2** 置信度分级展示 + 人工校正回写别名库 + 图片池建单补 items 识别。

---

## 五、V1 勘误

1. **附 SQL #3 列名错误**：`paint_work_order_item` 没有 `calculated_value` 列，实为 `paint_count`，
   且应按"quantity × 系数 = 0 但 quantity ≠ 0"的口径排查（quantity=0 的行本身合法）。修正版见 §附B-4。
2. **目标工单过滤口径**：系统已改用 `settlementMonth` 字段（commit 3a82313 弃用按 `order_date` 推结算月），
   目标集应以 `settlement_month='2025-12'` 过滤；V1 写作"约 72 单"是旧快照（当时 88 单/100% 有图），
   当前实况为 76 条有图草稿——**执行时以 §附B-1 的运行时查询为准，不用文中任何静态数字**。

---

## 附A：黄金集回归脚本要点

```
输入：shopId=cmr0sa6c20000qr1k4xb9hags, month=2025-12, status=AUDITED
for 每条工单:
    img = images[0]                        # 与生产批量补录同语义
    result = OcrService.recognizeWithTemplate(img, shopId, 'items')
    label = { (item.categoryId): item.quantity }   # 人工标注
    pred  = { (item.categoryId): item.quantity }   # 仅取 matched=true
    记录: 命中项 / 多识别项 / 漏识别项(含该图页码提示) / matched=false 的 rawText 清单
输出: 项命中率、单命中率、漏识别榜、未匹配原文榜（直接喂给别名回补）
```

只读评估，不写库；缓存键带 §2.1 的版本号，改提示词后重测即真实重算。

## 附B：执行 SQL（2026-09-08 修订版）

```sql
-- 1) 运行时目标集（批量前必查，数量以此刻为准）
SELECT o.id, o.order_no, o.status
FROM paint_work_order o
WHERE o.shop_id = 'cmr0sa6c20000qr1k4xb9hags'
  AND o.settlement_month = '2025-12'
  AND o.status IN ('DRAFT','PENDING')
  AND EXISTS (SELECT 1 FROM paint_work_order_image i WHERE i.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM paint_work_order_item t WHERE t.order_id = o.id);

-- 2) 封单检查（2025-12 应无行；有行且 is_sealed=1 则禁止批量）
SELECT month, is_sealed FROM paint_settlement_month
WHERE shop_id = 'cmr0sa6c20000qr1k4xb9hags' ORDER BY month;

-- 3) 黄金集（只读，回归用）
SELECT o.id, o.order_no, c.id AS category_id, c.name, i.quantity, i.new_part_quantity
FROM paint_work_order o
JOIN paint_work_order_item i ON i.order_id = o.id
JOIN paint_item_category c ON c.id = i.category_id
WHERE o.shop_id = 'cmr0sa6c20000qr1k4xb9hags'
  AND o.settlement_month = '2025-12' AND o.status = 'AUDITED'
ORDER BY o.order_no;

-- 4) P0 验收：静默 0 幅数巡检（应恒为 0 行；勘误：V1 误写 calculated_value）
SELECT w.order_no, c.name, i.quantity, i.paint_count
FROM paint_work_order_item i
JOIN paint_work_order w ON w.id = i.order_id
JOIN paint_item_category c ON c.id = i.category_id
WHERE w.shop_id = 'cmr0sa6c20000qr1k4xb9hags'
  AND w.settlement_month = '2025-12'
  AND i.quantity > 0 AND i.paint_count = 0;

-- 5) 部位历史频次（L3 先验 + 预览表快捷推荐）
SELECT c.name, COUNT(*) cnt
FROM paint_work_order_item i
JOIN paint_item_category c ON c.id = i.category_id
JOIN paint_work_order w ON w.id = i.order_id
WHERE w.shop_id = 'cmr0sa6c20000qr1k4xb9hags'
GROUP BY c.name ORDER BY cnt DESC LIMIT 20;
```

## 附C：涉及文件清单（V2 增量）

| 文件 | 阶段 | V2 改动 |
|---|---|---|
| `backend/.../service/llm-ocr.service.ts` | P0'/P1' | **缓存键版本号**；4S 格式提示词重写；maxTokens 600→1000；可选 thinking 开关 |
| `backend/.../service/ocr.service.ts` | P0'/P1' | V1 候选收窄与匹配重写保留；**alias 多值拆分注册**；categoryAliasMap 反向索引并入 |
| `backend/.../service/work-order.service.ts` | P0' | V1 P0-2 保留（系数缺失跳过 + warning） |
| `frontend/.../work-order/index.vue` | P0'/P1' | V1 默认值修正保留；**两阶段预览-确认-应用** |
| `frontend/.../work-order/modules/work-order-operate-drawer.vue` | P1' | **alias 取第一段展示** |
| 新增 `backend/.../service/paint-category-alias.ts` | P1' | V1 保留：共享别名字典（Excel 与 OCR 共用） |
| 新增 黄金集回归脚本 `backend/scripts/` | P0' | **自动对比已审核工单标注，输出准确率报告** |
| 新增 `backend/docs/ocr-auto-select-part-xunrui-dec-plan-v2.md` | — | 本文档 |
