<script setup lang="ts">
import {
  getWorkOrderPage,
  getShopList,
  getWorkOrderStatusCounts,
  ocrRecognizeImage,
  updateWorkOrder,
} from '@/api/paint'
import type { PaintWorkOrder, PaintShop, PaintOrderStatus, PageResult } from '@/api/types/paint'
import { showNotify } from 'vant'
import { compressImage } from '@/utils/image-compress'
import { canBatchOcr as canBatchOcrRole, canEdit as canEditRole } from '@/utils/permission'

// 权限标志
const allowBatchOcr = canBatchOcrRole()
const allowEdit = canEditRole()

const router = useRouter()
const searchForm = reactive({
  plateNumber: '',
  shopId: '',
  settlementMonth: '',
  status: '' as PaintOrderStatus | '',
})

const shops = ref<PaintShop[]>([])
const orders = ref<PaintWorkOrder[]>([])
const loading = ref(false)
const finished = ref(false)
const current = ref(1)
const size = 10

const statusCounts = reactive({
  total: 0,
  pending: 0,
  audited: 0,
  settled: 0,
})

const showShopPicker = ref(false)
const showMonthPicker = ref(false)

const monthColumns = computed(() => {
  const now = new Date()
  const list = [{ text: '全部月份', value: '' }]
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    list.push({ text: value, value })
  }
  return list
})

const shopColumns = computed(() => {
  const cols = shops.value.map(s => ({ text: s.name, value: s.id }))
  return [{ text: '全部门店', value: '' }, ...cols]
})

function getShopName(shopId: string) {
  if (!shopId) return '-'
  const shop = shops.value.find(s => s.id === shopId)
  return shop?.name || shopId
}

const statusOptions = [
  { label: '全部', value: '' },
  { label: '待审核', value: 'PENDING' },
  { label: '已审核', value: 'AUDITED' },
  { label: '已结算', value: 'SETTLED' },
]

const activeStatus = ref(0)

async function loadShops() {
  try {
    const res = await getShopList()
    shops.value = res as any as PaintShop[]
    // 数据权限：若用户仅绑定 1 个门店，自动选中并锁定（不显示"全部门店"）
    if (shops.value.length === 1 && !searchForm.shopId) {
      searchForm.shopId = shops.value[0].id
    }
  }
  catch {
    shops.value = []
  }
}

async function loadStatusCounts() {
  try {
    const res = await getWorkOrderStatusCounts(searchForm.shopId || undefined, searchForm.settlementMonth || undefined)
    const data = res as any as { total: number; pending: number; audited: number; settled: number }
    statusCounts.total = data.total
    statusCounts.pending = data.pending
    statusCounts.audited = data.audited
    statusCounts.settled = data.settled
  }
  catch {
    // 加载失败保持默认值
  }
}

async function loadOrders(reset = false) {
  if (loading.value) return
  if (!reset && finished.value) return

  if (reset) {
    current.value = 1
    orders.value = []
    finished.value = false
  }

  loading.value = true
  try {
    const params: any = {
      current: current.value,
      size,
    }
    if (searchForm.plateNumber) params.plateNumber = searchForm.plateNumber
    if (searchForm.shopId) params.shopId = searchForm.shopId
    if (searchForm.settlementMonth) params.settlementMonth = searchForm.settlementMonth
    if (searchForm.status) params.status = searchForm.status

    const res = await getWorkOrderPage(params)
    const data = res as any as PageResult<PaintWorkOrder>
    const list = data.records || []

    if (reset) {
      orders.value = list
    }
    else {
      orders.value = [...orders.value, ...list]
    }

    if (list.length < size) {
      finished.value = true
    }
    else {
      current.value++
    }
  }
  catch {
    showNotify({ type: 'danger', message: '加载工单失败' })
  }
  finally {
    loading.value = false
  }
}

function onStatusChange(index: number) {
  activeStatus.value = index
  searchForm.status = statusOptions[index].value as any
  loadOrders(true)
}

function onSearch() {
  loadOrders(true)
  loadStatusCounts()
}

function goToDetail(id: string) {
  router.push({ name: 'WorkOrderDetail', query: { id } })
}

function goToCreate() {
  router.push({ name: 'WorkOrderCreate' })
}

function onShopConfirm({ selectedValues }: any) {
  searchForm.shopId = selectedValues[0]
  showShopPicker.value = false
  loadOrders(true)
  loadStatusCounts()
}

