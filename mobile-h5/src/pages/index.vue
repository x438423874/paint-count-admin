<script setup lang="ts">
import { getStatisticsOverview, getWorkOrderPage, getShopList, getLatestSettlementMonth } from '@/api/paint'
import type { PaintShop, StatisticsOverview, PaintWorkOrder, PageResult } from '@/api/types/paint'
import { canEdit as canEditRole } from '@/utils/permission'
import { monthInTenure, latestTenureMonth, getMyScopeCached } from '@/utils/tenure'
import type { MyScope } from '@/api/paint'

const allowEdit = canEditRole()

const currentMonth = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})

const router = useRouter()
const shops = ref<PaintShop[]>([])
const selectedShopId = ref('')
const shopName = ref('全部门店')
const recentOrders = ref<PaintWorkOrder[]>([])
const overview = ref<StatisticsOverview | null>(null)
const loading = ref(false)
const refreshing = ref(false)

const shopColumns = computed(() => {
  const cols = [{ text: '全部门店', value: '' }]
  shops.value.forEach(s => cols.push({ text: s.name, value: s.id }))
  return cols
})

const scope = ref<MyScope | null>(null)

const monthColumns = computed(() => {
  const list = []
  const now = new Date()
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (monthInTenure(value, scope.value)) list.push({ text: value, value })
  }
  return list
})

const selectedMonth = ref(currentMonth.value)
const showShopPicker = ref(false)
const showMonthPicker = ref(false)

async function initDefaultMonth() {
  try {
    const latest = await getLatestSettlementMonth()
    const latestMonth = (latest as any as string | null) || currentMonth.value
    // 默认月份若超出在岗期，回退到任期内最新月份
    selectedMonth.value = monthInTenure(latestMonth, scope.value)
      ? latestMonth
      : (latestTenureMonth(scope.value) ?? currentMonth.value)
  }
  catch {
    selectedMonth.value = currentMonth.value
  }
}

async function loadShops() {
  try {
    const res = await getShopList()
    shops.value = res as any as PaintShop[]
  }
  catch {
    shops.value = []
  }
}

async function loadData() {
  loading.value = true
  try {
    const [orderRes, overviewRes] = await Promise.all([
      getWorkOrderPage({
        current: 1,
        size: 5,
        settlementMonth: selectedMonth.value,
        ...(selectedShopId.value ? { shopId: selectedShopId.value } : {}),
      }),
      getStatisticsOverview(selectedMonth.value, selectedShopId.value || undefined),
    ])
    const pageData = orderRes as any as PageResult<PaintWorkOrder>
    recentOrders.value = pageData.records || []
    overview.value = (overviewRes as any as StatisticsOverview) || null
  }
  catch {
    // 加载失败保持默认空值
  }
  finally {
    loading.value = false
  }
}

async function onRefresh() {
  refreshing.value = true
  await loadData()
  refreshing.value = false
}

function onShopConfirm({ selectedValues }: any) {
  selectedShopId.value = selectedValues[0]
  const shop = shops.value.find(s => s.id === selectedValues[0])
  shopName.value = shop?.name || '全部门店'
  showShopPicker.value = false
  loadData()
}

function onMonthConfirm({ selectedValues }: any) {
  selectedMonth.value = selectedValues[0]
  showMonthPicker.value = false
  loadData()
}

function goToCreate() {
  router.push({ name: 'WorkOrderCreate' })
}

function goToOrderList() {
  router.push({ name: 'WorkOrder' })
}

function goToOrderDetail(id: string) {
  router.push({ name: 'WorkOrderDetail', query: { id } })
}

function goToStatistics() {
  router.push({ name: 'Statistics' })
}

function goToVehicle() {
  router.push({ name: 'Vehicle' })
}

function goToImagePool() {
  router.push({ name: 'PendingImage' })
}

// 携带状态筛选跳转工单列表（工单页 onMounted/onActivated 读取该标记）
function goToOrderListWithStatus(status?: string) {
  if (status) sessionStorage.setItem('work-order-status-query', status)
  router.push({ name: 'WorkOrder' })
}

