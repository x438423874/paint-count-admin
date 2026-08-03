# 设计令牌与设计规范（Design Tokens）

> 目的：统一 `paint-count-admin` 两个前端（后台 `frontend` 与移动端 `mobile-h5`）的视觉语言，让「改品牌色只改一处」成为约定。

## 1. 品牌主色（唯一真相源）

统一主色：**`#2563EB`**（喷漆主题蓝，白字对比度 ~5.2，满足 WCAG AA）。

| 端 | 文件 | 字段 | 机制 |
|---|---|---|---|
| 后台 `frontend` | `src/theme/settings.ts` | `themeColor: '#2563eb'` | Naive UI `themeOverrides` 由 `src/theme/shared.ts` 程序化派生其余色（含 `info` 跟随主色） |
| 移动端 `mobile-h5` | `src/styles/var.less` | `--color-primary: #2563eb` | CSS 变量，覆盖 vant 主题 |

**约定（必读）**
- ❌ 禁止在业务代码里硬编码品牌色（如 `#1677ff` / `#646cff` / `#4096ff` 等历史值）。
- ✅ 后台一律走 `themeColor` 派生；H5 一律使用 `var(--color-primary)`（渐变中用 `color-mix(in srgb, var(--color-primary) 60%, #fff)` 取主色淡变）。
- 🔁 **要换品牌色，只改上面两处**，两端自动同步。

## 2. 完整令牌表

### 后台 `frontend`（Naive UI + SA Admin 主题）
| 令牌 | 值 |
|---|---|
| 主色 primary | `#2563EB`（由 `themeColor` 派生 50–950 色阶，可用 `rgb(var(--primary-color))` / `var(--primary-50-color)` 等） |
| success / warning / error / info | `#52c41a` / `#faad14` / `#f5222d` / `#2080f0`（默认 `isInfoFollowPrimary=true` 时跟随主色 `#2563eb`） |
| 圆角 radius | `8px`（`themeOverrides` 中统一设置，已与 H5 `--border-radius: 8px` 对齐） |
| 布局底色 layout | `rgb(247, 250, 252)`（类 `bg-layout`） |
| 暗色模式 | 支持（切换 `darkMode`） |

### 移动端 `mobile-h5`（vant + CSS 变量）
| 令牌 | 值 |
|---|---|
| 主色 `--color-primary` | `#2563EB` |
| 表面/文字/边框 `--color-bg`、`--color-text`、`--color-border` 等 | 见 `var.less` |
| 圆角 `--radius-sm/md/lg` | `6 / 10 / 16 px` |
| 间距 `--space-*` | `4 / 8 / 12 / 16 px` |
| 阴影 `--shadow-*` | 见 `var.less` |
| 暗色模式 | 支持（`isDark` + `van-config-provider`） |

## 3. 空状态规范（Empty State）

- **后台**：使用共享组件 `src/components/common/EmptyState.vue`。
  - 基础：`<EmptyState description="暂无数据" />`
  - 带操作：`<EmptyState description="暂无工单数据"><template #action><NButton ...>点击新建</NButton></template></EmptyState>`
  - 所有 `NDataTable` 列表页都应提供统一的空状态（避免裸「暂无数据」纯文本）。
- **移动端**：使用 `van-empty`，描述文案统一为「暂无xxx数据」，与列表数据为空时的条件渲染一致。

## 4. 其他约定
- 表格行 hover 使用主题感知写法：`color-mix(in srgb, rgb(var(--primary-color)) 8%, transparent)`，禁止硬编码 `rgba(100,100,100,.1)`（暗色下会发灰）。
- 设计令牌优先于一次性色值；新增颜色先评估是否应进入令牌表。

## 5. 图表色板（ECharts）

所有 ECharts 图表统一从主题令牌取色，避免硬编码散色。封装在 `frontend/src/utils/chart.ts`：