function onMonthConfirm({ selectedValues }: any) {
  searchForm.settlementMonth = selectedValues[0]
  showMonthPicker.value = false
  loadOrders(true)
  loadStatusCounts()
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  return dateStr.slice(0, 10)
}

// ===== 一键 OCR 识别填充相关 =====
const selectionMode = ref(false)
const checkedOrderIds = ref<string[]>([])
const showBatchOcr = ref(false)
const batchOcrLoading = ref(false)
const batchOcrMode = ref<'selected' | 'all'>('selected')
const batchOcrCancelled = ref(false)
const batchOcrProgress = ref({ current: 0, total: 0, success: 0, failed: 0, skipped: 0 })
const batchOcrResult = ref<{ success: number; failed: number; skipped: number; details: string[] } | null>(null)

// 检查工单是否有空白字段
function hasEmptyFields(order: PaintWorkOrder): boolean {
  return !order.plateNumber || !order.orderNo || !order.customerName || !order.phone || !order.carModel
}

// 判断工单是否可参与批量 OCR（未审核、有图片、有空白字段）
function canBatchOcr(order: PaintWorkOrder): boolean {
  return !order.isAudited && !!order.images && order.images.length > 0 && hasEmptyFields(order)
}

// 选中工单中可 OCR 的数量
const ocrPendingSelectedCount = computed(() => {
  return orders.value.filter(o => checkedOrderIds.value.includes(o.id) && canBatchOcr(o)).length
})

// 当前已加载工单中可 OCR 的数量（"全部"模式使用已加载列表）
const ocrPendingAllCount = computed(() => {
  return orders.value.filter(o => canBatchOcr(o)).length
})

// 进入/退出选择模式
function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value) {
    checkedOrderIds.value = []
  }
}

// 切换单个工单的选中状态
function toggleOrderChecked(id: string) {
  const idx = checkedOrderIds.value.indexOf(id)
  if (idx >= 0) {
    checkedOrderIds.value.splice(idx, 1)
  }
  else {
    checkedOrderIds.value.push(id)
  }
}

// 全选/取消全选（仅可 OCR 的）
const allChecked = computed(() => {
  const ocrable = orders.value.filter(o => canBatchOcr(o))
  return ocrable.length > 0 && ocrable.every(o => checkedOrderIds.value.includes(o.id))
})

function toggleSelectAll() {
  const ocrable = orders.value.filter(o => canBatchOcr(o))
  if (allChecked.value) {
    checkedOrderIds.value = checkedOrderIds.value.filter(id => !ocrable.some(o => o.id === id))
  }
  else {
    const set = new Set(checkedOrderIds.value)
    ocrable.forEach(o => set.add(o.id))
    checkedOrderIds.value = Array.from(set)
  }
}

// 打开批量 OCR 弹窗（重置状态）
function openBatchOcr() {
  batchOcrLoading.value = false
  batchOcrCancelled.value = false
  batchOcrResult.value = null
  batchOcrProgress.value = { current: 0, total: 0, success: 0, failed: 0, skipped: 0 }
  // 如果有选中工单，默认选中模式；否则默认全部模式
  batchOcrMode.value = checkedOrderIds.value.length > 0 ? 'selected' : 'all'
  showBatchOcr.value = true
}

// 取消处理
function cancelBatchOcr() {
  batchOcrCancelled.value = true
}

// 关闭弹窗
function closeBatchOcr() {
  if (batchOcrLoading.value) return
  showBatchOcr.value = false
}

// 获取待 OCR 处理的工单列表
function getOcrPendingOrders(): PaintWorkOrder[] {
  if (batchOcrMode.value === 'selected') {
    return orders.value.filter(o => checkedOrderIds.value.includes(o.id) && canBatchOcr(o))
  }
  return orders.value.filter(o => canBatchOcr(o))
}