function formatOrderDate(dateStr?: string) {
  if (!dateStr) return '-'
  return dateStr.slice(0, 10)
}

function formatCount(val?: number | string | null) {
  if (val === undefined || val === null || val === '') return '0'
  const num = Number(val)
  if (Number.isNaN(num)) return '0'
  if (Number.isInteger(num)) return String(num)
  return num.toFixed(1).replace(/\.0$/, '')
}

function statusText(status?: string) {
  const map: Record<string, string> = {
    DRAFT: '草稿',
    PENDING: '待审核',
    AUDITED: '已审核',
    SETTLED: '已结算',
    ABNORMAL: '异常',
  }
  return map[status || ''] || status || '-'
}

function statusType(status?: string): any {
  const map: Record<string, any> = {
    DRAFT: 'default',
    PENDING: 'warning',
    AUDITED: 'primary',
    SETTLED: 'success',
    ABNORMAL: 'danger',
  }
  return map[status || ''] || 'default'
}

onMounted(async () => {
  scope.value = await getMyScopeCached()
  await loadShops()
  await initDefaultMonth()
  loadData()
})
</script>

<template>
  <div class="home-page">
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <!-- 顶部蓝色区域 -->
      <div class="header">
        <div class="header-content">
          <div class="header-top">
            <div class="greeting">
              <div class="greeting-text">
                喷漆幅数管理
              </div>
              <div class="greeting-sub">
                {{ shopName }} · {{ selectedMonth }}
              </div>
            </div>
            <div class="header-actions">
              <div class="action-pill" @click="showShopPicker = true">
                <van-icon name="shop-o" color="#fff" size="13" />
                <span>{{ shopName }}</span>
                <van-icon name="arrow-down" color="rgba(255,255,255,0.7)" size="10" />
              </div>
              <div class="action-pill" @click="showMonthPicker = true">
                <van-icon name="calendar-o" color="#fff" size="13" />
                <span>{{ selectedMonth }}</span>
                <van-icon name="arrow-down" color="rgba(255,255,255,0.7)" size="10" />
              </div>
            </div>
          </div>

          <!-- 核心数据横幅 -->
          <div class="hero-stats">
            <div class="hero-item">
              <div class="hero-value">
                {{ formatCount(overview?.totalPaintCount) }}
              </div>
              <div class="hero-label">
                总幅数
              </div>
            </div>
            <div class="hero-divider" />
            <div class="hero-item">
              <div class="hero-value">
                {{ overview?.totalOrders || 0 }}
              </div>
              <div class="hero-label">
                工单数
              </div>
            </div>
            <div class="hero-divider" />
            <div class="hero-item">
              <div class="hero-value">
                {{ overview?.pendingOrders || 0 }}
              </div>
              <div class="hero-label">
                待审核
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 待办横幅 -->
      <div class="todo-banner">
        <div class="todo-item" @click="goToOrderListWithStatus('PENDING')">
          <span class="todo-value todo-warning">{{ overview?.pendingOrders || 0 }}</span>
          <span class="todo-label">待审核</span>
        </div>
        <div class="todo-divider" />
        <div class="todo-item" @click="goToOrderListWithStatus('ABNORMAL')">
          <span class="todo-value todo-danger">{{ overview?.abnormalOrders || 0 }}</span>
          <span class="todo-label">异常</span>
        </div>
      </div>

      <!-- 功能宫格 -->
      <div class="func-grid">
        <div v-if="allowEdit" class="func-item" @click="goToCreate">
          <div class="func-icon func-primary">
            <van-icon name="photograph" size="22" color="#fff" />
          </div>
          <span class="func-label">拍照建单</span>
        </div>
        <div class="func-item" @click="goToOrderList">
          <div class="func-icon func-info">
            <van-icon name="orders-o" size="22" color="#fff" />
          </div>
          <span class="func-label">工单列表</span>
        </div>
        <div class="func-item" @click="goToVehicle">
          <div class="func-icon func-success">
            <van-icon name="logistics" size="22" color="#fff" />
          </div>
          <span class="func-label">车辆管理</span>
        </div>
        <div v-if="allowEdit" class="func-item" @click="goToImagePool">
          <div class="func-icon func-warning">
            <van-icon name="photo-o" size="22" color="#fff" />
          </div>
          <span class="func-label">图片池</span>
        </div>
      </div>

      <!-- 数据分析入口 -->
      <div class="data-card" @click="goToStatistics">
        <div class="data-text">
          <div class="data-title">
            数据统计
          </div>
          <div class="data-desc">
            月度幅数 · 门店 · 部位分析
          </div>
        </div>
        <van-icon name="chart-trending-o" size="28" color="#fff" />
      </div>

      <!-- 状态概览 -->
      <div class="section">
        <div class="section-header">
          <div class="section-title">
            本月概览
          </div>
          <div class="section-more" @click="goToStatistics">
            更多
            <van-icon name="arrow" size="12" />
          </div>
        </div>
        <div class="overview-grid">
          <div class="overview-card" @click="goToOrderListWithStatus('AUDITED')">
            <div class="overview-icon audited">
              <van-icon name="passed" size="18" color="var(--color-primary)" />
            </div>
            <div class="overview-info">
              <div class="overview-value">
                {{ overview?.auditedOrders || 0 }}
              </div>
              <div class="overview-label">
                已审核
              </div>
            </div>
          </div>
          <div class="overview-card" @click="goToOrderListWithStatus('SETTLED')">
            <div class="overview-icon settled">
              <van-icon name="balance-pay" size="18" color="#52c41a" />
            </div>
            <div class="overview-info">
              <div class="overview-value">
                {{ overview?.settledOrders || 0 }}
              </div>
              <div class="overview-label">
                已结算
              </div>
            </div>
          </div>
          <div class="overview-card" @click="goToOrderListWithStatus('ABNORMAL')">
            <div class="overview-icon abnormal">
              <van-icon name="warning-o" size="18" color="var(--color-error)" />
            </div>
            <div class="overview-info">
              <div class="overview-value">
                {{ overview?.abnormalOrders || 0 }}
              </div>
              <div class="overview-label">
                异常
              </div>
            </div>
          </div>
          <div class="overview-card" @click="goToStatistics">
            <div class="overview-icon rate">
              <van-icon name="chart-o" size="18" color="var(--color-warning)" />
            </div>
            <div class="overview-info">
              <div class="overview-value">
                {{ overview?.settlementRate || 0 }}%
              </div>
              <div class="overview-label">
                结算率
              </div>
            </div>
          </div>
          <div class="overview-card" @click="goToOrderList">
            <div class="overview-icon rework">
              <van-icon name="replay" size="18" color="#d03050" />
            </div>
            <div class="overview-info">
              <div class="overview-value">
                {{ overview?.reworkOrders || 0 }}
              </div>
              <div class="overview-label">
                返工
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 最近工单 -->
      <div class="section">
        <div class="section-header">
          <div class="section-title">
            最近工单
          </div>
          <div class="section-more" @click="goToOrderList">
            查看全部
            <van-icon name="arrow" size="12" />
          </div>
        </div>

        <div v-if="loading" class="loading-wrap">
          <van-skeleton title :row="3" />
        </div>

        <van-empty v-else-if="recentOrders.length === 0" description="暂无工单数据" />

        <div v-else class="order-list">
          <div
            v-for="order in recentOrders"
            :key="order.id"
            class="order-card"
            @click="goToOrderDetail(order.id)"
          >
            <div class="order-left">
              <div class="order-plate">
                {{ order.plateNumber || '未识别' }}
              </div>
              <div class="order-no">
                {{ order.orderNo || '-' }}
              </div>
              <div class="order-meta">
                <span>{{ order.carModel || '-' }}</span>
                <span class="meta-dot">·</span>
                <span>{{ formatOrderDate(order.orderDate) }}</span>
              </div>
            </div>
            <div class="order-right">
              <van-tag :type="statusType(order.status)" size="medium" round>
                {{ statusText(order.status) }}
              </van-tag>
              <div class="order-count">
                <span class="count-value">{{ order.totalPaintCount }}</span>
                <span class="count-unit">幅</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="height: 80px;" />
    </van-pull-refresh>

    <!-- 门店选择器 -->
    <van-popup v-model:show="showShopPicker" position="bottom" round>
      <van-picker
        :columns="shopColumns"
        :model-value="[selectedShopId]"
        @confirm="onShopConfirm"
        @cancel="showShopPicker = false"
      />
    </van-popup>

    <!-- 月份选择器 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        :model-value="[selectedMonth]"
        @confirm="onMonthConfirm"
        @cancel="showMonthPicker = false"
      />
    </van-popup>
  </div>
