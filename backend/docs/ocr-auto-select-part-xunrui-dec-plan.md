# 讯锐 12 月工单「OCR 识别自动选择部位」优化方案

> 目标：让工单管理里**佛山瑞华比亚迪(讯锐) 2025-12** 的存量工单，
> 通过 OCR 从已上传的工单图片中自动识别并选中喷漆部位，
> 把「72 张图人工逐条选部位」变成「机器自动选中 + 人工只审低置信项」。
>
> 本文所有结论均基于**真实数据实跑验证**（非推测），基线数据见第二节。

---

## 一、背景与数据现状

### 1.1 门店信息

| 项 | 值 |
|---|---|
| 门店 | 佛山瑞华比亚迪(讯锐)，`code=FSXR` |
| shopId | `cmr0sa6c20000qr1k4xb9hags` |
| 标准模板 | `tpl_rh_xr_001`（45 个部位） |
| 门店专属部位 | 0 个 |
| 模板别名 | 0 条 |

### 1.2 讯锐 2025-12 工单盘点（实测 SQL 结果）

| 指标 | 数量 |
|---|---|
| 工单总数（order_date 在 2025-12） | 88 |
| 有图片 | **88（100%）** |
| 状态 DRAFT（可被批量 OCR 填充处理） | 80 |
| 状态 SETTLED（已结算，不处理） | 8 |
| 已有部位明细 | 仅 8 |
| **目标对象：有图 + 无部位 + 未审核** | **约 72 单** |

图片实际存储路径：`backend/uploads/paint/FSXR/2025-12/`（共 100 个文件）。

### 1.3 现有能力

`工单管理 → 批量 OCR 填充` **已经支持部位自动填充**，且是「只填空、不覆盖」语义：

```368:386:frontend/src/views/paint/work-order/index.vue
      // 部位项目：仅当工单无有效项目时，用 OCR 识别到的部位填充
      const ocrItems = ocrResult.items;
      if (ocrItems && ocrItems.length > 0) {
        const matchedItems = ocrItems.filter(it => it.matched && it.categoryId);
        if (matchedItems.length > 0) {
          const hasNoItems =
            !order.items ||
            order.items.length === 0 ||
            order.items.every((it: any) => !it.quantity || it.quantity === 0);
```

**所以问题不是「从 0 开发」，而是「现有链路有三个硬伤，直接跑会出错账」。**

---

## 二、实测基线（真实数据，必读）

### 2.1 方法

对讯锐 2025-12「有图无部位」的工单随机抽样 20 张，
直接调用 `OcrService.recognizeWithTemplate(buffer, FSXR, 'items')`，
统计 LLM 识别出的部位项与最终匹配到系统 `categoryId` 的比例。

### 2.2 结果

```
[BYDEGD061WRO251229012] 识别 1 项, 命中 1 项 => 门拉手✓
[BYDEGD061WRO251227044] 识别 1 项, 命中 0 项 => 空✗
[BYDEGD061WRO251226021] 识别 1 项, 命中 1 项 => 前后杠✓
[BYDEGD061WRO251226007] 识别 0 项, 命中 0 项 =>
[BYDEGD061WRO251225018] 识别 5 项, 命中 5 项 => 叶子板✓|车门✓|保险杠饰板✓|轮眉✓|倒车镜✓
[BYDEGD061WRO251224015] 识别 3 项, 命中 2 项 => 后盖✓|空✗|保险杠饰板✓
[BYDEGD061WRO251224007] 识别 2 项, 命中 2 项 => 机盖✓|前后杠✓
[BYDEGD061WRO251223003] 识别 1 项, 命中 1 项 => 保险杠饰板✓
[BYDEGD061WRO251222036] 识别 8 项, 命中 6 项 => 空✗|叶子板✓|空✗|车门✓|叶子板✓|轮眉✓|轮眉✓|叶子板✓
[BYDEGD061WRO251222023] 识别 1 项, 命中 0 项 => 前杠✗
[BYDEGD061WRO251222021] 识别 1 项, 命中 0 项 => 空✗
[BYDEGD061WRO251220033] 识别 5 项, 命中 1 项 => 包角✓|空✗|空✗|空✗|空✗
[BYDEGD061WRO251220019] 识别 2 项, 命中 1 项 => 包角✓|空✗
[BYDEGD061WRO251219016] 识别 0 项, 命中 0 项 =>
[BYDEGD061WRO251219010] 识别 1 项, 命中 1 项 => 保险杠饰板✓
[BYDEGD061WRO251218032] 识别 0 项, 命中 0 项 =>
[BYDEGD061WRO251218031] 识别 3 项, 命中 1 项 => 后盖✓|前杠✗|左前叶✗
[BYDEGD061WRO251218028] 识别 1 项, 命中 0 项 => 空✗
[BYDEGD061WRO251218027] 识别 0 项, 命中 0 项 =>
[BYDEGD061WRO251218013] 识别 1 项, 命中 0 项 => 空✗
```