// 执行批量 OCR 填充
async function handleBatchOcrFill() {
  const pendingOrders = getOcrPendingOrders()
  if (pendingOrders.length === 0) {
    showNotify({ type: 'warning', message: '没有符合条件的工单（需未审核、有图片、有空白字段）' })
    return
  }

  batchOcrLoading.value = true
  batchOcrCancelled.value = false
  batchOcrResult.value = null
  batchOcrProgress.value = { current: 0, total: pendingOrders.length, success: 0, failed: 0, skipped: 0 }
  const details: string[] = []

  for (const order of pendingOrders) {
    if (batchOcrCancelled.value) {
      details.push(`已取消，剩余 ${pendingOrders.length - batchOcrProgress.value.current} 条未处理`)
      break
    }
    batchOcrProgress.value.current++

    try {
      // 拉取图片并转 File
      const imageUrl = order.images![0].url
      const resp = await fetch(imageUrl)
      if (!resp.ok) throw new Error('获取图片失败')
      const blob = await resp.blob()
      const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' })
      // 压缩图片，降低 OCR 服务负担并避免超时
      const compressed = await compressImage(file)

      // OCR 识别（使用工单自身 shopId）
      const ocrResult = await ocrRecognizeImage(compressed, order.shopId)

      // 仅填充空白字段
      const updateData: any = { id: order.id }
      const filledFields: string[] = []
      if (!order.plateNumber && ocrResult.plateNumber) {
        updateData.plateNumber = ocrResult.plateNumber
        filledFields.push('车牌号')
      }
      if (!order.orderNo && ocrResult.orderNo) {
        updateData.orderNo = ocrResult.orderNo
        filledFields.push('工单号')
      }
      if (!order.customerName && ocrResult.customerName) {
        updateData.customerName = ocrResult.customerName
        filledFields.push('客户名')
      }
      if (!order.phone && ocrResult.phone) {
        updateData.phone = ocrResult.phone
        filledFields.push('电话')
      }
      if (!order.carModel && ocrResult.carModel) {
        updateData.carModel = ocrResult.carModel
        filledFields.push('车型')
      }

      if (filledFields.length === 0) {
        batchOcrProgress.value.skipped++
        details.push(`${order.orderNo || order.id}: 识别结果无有效数据，跳过`)
        continue
      }

      // 更新工单
      await updateWorkOrder(updateData)
      batchOcrProgress.value.success++
      details.push(`${order.orderNo || order.id}: 填充 ${filledFields.join('、')}`)
    }
    catch (e: any) {
      batchOcrProgress.value.failed++
      details.push(`${order.orderNo || order.id}: 失败 - ${e?.message || '未知错误'}`)
    }
  }

  batchOcrLoading.value = false
  batchOcrResult.value = {
    success: batchOcrProgress.value.success,
    failed: batchOcrProgress.value.failed,
    skipped: batchOcrProgress.value.skipped,
    details,
  }

  const type = batchOcrProgress.value.failed === 0 ? 'success' : 'warning'
  showNotify({
    type,
    message: `OCR填充完成：成功 ${batchOcrProgress.value.success} 条，失败 ${batchOcrProgress.value.failed} 条，跳过 ${batchOcrProgress.value.skipped} 条`,
  })

  // 处理完成后刷新列表并退出选择模式
  await loadOrders(true)
  selectionMode.value = false
  checkedOrderIds.value = []
}

// 处理卡片点击：选择模式下切换选中，否则跳转详情
function onCardClick(order: PaintWorkOrder) {
  if (selectionMode.value) {
    toggleOrderChecked(order.id)
  }
  else {
    goToDetail(order.id)
  }
}

// ===== 列表无限滚动加载 =====
const sentinelRef = ref<HTMLElement | null>(null)
let scrollObserver: IntersectionObserver | null = null

function setupScrollObserver() {
  if (!sentinelRef.value) return
  if (scrollObserver) {
    scrollObserver.disconnect()
    scrollObserver = null
  }
  scrollObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (entry.isIntersecting && !loading.value && !finished.value) {
        loadOrders()
      }
    },
    {
      root: null,
      rootMargin: '200px',
      threshold: 0,
    },
  )
  scrollObserver.observe(sentinelRef.value)
}

onMounted(() => {
  loadShops()
  loadOrders(true)
  loadStatusCounts()
  nextTick(() => {
    setupScrollObserver()
  })
})

onBeforeUnmount(() => {
  if (scrollObserver) {
    scrollObserver.disconnect()
    scrollObserver = null
  }
})

// 从详情页返回时刷新数据
onActivated(() => {
  loadOrders(true)
  loadStatusCounts()
})
</script>