- `getChartPalette()` —— 返回 `{ primary, success, warning, error, info, series[], axis, splitLine, border, text }`。
  - `series`：多系列分类色板 = 品牌主色 + 语义色（success/warning/error/info）+ 文档化装饰强调色（青蓝 `#38bdf8`、紫 `#a78bfa`、玫红 `#fb7185`）。
  - `axis / splitLine / border / text`：随暗色模式自适应的坐标/描边/文字色。
- `primaryGradient(topAlpha, bottomAlpha)` —— 用主色生成纵向渐变（areaStyle / 柱状渐变）。

接入范围（改主色即自动同步，无需改图表代码）：
- 首页看板：`home/modules/line-chart.vue`、`home/modules/pie-chart.vue`、`views/home/index.vue`（汇总卡 / 门店对比进度条 / 部位分布进度条 / 年度趋势柱状渐变）。
- 统计页：`views/paint/statistics/index.vue`（每日趋势、门店对比、年度趋势、项目类别分布）。

**约定**：新增图表一律走 `getChartPalette()`，禁止在 option 里硬编码颜色。

## 6. 品牌视觉令牌（圆角 / 阴影 / 间距）

后台 `frontend` 通过 `src/styles/css/global.css` 暴露一组与 H5 `var.less` 对齐的全局令牌（单一真相源见上文第 1 节）：

| 令牌 | 值 | 说明 |
|---|---|---|
| `--brand-radius` | `8px` | 品牌圆角，与 Naive `borderRadius`、H5 `--border-radius` 一致 |
| `--brand-shadow-1/2/3` | `0 2px 8px / 0 4px 16px / 0 8px 24px rgba(0,0,0,.08/.12/.16)` | 三级悬浮阴影（暗色下自动加深至 `.36/.48/.56`） |
| `--brand-spacing-mini/small/middle/large` | `4 / 8 / 16 / 24 px` | 与 H5 `--space-*` 对齐的间距阶梯 |

**约定**：自定义（非 Naive 组件）的卡片 / 容器需要阴影或统一间距时，使用 `--brand-shadow-*` / `--brand-spacing-*`；圆角统一 `8px`。示例中首页看板卡片已接入 `--brand-shadow-1/2`。

## 7. 全局色令牌（语义色 / 中性灰阶）

后台 `frontend` 在 `src/styles/css/global.css` 暴露语义色与中性灰阶 CSS 变量，作为所有业务组件的取色来源（替代散落的 `#18a058` / `#d03050` / `#f0f0f0` 等硬编码）。明暗两套值，切换 `darkMode` 自动生效。

### 语义色（源：`theme/settings.ts` 的 `otherColor` / `themeColor`）
| 令牌 | 浅色 | 暗色 | 用途 |
|---|---|---|---|
| `--color-primary` | `#2563eb` | 同 | 主色（=主题主色） |
| `--color-info` | `#2080f0` | 同 | 信息蓝 |
| `--color-success` | `#52c41a` | 同 | 成功绿 |
| `--color-warning` | `#faad14` | 同 | 警告橙黄 |
| `--color-error` | `#f5222d` | 同 | 错误红 |
| `--color-success-bg` / `-bg-strong` | `#f6ffed` / `#e8f5e9` | `rgba(82,196,26,.16)` / `.24` | 成功浅底 / 渐变深绿底 |
| `--color-success-border` | `#c8e6c9` | `rgba(82,196,26,.4)` | 成功边框绿 |
| `--color-success-deep` | `#2e7d32` | `#4caf50` | 深绿文字 |
| `--color-warning-bg` | `#fffbe6` | `rgba(250,173,20,.16)` | 警告浅底 |
| `--color-error-bg` | `#fff1f0` | `rgba(245,34,45,.16)` | 错误浅底 |
| `--color-info-bg` | `#e6f4ff` | `rgba(32,128,240,.16)` | 信息浅底 |
| `--text-strong` | `#333333` | `#e6e6e6` | 标题/强调文字（替代散落 `#333`） |
| `--text-invert` | `#1f1f1f` | 同 | 浅底容器上的反色文字 |