| 指标 | 数值 |
|---|---|
| **按项命中率** | **22/37 = 59.5%** |
| **按单命中率**（至少命中 1 项） | **11/20 = 55%** |
| 识别到 0 项（图片无部位文字或质量差） | 4/20 = 20% |
| 识别到但匹配失配 | 5/20 = 25% |
| 单张耗时 | 2 ~ 4 秒 |
| 全量 72 单预计耗时 | 3 ~ 5 分钟 |

### 2.3 失配样本归因

| 图片原文 | 系统部位名 | 失配类型 |
|---|---|---|
| 前杠 | 前后杠 | 简称 / 部分匹配 |
| 左前叶 | 叶子板 | 带方位词前缀 |
| （空） | — | LLM 未从候选列表中选出，且 `rawText` 为空无法补救 |

---

## 三、现状诊断：三个必须先解决的硬伤

### 硬伤 ①：默认识别范围根本不包含部位

`批量 OCR 填充` 的识别范围默认值是 `basic`（仅基础资料），
且代码中「用户手动选了非 all 模式时优先用手动值」：

```251:251:frontend/src/views/paint/work-order/index.vue
const batchOcrFillMode = ref<'basic' | 'items' | 'all'>('basic');
```

```317:319:frontend/src/views/paint/work-order/index.vue
      // 如果用户手动选了非all模式，优先用手动选择；否则用智能模式
      const effectiveMode = batchOcrFillMode.value !== 'all' ? batchOcrFillMode.value : smartMode;
      formData.append('ocrMode', effectiveMode);
```

**后果**：不去手动切「仅部位 / 全部识别」，跑完只会填车牌、工单号，部位永远为空，
且因为「无有效数据」被计入 `skipped`，用户会误以为"OCR 不认识部位"。

> 同样的问题存在于 `快速录入`（`quickOcrMode` 默认 `basic`）。

### 硬伤 ②：零容错精确匹配，差一个字就废

```213:223:backend/apps/base-system/src/api/paint/service/ocr.service.ts
    return llmItems.map(item => {
      const matchedName = item.matchedName || '';
      const categoryId = nameToId[matchedName] || '';
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

`nameToId[matchedName]` 是全等查表，没有任何归一化 / 别名 / 模糊兜底。
讯锐的 `paint_standard_template_item.alias` 与 `paint_standard.alias` **均为 0 条**，
等于裸奔。

### 硬伤 ③（最危险）：匹配到模板外部位 → 幅数静默算成 0

prompt 注入的候选是**全部 68 个全局部位**（`shopId IS NULL`），
但讯锐模板只有 **45 个**。一旦 LLM 选中了模板外的部位：

```143:145:backend/apps/base-system/src/api/paint/service/work-order.service.ts
      const templateItem = templateItemMap.get(item.categoryId);
      const coefficient = templateItem?.coefficient ?? 0;
      const newPartAddition = templateItem?.newPartAddition ?? 0;
```

系数取 0 → 该条幅数 = 0 → **不报错、不提示、直接落库**。
同理存在于 OCR 建单路径：

```185:187:backend/apps/base-system/src/api/paint/service/work-order.service.ts
        const templateItem = templateItemMap.get(item.categoryId);
        const coefficient = templateItem?.coefficient ?? 0;
        const newPartAddition = templateItem?.newPartAddition ?? 0;
