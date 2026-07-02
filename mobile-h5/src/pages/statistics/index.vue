<script setup lang="ts">
import { getMonthlyStatistics, getCategoryBreakdown, getShopComparison, getShopList } from '@/api/paint'
import type { MonthlyStatistics, CategoryBreakdown, ShopComparison, PaintShop, DailyStat } from '@/api/types/paint'

const currentYear = new Date().getFullYear()
const currentMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

const selectedMonth = ref(currentMonth)
const selectedShopId = ref('')
const shops = ref<PaintShop[]>([])
const monthlyData = ref<MonthlyStatistics[]>([])
const dailyData = ref<DailyStat[]>([])
const categoryData = ref<CategoryBreakdown[]>([])
const shopData = ref<ShopComparison[]>([])
const loading = ref(false)

const showMonthPicker = ref(false)
const showShopPicker = ref(false)

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
    const [monthly, category, shop] = await Promise.all([
      getMonthlyStatistics(selectedMonth.value, selectedShopId.value || undefined),
      getCategoryBreakdown(selectedMonth.value, selectedShopId.value || undefined),
      getShopComparison(selectedMonth.value),
    ])
    monthlyData.value = monthly as any as MonthlyStatistics[]
    dailyData.value = monthlyData.value.flatMap(m => m.dailyStats || [])
    categoryData.value = category as any as CategoryBreakdown[]
    shopData.value = shop as any as ShopComparison[]
  }
  catch {
    // 加载失败保持默认空值
  }
  finally {
    loading.value = false
  }
}

const totalPaintCount = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.totalPaintCount || 0), 0))
const totalOrderCount = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.totalOrders || 0), 0))
const totalVehicleCount = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.totalVehicles || 0), 0))
const avgPaintPerOrder = computed(() => totalOrderCount.value > 0 ? +(totalPaintCount.value / totalOrderCount.value).toFixed(1) : 0)
const avgPaintPerVehicle = computed(() => totalVehicleCount.value > 0 ? +(totalPaintCount.value / totalVehicleCount.value).toFixed(1) : 0)

const pendingOrders = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.pendingOrders || 0), 0))
const pendingPaintCount = computed(() => monthlyData.value.reduce((sum, d) => sum + Number(d.pendingPaintCount || 0), 0))
const pendingVehicles = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.pendingVehicles || 0), 0))
const auditedOrders = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.auditedOrders || 0), 0))
const auditedPaintCount = computed(() => monthlyData.value.reduce((sum, d) => sum + Number(d.auditedPaintCount || 0), 0))
const auditedVehicles = computed(() => monthlyData.value.reduce((sum, d) => sum + (d.auditedVehicles || 0), 0))

const maxPaintCount = computed(() => Math.max(...categoryData.value.map(c => c.totalPaintCount || c.paintCount || 0), 1))

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
  if (val === undefined || val === null)
    return '0'
  if (Number.isInteger(val))
    return String(val)
  // 最多保留1位小数
  return val.toFixed(1).replace(/\.0$/, '')
}

function getBarWidth(count: number) {
  const percent = Math.round((count / maxPaintCount.value) * 100)
  return `${Math.max(percent, 5)}%`
}

onMounted(() => {
  loadShops()
  loadStatistics()
})
</script>

