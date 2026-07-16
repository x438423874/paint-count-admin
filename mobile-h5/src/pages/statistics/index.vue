<script setup lang="ts">
import { getMonthlyStatistics, getCategoryBreakdown, getShopComparison, getShopList, getStatisticsOverview, getLatestSettlementMonth } from '@/api/paint'
import type { MonthlyStatistics, CategoryBreakdown, ShopComparison, PaintShop, DailyStat, StatisticsOverview } from '@/api/types/paint'

const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

const selectedMonth = ref(currentMonth)
const selectedShopId = ref('')
const shops = ref<PaintShop[]>([])
const monthlyData = ref<MonthlyStatistics[]>([])
const dailyData = ref<DailyStat[]>([])
const categoryData = ref<CategoryBreakdown[]>([])
const shopData = ref<ShopComparison[]>([])
const overview = ref<StatisticsOverview | null>(null)
const loading = ref(false)
const refreshing = ref(false)

const showMonthPicker = ref(false)
const showShopPicker = ref(false)

async function initDefaultMonth() {
  try {
    const latest = await getLatestSettlementMonth()
    const latestMonth = (latest as any as string | null) || currentMonth
    selectedMonth.value = latestMonth
  }
  catch {
    selectedMonth.value = currentMonth
  }
}

const monthColumns = computed(() => {
  const now = new Date()
  const list = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    list.push({ text: value, value })
  }
  return list
})

const shopColumns = computed(() => {
  const cols = [{ text: '全部门店', value: '' }]
  shops.value.forEach(s => cols.push({ text: s.name, value: s.id }))
  return cols
})

async function loadShops() {
  try {
    const res = await getShopList()
    shops.value = res as any as PaintShop[]
  }
  catch {
    shops.value = []
  }
}

async function loadStatistics() {
  loading.value = true
  try {
    const [monthly, category, shop, overviewRes] = await Promise.all([
      getMonthlyStatistics(selectedMonth.value, selectedShopId.value || undefined),
      getCategoryBreakdown(selectedMonth.value, selectedShopId.value || undefined),
      getShopComparison(selectedMonth.value),
      getStatisticsOverview(selectedMonth.value, selectedShopId.value || undefined),
    ])
    monthlyData.value = monthly as any as MonthlyStatistics[]
    dailyData.value = monthlyData.value.flatMap(m => m.dailyStats || [])
    categoryData.value = category as any as CategoryBreakdown[]
    shopData.value = shop as any as ShopComparison[]
    overview.value = (overviewRes as any as StatisticsOverview) || null
  }
  catch {
    // ignore
  }
  finally {
    loading.value = false
  }
}

async function onRefresh() {
  refreshing.value = true
  await loadStatistics()
  refreshing.value = false
}

const totalPaintCount = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.totalPaintCount || 0), 0))
const totalOrderCount = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.totalOrders || 0), 0))
const totalVehicleCount = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.totalVehicles || 0), 0))
const avgPaintPerVehicle = computed(() => totalVehicleCount.value > 0 ? +(totalPaintCount.value / totalVehicleCount.value).toFixed(1) : 0)

function onMonthConfirm({ selectedValues }: any) {
  selectedMonth.value = selectedValues[0]
  showMonthPicker.value = false
  loadStatistics()
}

function onShopConfirm({ selectedValues }: any) {
  selectedShopId.value = selectedValues[0]
  showShopPicker.value = false
  loadStatistics()
}

function formatCount(val: number | undefined) {
  if (val === undefined || val === null) return '0'
  if (Number.isInteger(val)) return String(val)
  return val.toFixed(1).replace(/\.0$/, '')
}

const maxDailyPaint = computed(() => Math.max(...dailyData.value.map(d => d.paintCount || 0), 1))
const maxCategoryPaint = computed(() => Math.max(...categoryData.value.map(c => c.totalPaintCount || c.paintCount || 0), 1))

function getDailyBarHeight(count: number) {
  const percent = Math.round((count / maxDailyPaint.value) * 100)
  return `${Math.max(percent, 4)}%`
}

function getCategoryBarWidth(count: number) {
  const percent = Math.round((count / maxCategoryPaint.value) * 100)
  return `${Math.max(percent, 4)}%`
}

onMounted(async () => {
  await loadShops()
  await initDefaultMonth()
  loadStatistics()
})
</script>