<template>
  <div class="order-page">
    <!-- 搜索栏 -->
    <div class="search-bar">
      <van-search
        v-model="searchForm.plateNumber"
        placeholder="搜索车牌号"
        shape="round"
        @search="onSearch"
      />
      <div v-if="allowBatchOcr" class="icon-btn ocr-btn" @click="openBatchOcr">
        <van-icon name="scan" size="20" color="#fff" />
      </div>
      <div v-if="allowBatchOcr" class="icon-btn" :class="{ active: selectionMode }" @click="toggleSelectionMode">
        <van-icon :name="selectionMode ? 'cross' : 'checked'" size="20" color="#fff" />
      </div>
      <div v-if="allowEdit" class="icon-btn add-btn" @click="goToCreate">
        <van-icon name="plus" size="20" color="#fff" />
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-item" @click="showMonthPicker = true">
        <van-icon name="calendar-o" size="16" color="#1677ff" />
        <span class="filter-text">{{ searchForm.settlementMonth || '结算月份' }}</span>
        <van-icon name="arrow" size="12" color="#ccc" />
      </div>
      <div class="filter-item" @click="showShopPicker = true">
        <van-icon name="shop-o" size="16" color="#1677ff" />
        <span class="filter-text">{{ searchForm.shopId ? getShopName(searchForm.shopId) : '全部门店' }}</span>
        <van-icon name="arrow" size="12" color="#ccc" />
      </div>
    </div>

    <!-- 状态筛选 -->
    <van-tabs v-model:active="activeStatus" @change="onStatusChange">
      <van-tab>
        <template #title>全部<span class="tab-count">{{ statusCounts.total }}</span></template>
      </van-tab>
      <van-tab>
        <template #title>待审核<span class="tab-count">{{ statusCounts.pending }}</span></template>
      </van-tab>
      <van-tab>
        <template #title>已审核<span class="tab-count">{{ statusCounts.audited }}</span></template>
      </van-tab>
      <van-tab>
        <template #title>已结算<span class="tab-count">{{ statusCounts.settled }}</span></template>
      </van-tab>
    </van-tabs>

    <!-- 工单列表 -->
    <div class="order-list" :class="{ 'in-selection': selectionMode }">
      <van-empty v-if="orders.length === 0 && !loading" description="暂无工单数据" />

      <div
        v-for="order in orders"
        :key="order.id"
        class="order-card"
        :class="{ checked: selectionMode && checkedOrderIds.includes(order.id) }"
        @click="onCardClick(order)"
      >
        <van-checkbox
          v-if="selectionMode"
          :model-value="checkedOrderIds.includes(order.id)"
          shape="square"
          class="card-checkbox"
          @click.stop="toggleOrderChecked(order.id)"
        />
        <div class="order-top">
          <span class="order-no">{{ order.orderNo }}</span>
          <div class="order-tags">
            <van-tag v-if="order.images && order.images.length > 0" type="primary" size="medium" class="img-tag">
              <van-icon name="photo-o" size="12" />
              <span>{{ order.images.length }}</span>
            </van-tag>
            <van-tag :type="order.isAudited ? 'success' : 'warning'" size="medium">
              {{ order.isAudited ? '已审核' : '待审核' }}
            </van-tag>
          </div>
        </div>

        <div class="order-body">
          <div class="info-row">
            <van-icon name="car" size="14" color="#bbb" />
            <span class="info-label">车牌号</span>
            <span class="info-value">{{ order.plateNumber || '-' }}</span>
          </div>
          <div class="info-row">
            <van-icon name="graphic" size="14" color="#bbb" />
            <span class="info-label">车型</span>
            <span class="info-value">{{ order.carModel || '-' }}</span>
          </div>
          <div class="info-row">
            <van-icon name="shop-o" size="14" color="#bbb" />
            <span class="info-label">门店</span>
            <span class="info-value">{{ getShopName(order.shopId) }}</span>
          </div>
          <div class="info-row">
            <van-icon name="calendar-o" size="14" color="#bbb" />
            <span class="info-label">日期</span>
            <span class="info-value">{{ formatDate(order.orderDate) }}</span>
          </div>
          <div class="info-row">
            <van-icon name="label-o" size="14" color="#bbb" />
            <span class="info-label">结算月份</span>
            <span class="info-value">{{ order.settlementMonth || '-' }}</span>
          </div>
          <div class="info-row">
            <van-icon name="user-o" size="14" color="#bbb" />
            <span class="info-label">客户</span>
            <span class="info-value">{{ order.customerName || '-' }}</span>
          </div>
        </div>

        <div class="order-footer">
          <div class="paint-count-wrap">
            <span class="paint-count">{{ order.totalPaintCount }}</span>
            <span class="paint-unit">幅</span>
          </div>
          <van-icon name="arrow" color="#ccc" />
        </div>
      </div>

      <div v-if="loading" class="loading-wrap">
        <van-loading size="24px">加载中...</van-loading>
      </div>

      <div v-if="finished && orders.length > 0" class="finished-text">
        没有更多了
      </div>

      <!-- 无限滚动哨兵：滚动到此处自动加载下一页 -->
      <div ref="sentinelRef" class="scroll-sentinel"></div>
    </div>

    <!-- 选择模式底部操作栏 -->
    <div v-if="selectionMode" class="selection-bar">
      <van-checkbox :model-value="allChecked" shape="square" @click="toggleSelectAll">全选</van-checkbox>
      <div class="selection-info">
        已选 <span class="count">{{ checkedOrderIds.length }}</span> 条
        <span class="ocr-count">（可OCR {{ ocrPendingSelectedCount }} 条）</span>
      </div>
      <van-button type="primary" size="small" round @click="openBatchOcr">
        一键OCR
      </van-button>
    </div>

    <!-- 门店选择器 -->
    <van-popup v-model:show="showShopPicker" position="bottom" round>
      <van-picker
        :columns="shopColumns"
        @confirm="onShopConfirm"
        @cancel="showShopPicker = false"
      />
    </van-popup>

    <!-- 月份选择器 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        @confirm="onMonthConfirm"
        @cancel="showMonthPicker = false"
      />
    </van-popup>

    <!-- 一键 OCR 识别填充弹窗 -->
    <van-popup
      v-model:show="showBatchOcr"
      position="center"
      round
      :close-on-click-overlay="!batchOcrLoading"
      :closeable="!batchOcrLoading"
      class="batch-ocr-popup"
    >
      <div class="batch-ocr-content">
        <div class="batch-ocr-title">一键OCR识别填充</div>
        <div class="batch-ocr-desc">
          仅处理<strong>待审核</strong>状态、含图片且存在空白字段（车牌号、工单号、客户名、电话、车型）的工单，识别结果只填充空白字段。
        </div>

        <!-- 模式选择 -->
        <van-radio-group v-model="batchOcrMode" :disabled="batchOcrLoading" direction="horizontal" class="batch-ocr-mode">
          <van-radio name="selected" :disabled="checkedOrderIds.length === 0">
            选中工单
          </van-radio>
          <van-radio name="all">
            已加载的全部待审核工单
          </van-radio>
        </van-radio-group>

        <!-- 待处理数量 -->
        <div class="batch-ocr-pending">
          <span>可处理数量：</span>
          <van-tag type="success">
            {{ batchOcrMode === 'selected' ? ocrPendingSelectedCount : ocrPendingAllCount }} 条
          </van-tag>
          <span v-if="batchOcrMode === 'selected' && checkedOrderIds.length === 0" class="batch-ocr-tip">
            （未选择工单，请点击右上角"选择"按钮进行多选）
          </span>
        </div>

        <!-- 进度 -->
        <div v-if="batchOcrLoading || batchOcrResult" class="batch-ocr-progress">
          <div class="progress-head">
            <span>{{ batchOcrProgress.current }} / {{ batchOcrProgress.total }}</span>
          </div>
          <van-progress
            :percentage="batchOcrProgress.total > 0 ? Math.round(batchOcrProgress.current / batchOcrProgress.total * 100) : 0"
            :show-pivot="true"
            stroke-width="6"
          />
          <div class="progress-stats">
            <van-tag type="success" size="medium">成功 {{ batchOcrProgress.success }}</van-tag>
            <van-tag type="danger" size="medium">失败 {{ batchOcrProgress.failed }}</van-tag>
            <van-tag type="warning" size="medium">跳过 {{ batchOcrProgress.skipped }}</van-tag>
          </div>
        </div>

        <!-- 结果明细 -->
        <div v-if="batchOcrResult" class="batch-ocr-result">
          <div class="result-summary" :class="{ 'has-failed': batchOcrResult.failed > 0 }">
            OCR填充完成：成功 {{ batchOcrResult.success }} 条，失败 {{ batchOcrResult.failed }} 条，跳过 {{ batchOcrResult.skipped }} 条
          </div>
          <div class="result-details">
            <div v-for="(detail, idx) in batchOcrResult.details" :key="idx" class="detail-line">
              {{ detail }}
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="batch-ocr-actions">
          <van-button v-if="batchOcrLoading" type="danger" block round @click="cancelBatchOcr">
            取消处理
          </van-button>
          <van-button v-else-if="batchOcrResult" type="primary" block round @click="closeBatchOcr">
            关闭
          </van-button>
          <van-button
            v-else
            type="primary"
            block
            round
            :disabled="(batchOcrMode === 'selected' ? ocrPendingSelectedCount : ocrPendingAllCount) === 0"
            :loading="batchOcrLoading"
            @click="handleBatchOcrFill"
          >
            开始识别填充
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<route lang="json5">
{
  name: 'WorkOrder',
  meta: {
    keepAlive: true
  }
}
</route>