### 中性灰阶（背景 / 边框 / 次要文字）
| 令牌 | 浅色 | 暗色 |
|---|---|---|
| `--neutral-50` | `#fafafa` | `#1f1f23` |
| `--neutral-100` | `#f5f5f5` | `#26262b` |
| `--neutral-150` | `#f0f0f0` | `#2e2e34` |
| `--neutral-200` | `#e8e8e8` | `#38383f` |
| `--neutral-220` | `#e5e7eb` | `#303038` |
| `--neutral-300` | `#e0e0e0` | `#45454d` |
| `--neutral-350` | `#cdcde6` | `#3a3a42` |
| `--neutral-400` | `#c2c2c2` | `#5a5a64` |

**接入清单（M5 已切换）**
- 布局/通用：`global-search`（search-result / search-modal / search-footer）、`user-shop-bind-drawer`、`dark-mode-container`、首页 `NProgress` 轨道色。
- 统计/对账：`work-order_reconcile`（差值语义色 + 5 类状态浅底）。
- 工单业务：`work-order-operate-drawer`（含 canvas 选区绿框走 `themeStore.themeColors.success`）、`ocr-correct-modal`、`batch-ocr-modal`、`work-order-detail-modal`、`work-order/index.vue`。

**约定**
- ❌ 禁止在业务组件里硬编码 `#18a058` / `#d03050` / `#f0f0f0` 等散色（它们与本主题语义色不一致，属历史错误值）。
- ✅ 状态色用 `--color-*`；浅底用 `--color-*-bg`；灰底/边框用 `--neutral-*`。
- canvas 取色走 `themeStore.themeColors.*`（非 CSS 变量）。

## 8. H5 令牌对齐（mobile-h5）

H5 端 `mobile-h5/src/styles/var.less` 的语义色已对齐后台 `theme/settings.ts`（原 `#ff4d4f`→`--color-error`、`#fa8c16`/`#ed6a0c`→`--color-warning`、`#07c160`→`--color-success`），并补充中性灰阶、文字三级与暗色映射，使 web/h5 视觉一致（相当于把后台 M5 在 h5 重做一遍）。

### 新增令牌（与后台同源）
- 语义色：`--color-primary/info/success/warning/error`（值同第 7 节）。
- 语义浅底：`--color-success-bg` / `--color-warning-bg` / `--color-error-bg` / `--color-info-bg`。
- 表面/背景/边框：`--color-bg`(#f5f7fa) / `--color-surface`(#fff) / `--color-border`(#f0f0f0) / `--neutral-100`(#f5f5f5) / `--neutral-200`(#e8e8e8)。
- 文字三级：`--text-primary`(#1f1f1f) / `--text-regular`(#333) / `--text-secondary`(#666) / `--text-tertiary`(#999) / `--text-invert`(#fff)。
- 圆角：`--radius-sm/md/lg`；阴影：`--shadow-card`；间距：`--space-xs/sm/md/lg`。

### 接入清单（已切换）
- 登录/个人中心：`login`、`profile`（渐变 banner 统一为 `color-mix(主色 60% #fff)`）。
- 工单：`work-order/detail`、`work-order/index`、`work-order/create`、`work-order/vehicle-history`、`pending-image`（含 JS 状态色映射 `PENDING/MATCHED/MANUAL/FAILED`）。
- 车辆：`vehicle/index`、`vehicle/edit`。
- 统计/首页：`statistics`、`pages/index`。

### 约定与保留项
- ❌ 状态色/灰底/文字禁止硬编码（已清零 247+ 处散色）。
- ✅ 渐变装饰浅色（紫 `#722ed1`/`#b37feb`、warning 浅 `#ffa940`/`#ffc069`、蓝绿 `#10aeff`）作为品牌视觉装饰保留，与后台图表装饰色同策略。
- 白色 `#fff` 作为中性/反色保留（Vant 组件默认），未强制令牌化。