```

**12 月是要对账的月份，静默 0 幅数 = 直接少算钱，属于必须止血的 P0。**

### 附带问题

- `rawText` 恒为空：prompt 未要求模型输出（`llm-ocr.service.ts:117-123`），失配后无法二次补救。
- 无置信度：`OcrItem` 只有布尔 `matched`，前端分不出「高置信」和「瞎猜」，只能全量核对。

---

## 四、方案总览

| 期 | 内容 | 改动面 | 预期效果 |
|---|---|---|---|
| **P0 止血** | 候选收窄到门店模板 + 系数缺失不再静默为 0 + 前端默认识别范围修正 | 3 个文件，无库表变更 | 消除错账风险，现有 59.5% 命中率可安全使用 |
| **P1 提准确率** | L0 归一化 + L1 多级字典 + L2 模糊匹配 + L3 频次先验 + prompt 补 `rawText`/`confidence` | 3 个文件 + 1 个共享模块 | 项命中率 59.5% → **85%+** |
| **P2 闭环（可选）** | 置信度分级前端展示 + 人工校正回写别名库 | 前端 1 个文件 + 1 张新表 | 越用越准，人工只审低置信项 |

> P1/P2 的详细设计与 `ocr-category-matching-final-plan.md` 一致，
> 本方案在其基础上**补充了实测基线与 P0 止血项**（原方案缺 P0）。

---

## 五、P0 止血（建议立即执行）

### P0-1：OCR 部位候选收窄到「门店模板内」

**文件**：`backend/apps/base-system/src/api/paint/service/ocr.service.ts`

现状两处都在查全量部位：

```140:148:backend/apps/base-system/src/api/paint/service/ocr.service.ts
    const categories = await this.prisma.paintItemCategory.findMany({
      where: {
        OR: [
          { shopId: null },
          { shopId },
        ],
      },
      orderBy: { sortOrder: 'asc' },
    });
```

```178:185:backend/apps/base-system/src/api/paint/service/ocr.service.ts
    const categories = await this.prisma.paintItemCategory.findMany({
      where: {
        OR: [
          { shopId: null },
          { shopId },
        ],
      },
    });
