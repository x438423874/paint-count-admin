<script setup lang="ts">
import { fetchVehicleHistory, fetchVehicleByPlate } from '@/api/paint'
import type { PaintWorkOrder, VehicleHistorySummary } from '@/api/types/paint'

const route = useRoute()
const router = useRouter()

const vehicleId = ref((route.query.id as string) || '')
const plateNumber = ref((route.query.plate as string) || '')
const loading = ref(false)
const records = ref<PaintWorkOrder[]>([])
const total = ref(0)
const summary = ref<VehicleHistorySummary | null>(null)
const scope = ref<'all_shops' | 'current_shop'>('all_shops')
const resolvedVehicleId = ref('') // 可能从车牌号解析得到

function formatDate(val?: string | null) {
  if (!val) return '-'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return val
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function loadData() {
  // 优先用 vehicleId，否则先通过车牌号查询获取 vehicleId
  let vid = vehicleId.value || resolvedVehicleId.value
  if (!vid && plateNumber.value) {
    try {
      const v = await fetchVehicleByPlate(plateNumber.value)
      if (v) {
        resolvedVehicleId.value = v.id
        vid = v.id
        // 补充车牌号（可能从 API 返回标准化后的大写车牌）
        if (!plateNumber.value) plateNumber.value = v.plateNumber
      }
    }
    catch { /* ignore */ }
  }
  if (!vid) {
    showNotify({ type: 'warning', message: '未找到该车牌的车辆记录' })
    return
  }
  loading.value = true
  try {
    const data = await fetchVehicleHistory(vid, {
      current: 1,
      size: 50,
      scope: scope.value,
    })
    records.value = data.records || []
    total.value = data.total || 0
    summary.value = data.summary || null
  }
  catch {
    showNotify({ type: 'danger', message: '加载历史工单失败' })
  }
  finally {
    loading.value = false
  }
}

function goOrderDetail(orderId: string) {
  router.push({ name: 'WorkOrderDetail', query: { id: orderId } })
}

function goBack() {
  router.back()
}

onMounted(() => {
  if (!vehicleId.value && !plateNumber.value) {
    showNotify({ type: 'warning', message: '缺少车辆参数' })
    return
  }
  loadData()
})
</script>

<template>
  <div class="vehicle-history-page">
    <van-nav-bar
      :title="`历史工单${plateNumber ? ' · ' + plateNumber : ''}`"
      left-arrow
      @click-left="goBack"
    />

    <!-- 统计摘要 -->
    <div v-if="summary" class="summary-card">
      <div class="summary-row">
        <div class="summary-item">
          <span class="summary-value">{{ summary.totalOrders }}</span>
          <span class="summary-label">累计工单</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">{{ Number(summary.totalPaintCount).toFixed(1) }}</span>
          <span class="summary-label">累计幅数</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">{{ summary.shopCount }}</span>
          <span class="summary-label">门店数</span>
        </div>
      </div>
      <div class="summary-meta">
        <span>首次：{{ formatDate(summary.firstOrderAt) }}</span>
        <span>最近：{{ formatDate(summary.lastOrderAt) }}</span>
      </div>
      <div v-if="summary.reworkCount > 0 || summary.abnormalCount > 0" class="summary-meta">
        <span v-if="summary.reworkCount > 0" class="meta-tag meta-rework">返工 {{ summary.reworkCount }}</span>
        <span v-if="summary.abnormalCount > 0" class="meta-tag meta-abnormal">异常 {{ summary.abnormalCount }}</span>
      </div>
    </div>

    <!-- 范围切换 -->
    <div class="scope-switch">
      <van-radio-group v-model="scope" direction="horizontal" @change="loadData">
        <van-radio name="all_shops">全部门店</van-radio>
        <van-radio name="current_shop">当前门店</van-radio>
      </van-radio-group>
    </div>

    <!-- 工单列表 -->
    <div v-loading="loading" class="order-list">
      <div v-if="records.length === 0 && !loading" class="empty-tip">
        <AppEmpty description="暂无历史工单" />
      </div>
      <div
        v-for="order in records"
        :key="order.id"
        class="order-card"
        @click="goOrderDetail(order.id)"
      >
        <div class="order-header">
          <span class="order-no">{{ order.orderNo || '(无工单号)' }}</span>
          <OrderStatusTag
            class="order-status"
            :status="order.status"
            variant="text"
            short
          />
        </div>
        <div class="order-body">
          <span class="order-info-item">日期：{{ formatDate(order.orderDate) }}</span>
          <span class="order-info-item">门店：{{ order.shop?.name || '-' }}</span>
        </div>
        <div class="order-footer">
          <span class="paint-count">{{ Number(order.totalPaintCount || 0).toFixed(1) }} 幅</span>
          <span v-if="order.settlementMonth" class="settlement-month">结算：{{ order.settlementMonth }}</span>
          <van-icon name="arrow" size="14" color="#c8c9cc" />
        </div>
      </div>
      <div v-if="records.length > 0" class="list-footer">
        共 {{ total }} 条历史工单
      </div>
    </div>
  </div>
</template>

<route lang="json5">
{
  name: '/work-order/vehicle-history',
  meta: {
    hideNavBar: true
  }
}
</route>

<style scoped lang="less">
.vehicle-history-page {
  min-height: 100vh;
  background: var(--color-bg);
  padding-bottom: 24px;
}

.summary-card {
  margin: 12px;
  padding: 16px;
  background: linear-gradient(135deg, var(--color-success) 0%, #10aeff 100%);
  border-radius: 12px;
  color: #fff;

  .summary-row {
    display: flex;
    justify-content: space-around;
    margin-bottom: 12px;
  }

  .summary-item {
    display: flex;
    flex-direction: column;
    align-items: center;

    .summary-value {
      font-size: 24px;
      font-weight: 600;
      line-height: 1.2;
    }

    .summary-label {
      font-size: 12px;
      opacity: 0.9;
      margin-top: 4px;
    }
  }

  .summary-meta {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    opacity: 0.95;
    margin-top: 6px;

    .meta-tag {
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.25);
      margin-right: 8px;
    }
  }
}

.scope-switch {
  margin: 0 12px 8px;
  padding: 8px 12px;
  background: var(--color-surface);
  border-radius: 8px;
  font-size: 13px;
}

.order-list {
  padding: 0 12px;
}

.order-card {
  background: var(--color-surface);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);

  .order-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .order-no {
      font-size: 15px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .order-status {
      font-size: 11px;
      padding: 1px 6px;
      border: 1px solid;
      border-radius: 4px;
    }
  }

  .order-body {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .order-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: var(--text-tertiary);

    .paint-count {
      color: var(--color-success);
      font-weight: 500;
    }
  }
}

.empty-tip {
  padding: 40px 0;
}

.list-footer {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 12px 0;
}
</style>