<template>
  <div class="stats-page">
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <!-- 顶部蓝色区域 -->
      <div class="header">
        <div class="header-content">
          <div class="header-top">
            <div class="greeting">
              <div class="greeting-text">
                数据统计
              </div>
              <div class="greeting-sub">
                {{ selectedShopId ? shops.find(s => s.id === selectedShopId)?.name : '全部门店' }} · {{ selectedMonth }}
              </div>
            </div>
            <div class="header-actions">
              <div class="action-pill" @click="showMonthPicker = true">
                <van-icon name="calendar-o" color="#fff" size="13" />
                <span>{{ selectedMonth }}</span>
                <van-icon name="arrow-down" color="rgba(255,255,255,0.7)" size="10" />
              </div>
              <div class="action-pill" @click="showShopPicker = true">
                <van-icon name="shop-o" color="#fff" size="13" />
                <span>{{ selectedShopId ? shops.find(s => s.id === selectedShopId)?.name : '全部门店' }}</span>
                <van-icon name="arrow-down" color="rgba(255,255,255,0.7)" size="10" />
              </div>
            </div>
          </div>

          <!-- 核心数据横幅 -->
          <div class="hero-stats">
            <div class="hero-item">
              <div class="hero-value">
                {{ formatCount(totalPaintCount) }}
              </div>
              <div class="hero-label">
                总幅数
              </div>
            </div>
            <div class="hero-divider" />
            <div class="hero-item">
              <div class="hero-value">
                {{ totalOrderCount }}
              </div>
              <div class="hero-label">
                工单数
              </div>
            </div>
            <div class="hero-divider" />
            <div class="hero-item">
              <div class="hero-value">
                {{ totalVehicleCount }}
              </div>
              <div class="hero-label">
                车辆数
              </div>
            </div>
            <div class="hero-divider" />
            <div class="hero-item">
              <div class="hero-value">
                {{ avgPaintPerVehicle }}
              </div>
              <div class="hero-label">
                台均幅数
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="loading" class="skeleton-wrap">
        <van-skeleton title :row="4" />
      </div>

      <template v-else>
        <!-- 状态概览 -->
        <div class="section">
          <div class="section-header">
            <div class="section-title">
              工单状态
            </div>
          </div>
          <div v-if="!overview" class="empty-mini">
            暂无数据
          </div>
          <div v-else class="status-grid">
            <div class="status-card pending">
              <div class="status-value">
                {{ overview.pendingOrders }}
              </div>
              <div class="status-label">
                待审核
              </div>
            </div>
            <div class="status-card audited">
              <div class="status-value">
                {{ overview.auditedOrders }}
              </div>
              <div class="status-label">
                已审核
              </div>
            </div>
            <div class="status-card settled">
              <div class="status-value">
                {{ overview.settledOrders }}
              </div>
              <div class="status-label">
                已结算
              </div>
            </div>
            <div class="status-card abnormal">
              <div class="status-value">
                {{ overview.abnormalOrders }}
              </div>
              <div class="status-label">
                异常
              </div>
            </div>
            <div class="status-card rework">
              <div class="status-value">
                {{ overview.reworkOrders || 0 }}
              </div>
              <div class="status-label">
                返工
              </div>
            </div>
          </div>
          <div v-if="overview" class="rate-row">
            <div class="rate-item">
              <span class="rate-label">审核率</span>
              <span class="rate-value">{{ overview.auditRate }}%</span>
            </div>
            <div class="rate-item">
              <span class="rate-label">结算率</span>
              <span class="rate-value">{{ overview.settlementRate }}%</span>
            </div>
            <div class="rate-item">
              <span class="rate-label">单均幅数</span>
              <span class="rate-value">{{ formatCount(overview.avgPaintPerOrder) }}</span>
            </div>
          </div>
        </div>

        <!-- 每日趋势 -->
        <div v-if="dailyData.length > 0" class="section">
          <div class="section-header">
            <div class="section-title">
              每日幅数趋势
            </div>
          </div>
          <div class="bar-chart-scroll">
            <div class="bar-chart" :style="{ width: `${Math.max(dailyData.length * 36, 100)}px` }">
              <div v-for="item in dailyData" :key="item.date" class="bar-item">
                <div class="bar-value">
                  {{ item.paintCount }}
                </div>
                <div class="bar-wrap">
                  <div class="bar" :style="{ height: getDailyBarHeight(item.paintCount) }" />
                </div>
                <span class="bar-label">{{ item.date.slice(8) }}日</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 部位分布 -->
        <div v-if="categoryData.length > 0" class="section">
          <div class="section-header">
            <div class="section-title">
              部位幅数分布
            </div>
          </div>
          <div class="category-list">
            <div v-for="cat in categoryData" :key="cat.categoryId" class="category-item">
              <div class="category-header">
                <span class="category-name">{{ cat.categoryName }}</span>
                <span class="category-count">{{ formatCount(cat.totalPaintCount || cat.paintCount || 0) }} 幅</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: getCategoryBarWidth(cat.totalPaintCount || cat.paintCount || 0) }" />
              </div>
            </div>
          </div>
        </div>

        <!-- 门店对比 -->
        <div v-if="!selectedShopId && shopData.length > 0" class="section">
          <div class="section-header">
            <div class="section-title">
              门店对比
            </div>
          </div>
          <div class="shop-list">
            <div v-for="(shop, idx) in shopData" :key="shop.shopId" class="shop-item">
              <div class="shop-rank" :class="{ top: idx < 3 }">
                {{ idx + 1 }}
              </div>
              <div class="shop-main">
                <div class="shop-info">
                  <span class="shop-name">{{ shop.shopName }}</span>
                  <span class="shop-sub">{{ shop.totalVehicles }} 台车 / {{ shop.totalOrders }} 单</span>
                </div>
                <div class="shop-count">
                  <span class="count-value">{{ formatCount(shop.totalPaintCount) }}</span>
                  <span class="count-unit">幅</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div style="height: 80px;" />
    </van-pull-refresh>

    <!-- 月份选择器 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        :model-value="[selectedMonth]"
        @confirm="onMonthConfirm"
        @cancel="showMonthPicker = false"
      />
    </van-popup>

    <!-- 门店选择器 -->
    <van-popup v-model:show="showShopPicker" position="bottom" round>
      <van-picker
        :columns="shopColumns"
        :model-value="[selectedShopId]"
        @confirm="onShopConfirm"
        @cancel="showShopPicker = false"
      />
    </van-popup>
  </div>