```

**改为**：以门店 `standardTemplate.items[].categoryId` ∪ `paint_standard.categoryId`（门店专属标准）为候选集。
这样 LLM 只能选讯锐模板里真实存在、且有系数的 45 个部位，从源头杜绝「无系数部位」。

> 注意：收窄后 LLM 选不到时 `matchedName` 返回空，此时应**回退**到全量匹配一次（带 `matched=false` 标记 + `rawText`），
> 仅用于提示用户「图片上的『XX』不在本店模板内」，**不写入工单**。

### P0-2：系数缺失不再静默为 0

**文件**：`backend/apps/base-system/src/api/paint/service/work-order.service.ts`

对 `calculateItemsPaintCount` 与 `quickCreate` 两处：
系数查不到时**不要 `?? 0`**，改为在 OCR 建单 / OCR 填充路径上**跳过该项并收集 warning 返回前端**；
手工录入路径保留 `?? 0`（用户明确选择了该部位，由用户负责）。

建议返回结构：

```ts
// 在 updateWorkOrder / quickCreate 的响应中带上，前端 toast 提示
ocrWarnings: ['图片上的「前杠」未匹配到本店模板部位，已跳过']
```

### P0-3：前端识别范围默认值修正

**文件**：`frontend/src/views/paint/work-order/index.vue`

- `batchOcrFillMode` 默认值 `'basic'` → `'all'`（走智能推荐：基础字段已填且无部位时自动选 `items`）。
- 「识别范围 = 仅基础资料」的提示文案补充说明：**选此项不会识别部位**。
- `quickOcrMode`（快速录入）同样处理。

### P0 验收

在测试环境对同一批 20 张图重跑，确认：

- 项命中率不低于 59.5%（不应下降）
- **0 幅数的工单项数量 = 0**
- 未匹配项在结果详情里有明确 warning，而非静默跳过

---

## 六、P1 提准确率

### L0 归一化（先于任何匹配，双侧同一套清洗）

- 去空白 / 全角空格，全角 → 半角，繁 → 简
- 去无意义词缀：`喷漆 / 喷 / 做漆 / 油漆 / 修复 / 翻新 / 部位 / 项`
  （**注意：`半喷`、`里外`、`内侧` 是有业务含义的，不可去**）
- 去掉方位词前缀：`左前叶 → 叶`、`右后门 → 门`（讯锐模板无左右区分）
- 统一括号 `（）→ ()`，中文数字 → 阿拉伯数字

### L1 多级字典（按优先级，命中即返回并记录 `matchLevel`）

| 优先级 | 来源 | 现状 |
|---|---|---|
| 1 | 门店模板内 `paint_item_category.name` | ✅ |
| 2 | `paint_item_category.code` | ✅ |
| 3 | `paint_standard_template_item.alias` | ✅（讯锐 0 条） |
| 4 | `paint_standard.alias`（门店标准） | ❌ 未用，需补 |
| 5 | `paint_shop.categoryAliasMap`（**已有 CRUD 接口**） | ❌ 未用，需补 |
| 6 | 内置别名字典 `CATEGORY_NAME_ALIASES`（23 标准名 / 46 别名） | ❌ 未用（仅 Excel 链路） |
| 7 | 学习库别名（P2 沉淀） | ❌ 未建 |

关于第 5 项：`GET/PUT /paint/shop/:id/category-alias-map` 接口**已经存在**，
无需新建表即可维护门店别名：

```84:98:backend/apps/base-system/src/api/paint/shop/rest/shop.controller.ts
  @Get(':id/category-alias-map')
  @ApiOperation({ summary: '获取门店部位别名映射' })
  async getCategoryAliasMap(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
```

> ⚠️ 注意语义：`categoryAliasMap` 是「标准名/Excel 列名 → [code 或 categoryId]」，
> 与 OCR 需要的「别名 → 标准名」方向相反，接入时需双向索引。
> 讯锐当前已配置 13+ 条（后盖/机盖/车门/前后杠/叶子板…），可直接反向利用。

关于第 6 项：`CATEGORY_NAME_ALIASES` 现在硬编码在
`backend/apps/base-system/src/api/paint/service/work-order-excel.service.ts:39-64`，
建议抽成共享模块 `paint-category-alias.ts`，OCR 与 Excel 两条链路共用。

### L2 模糊匹配（吃掉「差一个字」）

L1 未命中时启用，按门店维度：

- 双向包含：最长公共子串 / 最长公共子序列打分
- 编辑距离：长度 ≤ 4 阈值 1，更长阈值 2
- 首尾字锚定：`XX盖` → 强约束到以「盖」结尾的部位
- 打分：`score = 0.5 * LCS相似度 + 0.3 * (1 - 归一化编辑距离) + 0.2 * 首字命中`

**关键约束**：仅当 top1 与 top2 分差 ≥ 0.1 时才自动采纳；
否则判为「歧义」，返回 top3 候选交人工选择，**不自动写入**。

对本次实测的失配样本，L2 预期可救回：

| 原文 | 目标 | LCS/锚定 | 预期 |
|---|---|---|---|
| 前杠 | 前后杠 | 包含 + 尾字「杠」 | ✅ |
| 左前叶 | 叶子板 | 去方位词后首字「叶」+ 锚定 | ✅ |

### L3 频次先验（消歧 + 兜底）

从 `paint_work_order_item` 按门店统计各部位历史频次：

- L2 歧义时用频次给候选排序
- 完全失配时给前端推荐「本店最常用 5 个部位」快捷条

只需要现有 `categoryId` 即可计算，无需原文。

### prompt 增强

**文件**：`backend/apps/base-system/src/api/paint/service/llm-ocr.service.ts:117-123`

- 候选列表**带编号**注入，要求模型返回 `categoryIndex` + `rawText` + `confidence`，禁止自由输出部位名
- 编号解析失败时回退用 `matchedName` 走 L0-L2，安全兜底
- 保持 `temperature=0.1`，延续内容寻址缓存（`sha256(buffer)+mode`）

### P1 验收

在同一批 20 张（建议扩到 50 张）基线上重跑：

| 指标 | 当前 | P1 目标 |
|---|---|---|
| 项命中率 | 59.5% | ≥ 85% |
| 单命中率 | 55% | ≥ 80% |
| 自动采纳率（人工未改） | 未知（基线未采） | ≥ 75% |
| 0 幅数项 | 存在风险 | **0** |

---

## 七、P2 校正闭环（可选，长期收益最大）

1. **置信度分级前端展示**
   - 高置信（exact/alias，confidence ≥ 0.9）：正常展示，不打扰
   - 中置信（fuzzy）：黄底 + tooltip「由『前保险杠』模糊匹配为『前后杠』，点击可改」
   - 低置信 / 歧义：标红 + 展开 top3 快捷切换按钮
2. **人工校正回写**
   - 新增 `POST /paint/work-order/ocr-correction`，body `{ shopId, rawText, fromCategoryId, toCategoryId }`
   - 落库到学习表（建议复用 `categoryAliasMap`，或新建 `PaintOcrCategoryAlias`）
   - `manual` 来源直接生效；`llm` 来源需被人工确认 3 次才转正式别名，避免把模型错误固化
3. **图片池建单补 items 识别**：当前 `pending-image.service.ts` 固定 `basic`，不识别部位

---

## 八、落地步骤与排期

| 步骤 | 内容 | 涉及文件 | 预估 |
|---|---|---|---|
| 1 | 摸底 SQL，确认各门店模板部位数 / 别名覆盖 | — | 0.5h |
| 2 | P0-1 候选收窄到门店模板 | `ocr.service.ts` | 2h |
| 3 | P0-2 系数缺失不再静默 0 | `work-order.service.ts` | 1.5h |
| 4 | P0-3 前端识别范围默认值 | `work-order/index.vue` | 0.5h |
| 5 | 20 张基线回归，确认命中率不降、0 幅数项为 0 | — | 1h |
| 6 | **→ 此时可安全跑讯锐 12 月全量 72 单** | — | — |
| 7 | P1 L0 归一化 + L1 多级字典 + 别名共享模块 | `ocr.service.ts` + 新增 `paint-category-alias.ts` | 4h |
| 8 | P1 L2 模糊匹配 + L3 频次先验 | `ocr.service.ts` | 4h |
| 9 | P1 prompt 增强（rawText / confidence / 编号） | `llm-ocr.service.ts` | 2h |
| 10 | 50 张基线回归 + 灰度 1 家门店 | — | 2h |
| 11 | P2 置信度分级 + 校正回写 | 前端 + 新表 | 8h |

**P0 合计约 1 人日，P1 合计约 1.5 人日。**

---

## 九、临时操作指引（P0 完成前，如需紧急处理 12 月）

可以跑，但**必须**按下面做，否则有错账风险：

1. 工单管理 → 筛选门店「佛山瑞华比亚迪(讯锐)」+ 日期 2025-12
2. 点「批量 OCR 填充」→ **识别范围手动切到「仅部位」**（不要留默认的「仅基础资料」）
3. 处理范围先选 **10 单**试跑
4. 跑完后**逐单打开核对**：
   - 部位是否正确
   - **重点检查幅数是否为 0**（为 0 说明匹配到了模板外部位，需手工改）
5. 10 单人工确认无误后，再放开剩余约 62 单

预期：72 单中约 40 单能自动选中部位，剩余 32 单仍需人工（其中约 14 单是图片本身识别不到部位）。

---

## 十、风险与回滚

| 风险 | 影响 | 应对 |
|---|---|---|
| 候选收窄导致某些门店命中率下降 | 中 | 加灰度开关 `ocrCategoryScope: template \| all`，默认 `template`，单店可切回 |
| 模糊匹配误匹配 | 高（错账） | 仅唯一高分自动采纳；先只读观察一周再放开自动写入 |
| 批量 OCR 覆盖已有部位 | 高 | 现有逻辑已保证「只填空、不覆盖」，且要求工单无有效项目；勿改此语义 |
| LLM 调用成本 | 低 | 72 单约 72 次调用，2-4 秒/张；已有内容寻址缓存，重跑零成本 |
| 12 月已结算 8 单被误改 | 中 | 现有逻辑已过滤（仅 DRAFT/PENDING）；确认封单状态 |

**回滚**：P0/P1 均为纯逻辑改动，无库表结构变更，回滚 = 还原代码 + 灰度开关切 `legacy`。

---

## 十一、涉及文件清单

| 文件 | 期 | 改动类型 |
|---|---|---|
| `backend/apps/base-system/src/api/paint/service/ocr.service.ts` | P0/P1 | 候选收窄 + 重写 `matchItemsToCategories`（归一化/多级字典/模糊/频次） |
| `backend/apps/base-system/src/api/paint/service/work-order.service.ts` | P0 | 系数缺失不再静默 0，返回 warning |
| `backend/apps/base-system/src/api/paint/service/llm-ocr.service.ts` | P1 | prompt 增强（编号选择 + rawText + confidence） |
| `backend/apps/base-system/src/api/paint/service/work-order-excel.service.ts` | P1 | `CATEGORY_NAME_ALIASES` 抽共享模块 |
| `backend/apps/base-system/src/api/paint/service/pending-image.service.ts` | P2 | 建单时补 items 识别 |
| `backend/apps/base-system/src/api/paint/work-order/rest/work-order.controller.ts` | P2 | 新增 `ocr-correction` 接口 |
| `frontend/src/views/paint/work-order/index.vue` | P0/P2 | 识别范围默认值 + 置信度分级 |
| 新增 `backend/apps/base-system/src/api/paint/service/paint-category-alias.ts` | P1 | 共享别名字典模块 |

---

## 十二、待拍板项

1. **P0 是否立即执行？** 建议是——12 月要对账，静默 0 幅数风险不能留。
2. **内置别名字典是否落库？** 建议首批导入 `paint_shop.categoryAliasMap` 作全局基线（可编辑，比硬编码好维护）。
3. **模糊匹配是否先只读观察一周**再放开自动采纳？建议是，避免误匹配直接进账。
4. **12 月紧急处理**：是先按第九节手工跑一遍救急，还是等 P0 完成（约 1 人日）后自动跑？
5. **图片池是否开启部位识别**（P2）？会翻倍图片池 OCR 成本。

---

## 附：摸底 SQL

```sql
-- 1) 各门店模板部位数 vs 全局部位数
SELECT s.code, s.name,
       (SELECT COUNT(*) FROM paint_standard_template_item WHERE template_id = s.standard_template_id) tpl_items,
       (SELECT COUNT(*) FROM paint_item_category WHERE shop_id IS NULL) global_cat
