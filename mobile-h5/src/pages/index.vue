<script setup lang="ts">
import { getMonthlyStatistics, getWorkOrderPage, getShopList } from '@/api/paint'
import type { PaintShop, MonthlyStatistics, PaintWorkOrder, PageResult } from '@/api/types/paint'

const currentMonth = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})

const router = useRouter()
const shops = ref<PaintShop[]>([])
const selectedShopId = ref('')
const shopName = ref('全部门店')
const showShopPicker = ref(false)
const recentOrders = ref<PaintWorkOrder[]>([])
const monthlyStats = ref<MonthlyStatistics[]>([])
const totalPaintCount = ref(0)
const totalOrderCount = ref(0)
const loading = ref(false)

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

async function loadData() {
  loading.value = true
  try {
    const [orderRes, statsRes] = await Promise.all([
      getWorkOrderPage({
        current: 1,
        size: 5,
        settlementMonth: currentMonth.value,
        ...(selectedShopId.value ? { shopId: selectedShopId.value } : {}),
      }),
      getMonthlyStatistics(currentMonth.value, selectedShopId.value || undefined),
    ])
    const pageData = orderRes as any as PageResult<PaintWorkOrder>
    recentOrders.value = pageData.records || []
    monthlyStats.value = statsRes as any as MonthlyStatistics[]
    totalPaintCount.value = monthlyStats.value.reduce((sum, s) => sum + (s.totalPaintCount || 0), 0)
    totalOrderCount.value = monthlyStats.value.reduce((sum, s) => sum + (s.totalOrders || 0), 0)
  }
  catch {
    // 加载失败保持默认空值
  }
  finally {
    loading.value = false
  }
}

function onShopConfirm({ selectedValues }: any) {
  selectedShopId.value = selectedValues[0]
  const shop = shops.value.find(s => s.id === selectedValues[0])
  shopName.value = shop?.name || '全部门店'
  showShopPicker.value = false
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

function formatOrderDate(dateStr: string) {
  if (!dateStr) return ''
  return dateStr.slice(0, 10)
}

onMounted(() => {
  loadShops()
  loadData()
})
</script>

<template>
  <div class="home-page">
    <!-- 顶部区域 -->
    <div class="header">
      <div class="header-bg" />
      <div class="header-content">
        <div class="greeting">
          <div class="greeting-text">
            喷漆幅数管理
          </div>
          <div class="greeting-sub">
            {{ currentMonth }} 月概览
          </div>
        </div>
        <!-- 门店切换 -->
        <div class="shop-switch" @click="showShopPicker = true">
          <van-icon name="shop-o" color="#fff" size="16" />
          <span class="shop-name">{{ shopName }}</span>
          <van-icon name="arrow-down" color="#fff" size="14" />
        </div>
      </div>
    </div>

    <!-- 数据卡片 -->
    <div class="stats-cards">
      <div class="stat-card" @click="goToStatistics">
        <div class="stat-icon-wrap blue">
          <van-icon name="brush-o" size="24" color="#fff" />
        </div>
        <div class="stat-info">
          <div class="stat-value">
            {{ totalPaintCount % 1 === 0 ? totalPaintCount : totalPaintCount.toFixed(1) }}
          </div>
          <div class="stat-label">
            本月总幅数
          </div>
        </div>
      </div>
      <div class="stat-card" @click="goToOrderList">
        <div class="stat-icon-wrap green">
          <van-icon name="orders-o" size="24" color="#fff" />
        </div>
        <div class="stat-info">
          <div class="stat-value">
            {{ totalOrderCount }}
          </div>
          <div class="stat-label">
            本月工单数
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="quick-actions">
      <div class="section-header">
        <div class="section-title">
          快捷操作
        </div>
      </div>
      <div class="action-grid">
        <div class="action-item" @click="goToCreate">
          <div class="action-icon blue-bg">
            <van-icon name="photograph" size="28" color="#fff" />
          </div>
          <span class="action-text">拍照建单</span>
        </div>
        <div class="action-item" @click="goToOrderList">
          <div class="action-icon green-bg">
            <van-icon name="orders-o" size="28" color="#fff" />
          </div>
          <span class="action-text">工单列表</span>
        </div>
        <div class="action-item" @click="goToStatistics">
          <div class="action-icon orange-bg">
            <van-icon name="chart-trending-o" size="28" color="#fff" />
          </div>
          <span class="action-text">数据统计</span>
        </div>
        <div class="action-item" @click="router.push({ name: 'WorkOrderCreate', query: { mode: 'manual' } })">
          <div class="action-icon purple-bg">
            <van-icon name="edit" size="28" color="#fff" />
          </div>
          <span class="action-text">手动建单</span>
        </div>
      </div>
    </div>

    <!-- 最近工单 -->
    <div class="recent-orders">
      <div class="section-header">
        <div class="section-title">
          最近工单
        </div>
        <div class="section-more" @click="goToOrderList">
          查看全部
        </div>
      </div>

      <div v-if="loading" class="loading-wrap">
        <van-loading size="24px">加载中...</van-loading>
      </div>

      <van-empty v-else-if="recentOrders.length === 0" description="暂无工单数据" />

      <div v-else class="order-list">
        <div
          v-for="order in recentOrders"
          :key="order.id"
          class="order-card"
          @click="goToOrderDetail(order.id)"
        >
          <div class="order-top">
            <span class="order-no">{{ order.orderNo }}</span>
            <van-tag :type="order.isAudited ? 'success' : 'warning'" size="medium">
              {{ order.isAudited ? '已审核' : '待审核' }}
            </van-tag>
          </div>
          <div class="order-info">
            <div class="info-row">
              <van-icon name="car" size="14" color="#999" />
              <span class="info-text">{{ order.plateNumber || '-' }}</span>
            </div>
            <div class="info-row">
              <van-icon name="calendar-o" size="14" color="#999" />
              <span class="info-text">{{ formatOrderDate(order.orderDate) }}</span>
            </div>
          </div>
          <div class="order-bottom">
            <span class="paint-count">{{ order.totalPaintCount }} 幅</span>
            <van-icon name="arrow" color="#ccc" />
          </div>
        </div>
      </div>
    </div>

    <div style="height: 60px;" />

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
  name: 'Home'
}
</route>