</template>

<route lang="json5">
{
  name: 'Statistics'
}
</route>

<style lang="less" scoped>
.stats-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 80px;
}

.header {
  background: linear-gradient(135deg, #1677ff 0%, #4096ff 100%);
  border-radius: 0 0 24px 24px;
  padding: 44px 16px 24px;
  color: #fff;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.greeting-text {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 6px;
}

.greeting-sub {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
}

.header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.action-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  padding: 5px 10px;
  font-size: 12px;
  color: #fff;
  backdrop-filter: blur(10px);
}

.hero-stats {
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 18px 10px;
  backdrop-filter: blur(10px);
}

.hero-item {
  flex: 1;
  text-align: center;
}

.hero-value {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
}

.hero-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.hero-divider {
  width: 1px;
  height: 28px;
  background: rgba(255, 255, 255, 0.25);
}

.skeleton-wrap {
  margin: 16px;
  padding: 16px;
  background: #fff;
  border-radius: 16px;
}

.section {
  margin: 16px;
  background: #fff;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.03);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.empty-mini {
  text-align: center;
  padding: 24px 0;
  font-size: 13px;
  color: #999;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.status-card {
  border-radius: 12px;
  padding: 12px 2px;
  text-align: center;
}

.status-card.pending {
  background: #fff7e6;
}

.status-card.audited {
  background: #e6f7ff;
}

.status-card.settled {
  background: #f6ffed;
}

.status-card.abnormal {
  background: #fff1f0;
}

.status-card.rework {
  background: #fff0f3;
}

.status-value {
  font-size: 18px;
  font-weight: 700;
  color: #333;
}

.status-label {
  font-size: 11px;
  color: #666;
  margin-top: 2px;
}

.rate-row {
  display: flex;
  justify-content: space-around;
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid #f0f0f0;
}

.rate-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.rate-label {
  font-size: 12px;
  color: #999;
}

.rate-value {
  font-size: 16px;
  font-weight: 700;
  color: #1677ff;
}

.bar-chart-scroll {
  overflow-x: auto;
  padding-bottom: 8px;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 150px;
  padding-top: 20px;
}

.bar-item {
  flex: 1;
  min-width: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.bar-value {
  font-size: 10px;
  color: #666;
}

.bar-wrap {
  width: 20px;
  height: 90px;
  background: #f0f0f0;
  border-radius: 10px;
  position: relative;
  overflow: hidden;
}

.bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(180deg, #1677ff 0%, #4096ff 100%);
  border-radius: 10px 10px 0 0;
}

.bar-label {
  font-size: 10px;
  color: #999;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.category-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.category-name {
  font-size: 13px;
  color: #333;
}

.category-count {
  font-size: 13px;
  font-weight: 600;
  color: #1677ff;
}

.progress-bar {
  height: 8px;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1677ff 0%, #4096ff 100%);
  border-radius: 4px;
}

.shop-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shop-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: #f8fafc;
  border-radius: 12px;
}

.shop-rank {
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background: #e8e8e8;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.shop-rank.top {
  background: #1677ff;
  color: #fff;
}

.shop-main {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.shop-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.shop-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.shop-sub {
  font-size: 12px;
  color: #999;
}

.shop-count {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.count-value {
  font-size: 18px;
  font-weight: 700;
  color: #1677ff;
}

.count-unit {
  font-size: 11px;
  color: #999;
}
</style>