FROM paint_shop s;

-- 2) 讯锐 2025-12 目标工单（有图 + 无部位 + 未审核）
SELECT o.id, o.order_no, o.status
FROM paint_work_order o
WHERE o.shop_id = 'cmr0sa6c20000qr1k4xb9hags'
  AND o.order_date >= '2025-12-01' AND o.order_date < '2026-01-01'
  AND o.status IN ('DRAFT', 'PENDING')
  AND EXISTS (SELECT 1 FROM paint_work_order_image i WHERE i.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM paint_work_order_item t WHERE t.order_id = o.id);

-- 3) P0 验收：检查是否存在 0 幅数的工单项（应为 0 行）
SELECT w.id, w.order_no, i.category_id, i.calculated_value
FROM paint_work_order_item i
JOIN paint_work_order w ON w.id = i.order_id
WHERE w.shop_id = 'cmr0sa6c20000qr1k4xb9hags'
  AND w.order_date >= '2025-12-01' AND w.order_date < '2026-01-01'
  AND i.calculated_value = 0;

-- 4) 门店部位频次（L3 用）
SELECT c.name, COUNT(*) cnt
FROM paint_work_order_item i
JOIN paint_item_category c ON c.id = i.category_id
JOIN paint_work_order w ON w.id = i.order_id
WHERE w.shop_id = 'cmr0sa6c20000qr1k4xb9hags'
GROUP BY c.name ORDER BY cnt DESC LIMIT 20;
```