<style lang="less" scoped>
.home-page {
  min-height: 100vh;
  background: #f5f7fa;
}

.header {
  position: relative;
  height: 160px;
}

.header-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #1677ff 0%, #4096ff 100%);
  border-radius: 0 0 20px 20px;
}

.header-content {
  position: relative;
  padding: 50px 20px 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.greeting {
  display: flex;
  flex-direction: column;
}

.greeting-text {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

.greeting-sub {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 4px;
}

.shop-switch {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 6px 12px;
  backdrop-filter: blur(10px);
}

.shop-name {
  font-size: 13px;
  color: #fff;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-cards {
  display: flex;
  gap: 12px;
  padding: 0 16px;
  margin-top: -40px;
  position: relative;
  z-index: 10;
}

.stat-card {
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 14px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.stat-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;

  &.blue { background: linear-gradient(135deg, #1677ff, #4096ff); }
  &.green { background: linear-gradient(135deg, #52c41a, #73d13d); }
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
}

.stat-label {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.quick-actions {
  padding: 20px 16px 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.section-more {
  font-size: 13px;
  color: #1677ff;
}

.action-grid {
  display: flex;
  gap: 12px;
}

.action-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: #fff;
  border-radius: 10px;
  padding: 14px 0;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.action-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;

  &.blue-bg { background: linear-gradient(135deg, #1677ff, #4096ff); }
  &.green-bg { background: linear-gradient(135deg, #52c41a, #73d13d); }
  &.orange-bg { background: linear-gradient(135deg, #fa8c16, #ffa940); }
  &.purple-bg { background: linear-gradient(135deg, #722ed1, #9254de); }
}

.action-text {
  font-size: 13px;
  color: #333;
}

.recent-orders {
  padding: 20px 16px 0;
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.order-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order-card {
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.order-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.order-no {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
}

.order-info {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.info-text {
  font-size: 13px;
  color: #666;
}

.order-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid #f5f5f5;
}

.paint-count {
  font-size: 15px;
  font-weight: 600;
  color: #1677ff;
}
</style>