</template>

<route lang="json5">
{
  name: 'Home'
}
</route>

<style lang="less" scoped>
.home-page {
  min-height: 100vh;
  background: var(--color-bg);
  padding-bottom: 80px;
}

.header {
  background: linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 60%, #fff) 100%);
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
  padding: 18px 12px;
  backdrop-filter: blur(10px);
}

.hero-item {
  flex: 1;
  text-align: center;
}

.hero-value {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 4px;
}

.hero-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

.hero-divider {
  width: 1px;
  height: 32px;
  background: rgba(255, 255, 255, 0.25);
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 16px;
  margin-top: -10px;
}

/* 待办横幅 */
.todo-banner {
  display: flex;
  align-items: center;
  margin: 0 16px;
  padding: 14px 8px;
  background: var(--color-surface);
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.todo-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.todo-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}

.todo-warning {
  color: var(--color-warning);
}

.todo-danger {
  color: var(--color-danger);
}

.todo-label {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.todo-divider {
  width: 1px;
  height: 28px;
  background: var(--color-border);
}

/* 功能宫格 */
.func-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  padding: 16px;
}

.func-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.func-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.func-primary {
  background: linear-gradient(135deg, var(--color-primary) 0%, #fff 100%);
}

.func-info {
  background: linear-gradient(135deg, #13c2c2 0%, #5cdbd3 100%);
}

.func-success {
  background: linear-gradient(135deg, #52c41a 0%, #95de64 100%);
}

.func-warning {
  background: linear-gradient(135deg, var(--color-warning) 0%, #ffc069 100%);
}

.func-danger {
  background: linear-gradient(135deg, var(--color-danger) 0%, #ff9c9c 100%);
}

.func-label {
  font-size: 12px;
  color: var(--color-text);
}

/* 数据分析入口卡 */
.data-card {
  margin: 0 16px 16px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 16px;
  background: linear-gradient(135deg, #722ed1 0%, #b37feb 100%);
  box-shadow: 0 4px 14px rgba(114, 46, 209, 0.2);
}

.data-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}

.data-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.section {
  margin: 0 16px 16px;
  background: var(--color-surface);
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
  color: var(--text-regular);
}

.section-more {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--color-primary);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.overview-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: var(--color-bg);
  border-radius: 12px;
}

.overview-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.overview-icon.audited {
  background: var(--color-info-bg);
}

.overview-icon.settled {
  background: var(--color-success-bg);
}

.overview-icon.abnormal {
  background: var(--color-error-bg);
}

.overview-icon.rate {
  background: var(--color-warning-bg);
}

.overview-icon.rework {
  background: var(--color-error-bg);
}

.overview-info {
  flex: 1;
}

.overview-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-regular);
  margin-bottom: 2px;
}

.overview-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.loading-wrap {
  padding: 10px 0;
}

.order-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px;
  background: var(--color-bg);
  border-radius: 12px;
}

.order-left {
  flex: 1;
  min-width: 0;
}

.order-plate {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-regular);
  margin-bottom: 4px;
}

.order-no {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.order-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.meta-dot {
  color: #ccc;
}

.order-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.order-count {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.count-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
}

.count-unit {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