<style lang="less" scoped>
.order-page {
  min-height: 100vh;
  background: #f5f7fa;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #fff;

  :deep(.van-search) {
    flex: 1;
    padding: 0;
  }
}

.add-btn {
  background: linear-gradient(135deg, #1677ff, #4096ff);
}

.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1677ff, #4096ff);
  box-shadow: 0 2px 6px rgba(22, 119, 255, 0.3);
  flex-shrink: 0;

  &.ocr-btn {
    background: linear-gradient(135deg, #ff7a45, #ff9c6e);
    box-shadow: 0 2px 6px rgba(255, 122, 69, 0.3);
  }

  &.active {
    background: linear-gradient(135deg, #52c41a, #95de64);
    box-shadow: 0 2px 6px rgba(82, 196, 26, 0.3);
  }
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

.tab-count {
  display: inline-block;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
  margin-left: 4px;
  font-size: 11px;
  color: #fff;
  background: #c0c4cc;
  border-radius: 8px;
  text-align: center;
  vertical-align: middle;
}

:deep(.van-tab--active) .tab-count {
  background: #1677ff;
}

.order-list {
  padding: 12px 16px 80px;

  &.in-selection {
    padding-left: 8px;
    padding-right: 8px;
  }
}

.order-card {
  position: relative;
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 10px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
  transition: background 0.2s;

  &.checked {
    background: #ecf5ff;
    border: 1px solid #1677ff;
    padding: 13px;
  }
}

.card-checkbox {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
}

.order-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.order-no {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
}

.order-tags {
  display: flex;
  align-items: center;
  gap: 6px;
}

.img-tag {
  display: flex;
  align-items: center;
  gap: 2px;
}

.order-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.info-label {
  font-size: 13px;
  color: #999;
  min-width: 60px;
}

.info-value {
  font-size: 13px;
  color: #333;
}

.order-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid #f5f5f5;
}

.paint-count-wrap {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.paint-count {
  font-size: 18px;
  font-weight: 700;
  color: #1677ff;
}

.paint-unit {
  font-size: 12px;
  color: #1677ff;
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}

.finished-text {
  text-align: center;
  font-size: 13px;
  color: #ccc;
  padding: 20px 0;
}

.scroll-sentinel {
  width: 100%;
  height: 1px;
  margin-top: 8px;
}

.selection-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
  z-index: 100;
}

.selection-info {
  flex: 1;
  font-size: 13px;
  color: #333;

  .count {
    color: #1677ff;
    font-weight: 600;
  }

  .ocr-count {
    color: #999;
    font-size: 12px;
  }
}

.batch-ocr-popup {
  width: 90%;
  max-width: 360px;
}

.batch-ocr-content {
  padding: 20px;
  max-height: 80vh;
  overflow-y: auto;
}

.batch-ocr-title {
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 10px;
  color: #1a1a1a;
}

.batch-ocr-desc {
  font-size: 12px;
  color: #999;
  line-height: 1.6;
  margin-bottom: 16px;
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: 6px;

  strong {
    color: #ff7a45;
  }
}

.batch-ocr-mode {
  justify-content: space-around;
  margin-bottom: 12px;
}

.batch-ocr-pending {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #333;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.batch-ocr-tip {
  color: #ff7a45;
  font-size: 12px;
}

.batch-ocr-progress {
  margin-bottom: 16px;

  .progress-head {
    text-align: center;
    font-size: 12px;
    color: #666;
    margin-bottom: 6px;
  }

  .progress-stats {
    display: flex;
    justify-content: space-around;
    margin-top: 10px;
  }
}

.batch-ocr-result {
  margin-bottom: 16px;
  padding: 10px;
  background: #f5f7fa;
  border-radius: 6px;

  .result-summary {
    font-size: 13px;
    color: #52c41a;
    font-weight: 600;
    margin-bottom: 8px;

    &.has-failed {
      color: #ff7a45;
    }
  }

  .result-details {
    max-height: 200px;
    overflow-y: auto;
  }

  .detail-line {
    font-size: 12px;
    color: #666;
    line-height: 1.6;
    padding: 2px 0;
    border-bottom: 1px dashed #eee;

    &:last-child {
      border-bottom: none;
    }
  }
}

.batch-ocr-actions {
  display: flex;
  gap: 8px;
}
</style>