<template>
  <div class="stats-page">
    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-item" @click="showMonthPicker = true">
        <van-icon name="calendar-o" size="16" color="#1677ff" />
        <span class="filter-text">{{ selectedMonth }}</span>
        <van-icon name="arrow" size="12" color="#ccc" />
      </div>
      <div class="filter-item" @click="showShopPicker = true">
        <van-icon name="shop-o" size="16" color="#1677ff" />
        <span class="filter-text">{{ selectedShopId ? shops.find(s => s.id === selectedShopId)?.name : '全部门店' }}</span>
        <van-icon name="arrow" size="12" color="#ccc" />
      </div>
    </div>

    <div v-if="loading" class="loading-wrap">
      <van-loading size="24px">加载中...</van-loading>
    </div>

    <div v-else>
      <!-- 总览卡片 -->
      <div class="overview-cards">
        <div class="overview-card">
          <div class="overview-value">
            {{ formatCount(totalPaintCount) }}
          </div>
          <div class="overview-label">
            总幅数
          </div>
        </div>
        <div class="overview-card">
          <div class="overview-value">
            {{ totalVehicleCount }}
          </div>
          <div class="overview-label">
            车辆数
          </div>
        </div>
        <div class="overview-card">
          <div class="overview-value">
            {{ totalOrderCount }}
          </div>
          <div class="overview-label">
            工单数
          </div>
        </div>
        <div class="overview-card">
          <div class="overview-value">
            {{ avgPaintPerVehicle }}
          </div>
          <div class="overview-label">
            台均幅数
          </div>
        </div>
        <div class="overview-card">
          <div class="overview-value">
            {{ avgPaintPerOrder }}
          </div>
          <div class="overview-label">
            单均幅数
          </div>
        </div>
      </div>

      <!-- 待审核/已审核统计 -->
      <div class="audit-cards">
        <div class="audit-card pending">
          <div class="audit-title">
            待审核
          </div>
          <div class="audit-items">
            <div class="audit-item">
              <span class="audit-value">{{ pendingOrders }}</span>
              <span class="audit-label">工单</span>
            </div>
            <div class="audit-item">
              <span class="audit-value">{{ pendingVehicles }}</span>
              <span class="audit-label">车牌</span>
            </div>
            <div class="audit-item">
              <span class="audit-value">{{ formatCount(pendingPaintCount) }}</span>
              <span class="audit-label">幅数</span>
            </div>
          </div>
        </div>
        <div class="audit-card audited">
          <div class="audit-title">
            已审核
          </div>
          <div class="audit-items">
            <div class="audit-item">
              <span class="audit-value">{{ auditedOrders }}</span>
              <span class="audit-label">工单</span>
            </div>
            <div class="audit-item">
              <span class="audit-value">{{ auditedVehicles }}</span>
              <span class="audit-label">车牌</span>
            </div>
            <div class="audit-item">
              <span class="audit-value">{{ formatCount(auditedPaintCount) }}</span>
              <span class="audit-label">幅数</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 每日幅数趋势 -->
      <div class="chart-section">
        <div class="section-title">
          每日幅数趋势
        </div>
        <van-empty v-if="dailyData.length === 0" description="暂无数据" image="search" />
        <div v-else class="bar-chart-scroll">
          <div class="bar-chart" :style="{ width: `${Math.max(dailyData.length * 28, 100)}px` }">
            <div v-for="item in dailyData" :key="item.date" class="bar-item">
              <div class="bar-wrap">
                <div class="bar" :style="{ height: getBarWidth(item.paintCount) }" />
              </div>
              <span class="bar-label">{{ item.date.slice(8) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 部位幅数分布 -->
      <div class="chart-section">
        <div class="section-title">
          部位幅数分布
        </div>
        <van-empty v-if="categoryData.length === 0" description="暂无数据" image="search" />
        <div v-else class="category-list">
          <div v-for="cat in categoryData" :key="cat.categoryId" class="category-item">
            <div class="category-header">
              <span class="category-name">{{ cat.categoryName }}</span>
              <span class="category-count">{{ formatCount(cat.totalPaintCount || cat.paintCount || 0) }} 幅</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: getBarWidth(cat.totalPaintCount || cat.paintCount || 0) }" />
            </div>
          </div>
        </div>
      </div>

      <!-- 门店对比 -->
      <div v-if="!selectedShopId" class="chart-section">
        <div class="section-title">
          门店对比
        </div>
        <van-empty v-if="shopData.length === 0" description="暂无数据" image="search" />
        <div v-else class="shop-list">
          <div v-for="shop in shopData" :key="shop.shopId" class="shop-item">
            <div class="shop-info">
              <span class="shop-name">{{ shop.shopName }}</span>
              <span class="shop-count">{{ formatCount(shop.totalPaintCount) }} 幅</span>
            </div>
            <div class="shop-detail">
              <span>{{ shop.totalVehicles }} 台车 / {{ shop.totalOrders }} 单</span>
              <span>台均 {{ shop.avgPaintPerVehicle }} 幅 / 单均 {{ shop.avgPaintPerOrder }} 幅</span>
            </div>
            <div class="shop-audit">
              <span class="pending-tag">待审核: {{ shop.pendingOrders }}单 / {{ shop.pendingVehicles }}台 / {{ formatCount(shop.pendingPaintCount) }}幅</span>
              <span class="audited-tag">已审核: {{ shop.auditedOrders }}单 / {{ shop.auditedVehicles }}台 / {{ formatCount(shop.auditedPaintCount) }}幅</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div style="height: 60px;" />

    <!-- 月份选择器 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        @confirm="onMonthConfirm"
        @cancel="showMonthPicker = false"
      />
    </van-popup>

    <!-- 门店选择器 -->
    <van-popup v-model:show="showShopPicker" position="bottom" round>
      <van-picker
        :columns="shopColumns"
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
}

.filter-bar {
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  background: #fff;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: #f5f7fa;
  border-radius: 16px;
}

.filter-text {
  font-size: 13px;
  color: #333;
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.overview-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 16px;
}

.overview-card {
  flex: 0 0 calc(33.33% - 7px);
  background: #fff;
  border-radius: 10px;
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.overview-value {
  font-size: 22px;
  font-weight: 700;
  color: #1677ff;
}

.overview-label {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.audit-cards {
  display: flex;
  gap: 10px;
  padding: 0 16px;
  margin-bottom: 12px;
}

.audit-card {
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.audit-card.pending {
  border-left: 3px solid #f0a020;
}

.audit-card.audited {
  border-left: 3px solid #18a058;
}

.audit-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.audit-card.pending .audit-title {
  color: #f0a020;
}

.audit-card.audited .audit-title {
  color: #18a058;
}

.audit-items {
  display: flex;
  justify-content: space-around;
}

.audit-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.audit-value {
  font-size: 20px;
  font-weight: 700;
  color: #333;
}

.audit-label {
  font-size: 11px;
  color: #999;
}

.chart-section {
  margin: 12px 16px;
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 12px;
}

.bar-chart-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 150px;
  padding-bottom: 20px;
}

.bar-item {
  flex: 0 0 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.bar {
  width: 70%;
  background: linear-gradient(180deg, #1677ff, #69b1ff);
  border-radius: 4px 4px 0 0;
  min-height: 4px;
}

.bar-label {
  font-size: 10px;
  color: #999;
  margin-top: 4px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.category-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  background: #f0f5ff;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1677ff, #4096ff);
  border-radius: 4px;
  min-width: 8px;
}

.shop-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shop-item {
  padding: 10px;
  background: #f8f9fa;
  border-radius: 6px;
}

.shop-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.shop-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.shop-count {
  font-size: 13px;
  color: #1677ff;
}

.shop-detail {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  font-size: 12px;
  color: #999;
}

.shop-audit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  font-size: 11px;
}

.pending-tag {
  color: #f0a020;
}

.audited-tag {
  color: #18a058;
}
</style>
