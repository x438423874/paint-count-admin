<script setup lang="ts">
import {
  batchSettleWorkOrders,
  batchUnsettleWorkOrders,
  findDuplicateWorkOrders,
  getCategories,
  getWorkOrderPage,
  getWorkOrderStatusCounts,
  mergeWorkOrders,
  ocrRecognizeImage,
  updateWorkOrder,
} from '@/api/paint'
import type { MyScope } from '@/api/paint'
import type { PageResult, PaintCategory, PaintOrderStatus, PaintWorkOrder } from '@/api/types/paint'
import { getMyScopeCached, monthInTenure } from '@/utils/tenure'
import { orderStatusTagType } from '@/constants/order-status'
import { showNotify } from 'vant'
import { compressImage } from '@/utils/image-compress'
import { fetchImageAsFile } from '@/composables/useImageUpload'
import { recentMonthOptions } from '@/utils/month-options'
import { canBatchOcr as canBatchOcrRole, canEdit as canEditRole } from '@/utils/permission'
import { useShopOptions } from '@/composables/useShopOptions'

const router = useRouter()
const allowBatchOcr = canBatchOcrRole()
const allowEdit = canEditRole()

const searchForm = reactive({
  plateNumber: '',
  shopId: '',
  settlementMonth: '',
  status: '' as PaintOrderStatus | '',
  isRework: undefined as boolean | undefined,
  categoryId: '' as string,
  isNewPart: undefined as boolean | undefined,
})

// 门店走 dict store 共享缓存，全应用只请求一次（原为每页各自 getShopList）
const { shops, shopColumns, ensureShops, getShopName } = useShopOptions()
const categories = ref<PaintCategory[]>([])
const orders = ref<PaintWorkOrder[]>([])
const loading = ref(false)
const finished = ref(false)
const current = ref(1)
// 每页大小：平衡首屏速度和加载次数
const size = 20
const totalPaintCount = ref(0)

// 总幅数显示格式：默认1位小数，实际值有2位小数时显示2位（与编辑页幅数规则一致）
function formatPaintCount(val?: number | null): string {
  const n = Number(val ?? 0)
  const decimals = String(n).split('.')[1]?.length ?? 0
  return n.toFixed(Math.min(Math.max(decimals, 1), 2))
}
const refreshing = ref(false)

const statusCounts = reactive({
  total: 0,
  draft: 0,
  pending: 0,
  audited: 0,
  settled: 0,
  abnormal: 0,
})

const statusOptions = [
  { label: '全部', value: '', key: 'total' },
  { label: '草稿', value: 'DRAFT', key: 'draft' },
  { label: '待审核', value: 'PENDING', key: 'pending' },
  { label: '已审核', value: 'AUDITED', key: 'audited' },
  { label: '已结算', value: 'SETTLED', key: 'settled' },
  { label: '异常', value: 'ABNORMAL', key: 'abnormal' },
]

const activeStatus = ref(0)
const showFilterPopup = ref(false)

const scope = ref<MyScope | null>(null)
// 月份列统一走 recentMonthOptions（全部月份 + 近 12 个月 ∩ 在岗期）
const monthColumns = computed(() => recentMonthOptions({ includeAll: true, scope: scope.value }))

// ==================== 数据可见范围提示（在岗期口径） ====================

const scopeHintDismissed = ref(false)

const scopeHintText = computed(() => {
  if (!scope.value || scope.value.kind !== 'tenure')
    return ''
  // ISO 时间按本地时区格式化为 yyyy-MM-dd（避免 UTC 截断出现前一天）
  const fmt = (v?: string | null) => {
    if (!v)
      return ''
    const d = new Date(v)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const parts = scope.value.shops.map((s) => {
    const start = fmt(s.startAt)
    if (s.endAt)
      return `${s.shopName}（${start} ~ ${fmt(s.endAt)}，已离岗）`
    return `${s.shopName}（${start} 至今）`
  })
  return `数据范围：仅可查看您在岗期间结算的工单（按结算月份归属）。${parts.join('；')}`
})

async function loadScope() {
  scope.value = await getMyScopeCached()
  // 任期加载后，若已选结算月份超出在岗期则清空
  if (searchForm.settlementMonth && !monthInTenure(searchForm.settlementMonth, scope.value)) {
    searchForm.settlementMonth = ''
  }
}

async function loadCategories() {
  try {
    const res = await getCategories()
    categories.value = (res as any) || []
  }
  catch {
    categories.value = []
  }
}

async function loadStatusCounts() {
  try {
    const res = await getWorkOrderStatusCounts(searchForm.shopId || undefined, searchForm.settlementMonth || undefined)
    const data = res as any as typeof statusCounts
    Object.assign(statusCounts, data)
  }
  catch {
    // ignore
  }
}

async function loadOrders(reset = false) {
  if (loading.value)
    return
  if (!reset && finished.value)
    return

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
    if (searchForm.plateNumber)
      params.plateNumber = searchForm.plateNumber
    if (searchForm.shopId)
      params.shopId = searchForm.shopId
    if (searchForm.settlementMonth)
      params.settlementMonth = searchForm.settlementMonth
    if (searchForm.status)
      params.status = searchForm.status
    if (searchForm.isRework !== undefined)
      params.isRework = searchForm.isRework
    if (searchForm.categoryId)
      params.categoryId = searchForm.categoryId
    if (searchForm.isNewPart !== undefined)
      params.isNewPart = searchForm.isNewPart

    const res = await getWorkOrderPage(params)
    const data = res as any as PageResult<PaintWorkOrder>
    const list = data.records || []

    if (reset) {
      orders.value = list
      totalPaintCount.value = data.totalPaintCount || 0
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

async function onRefresh() {
  refreshing.value = true
  await loadOrders(true)
  await loadStatusCounts()
  refreshing.value = false
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

function resetFilter() {
  searchForm.shopId = shops.value.length === 1 ? shops.value[0].id : ''
  searchForm.settlementMonth = ''
  searchForm.isRework = undefined
  searchForm.categoryId = ''
  searchForm.isNewPart = undefined
  showFilterPopup.value = false
  loadOrders(true)
  loadStatusCounts()
}

function confirmFilter() {
  showFilterPopup.value = false
  loadOrders(true)
  loadStatusCounts()
}

function goToDetail(id: string) {
  saveListState()
  sessionStorage.setItem('work-order-detail-from-list', '1')
  router.push({ name: 'WorkOrderDetail', query: { id } })
}

function goToCreate() {
  router.push({ name: 'WorkOrderCreate' })
}

function goVehicleHistory(order: any) {
  if (!order.plateNumber)
    return
  if (order.vehicleId) {
    router.push({ name: '/work-order/vehicle-history', query: { id: order.vehicleId, plate: order.plateNumber } })
  }
  else {
    router.push({ name: '/work-order/vehicle-history', query: { plate: order.plateNumber } })
  }
}

function formatDate(dateStr?: string) {
  if (!dateStr)
    return '-'
  return dateStr.slice(0, 10)
}

// ===== 列表状态缓存 =====
const LIST_STATE_KEY = 'work-order-list-state'
const STATE_MAX_AGE = 5 * 60 * 1000
// 标记是否已初始化（区分 onMounted 首次加载和 onActivated 重新激活）
let hasInitialized = false

function saveListState() {
  sessionStorage.setItem(
    LIST_STATE_KEY,
    JSON.stringify({
      searchForm: { ...searchForm },
      activeStatus: activeStatus.value,
      current: current.value,
      orders: orders.value,
      finished: finished.value,
      totalPaintCount: totalPaintCount.value,
      scrollTop: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0,
      timestamp: Date.now(),
    }),
  )
}

function restoreListState(): boolean {
  const raw = sessionStorage.getItem(LIST_STATE_KEY)
  if (!raw)
    return false
  try {
    const state = JSON.parse(raw)
    if (!state.timestamp || Date.now() - state.timestamp > STATE_MAX_AGE) {
      clearListState()
      return false
    }
    Object.assign(searchForm, state.searchForm || {})
    if (state.activeStatus !== undefined)
      activeStatus.value = state.activeStatus
    if (state.current !== undefined)
      current.value = state.current
    if (state.orders)
      orders.value = state.orders
    if (state.finished !== undefined)
      finished.value = state.finished
    if (state.totalPaintCount !== undefined)
      totalPaintCount.value = state.totalPaintCount
    nextTick(() => {
      window.scrollTo(0, state.scrollTop || 0)
    })
    return true
  }
  catch {
    clearListState()
    return false
  }
}

function clearListState() {
  sessionStorage.removeItem(LIST_STATE_KEY)
}

// 首页等携带状态筛选跳转（key 由首页设置，读取后清除）
const STATUS_QUERY_KEY = 'work-order-status-query'
function applyStatusFromSession(): boolean {
  const q = sessionStorage.getItem(STATUS_QUERY_KEY)
  if (!q)
    return false
  sessionStorage.removeItem(STATUS_QUERY_KEY)
  const idx = statusOptions.findIndex(o => o.value === q)
  if (idx === -1)
    return false
  activeStatus.value = idx
  searchForm.status = q as PaintOrderStatus
  return true
}

/**
 * onMounted 首次加载：尝试从 sessionStorage 恢复（如页面刷新场景），否则全新加载
 */
function initOnMounted() {
  const fromDetail = sessionStorage.getItem('work-order-detail-from-list') === '1'
  if (fromDetail) {
    sessionStorage.removeItem('work-order-detail-from-list')
    const restored = restoreListState()
    if (restored) {
      loadStatusCounts()
      return
    }
  }
  clearListState()
  applyStatusFromSession()
  loadOrders(true)
  loadStatusCounts()
}

/**
 * onActivated 重新激活（keepAlive 组件从详情页返回）
 * - 不强制重新加载列表（依赖 keepAlive 内存缓存保留列表数据）
 * - 但需刷新状态计数（详情页可能改了工单状态）
 * - 恢复滚动位置
 * - 重新设置 IntersectionObserver（防止组件被销毁重建后失效）
 * @param fromDetailExit 是否从详情页返回
 */
function reactivateOnActivated(fromDetailExit: boolean) {
  if (fromDetailExit) {
    sessionStorage.removeItem('work-order-detail-from-list')
    // 详情页可能修改了工单状态，刷新计数
    loadStatusCounts()
    // 恢复滚动位置（keepAlive 内存缓存保留了列表，但滚动位置可能丢失）
    const raw = sessionStorage.getItem(LIST_STATE_KEY)
    if (raw) {
      try {
        const state = JSON.parse(raw)
        if (state.timestamp && Date.now() - state.timestamp <= STATE_MAX_AGE) {
          nextTick(() => window.scrollTo(0, state.scrollTop || 0))
        }
      }
      catch { /* ignore */ }
    }
  }
  // 重新设置 IntersectionObserver（组件可能经历了 onDeactivate -> onActivate）
  nextTick(() => setupScrollObserver())
}

// ===== 批量 OCR =====
const selectionMode = ref(false)
const checkedOrderIds = ref<string[]>([])
const showBatchOcr = ref(false)
const batchOcrLoading = ref(false)
const batchOcrMode = ref<'selected' | 'all'>('selected')
const batchOcrFillMode = ref<'basic' | 'items' | 'all'>('all')
const batchOcrCancelled = ref(false)
const batchOcrProgress = ref({ current: 0, total: 0, success: 0, failed: 0, skipped: 0 })
const batchOcrResult = ref<{ success: number, failed: number, skipped: number, details: string[] } | null>(null)

function canBatchOcr(order: PaintWorkOrder): boolean {
  return (order.status === 'DRAFT' || order.status === 'PENDING') && !!order.images && order.images.length > 0
}

const ocrPendingSelectedCount = computed(() => orders.value.filter(o => checkedOrderIds.value.includes(o.id) && canBatchOcr(o)).length)
const ocrPendingAllCount = computed(() => orders.value.filter(o => canBatchOcr(o)).length)

function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value)
    checkedOrderIds.value = []
}

function toggleOrderChecked(id: string) {
  const idx = checkedOrderIds.value.indexOf(id)
  if (idx >= 0)
    checkedOrderIds.value.splice(idx, 1)
  else checkedOrderIds.value.push(id)
}

const allChecked = computed(() => {
  return orders.value.length > 0 && orders.value.every(o => checkedOrderIds.value.includes(o.id))
})

function toggleSelectAll() {
  if (allChecked.value) {
    checkedOrderIds.value = []
  }
  else {
    checkedOrderIds.value = orders.value.map(o => o.id)
  }
}

function openBatchOcr() {
  // 先检查是否有可处理的工单
  const pendingSelected = orders.value.filter(o => checkedOrderIds.value.includes(o.id) && canBatchOcr(o))
  const pendingAll = orders.value.filter(o => canBatchOcr(o))
  const pendingCount = checkedOrderIds.value.length > 0 ? pendingSelected.length : pendingAll.length
  if (pendingCount === 0) {
    showNotify({ type: 'warning', message: '没有可OCR处理的工单（需为草稿/待审核、有图片、有空白字段）' })
    return
  }
  batchOcrLoading.value = false
  batchOcrCancelled.value = false
  batchOcrResult.value = null
  batchOcrProgress.value = { current: 0, total: 0, success: 0, failed: 0, skipped: 0 }
  batchOcrMode.value = checkedOrderIds.value.length > 0 ? 'selected' : 'all'
  showBatchOcr.value = true
}

function cancelBatchOcr() {
  batchOcrCancelled.value = true
}

function closeBatchOcr() {
  if (batchOcrLoading.value)
    return
  showBatchOcr.value = false
}

function getOcrPendingOrders(): PaintWorkOrder[] {
  if (batchOcrMode.value === 'selected') {
    return orders.value.filter(o => checkedOrderIds.value.includes(o.id) && canBatchOcr(o))
  }
  return orders.value.filter(o => canBatchOcr(o))
}

async function handleBatchOcrFill() {
  const pendingOrders = getOcrPendingOrders()
  if (pendingOrders.length === 0) {
    showNotify({ type: 'warning', message: '没有符合条件的工单' })
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
      const imageUrl = order.images![0].url
      const file = await fetchImageAsFile(imageUrl)
      const compressed = await compressImage(file)
      const ocrResult = await ocrRecognizeImage(compressed, order.shopId, batchOcrFillMode.value)

      const updateData: any = { id: order.id }
      const filledFields: string[] = []

      if (!order.plateNumber && ocrResult.plateNumber) {
        updateData.plateNumber = ocrResult.plateNumber
        filledFields.push('车牌号')
      }
      if (ocrResult.orderNo) {
        if (!order.orderNo || order.orderNo !== ocrResult.orderNo) {
          updateData.orderNo = ocrResult.orderNo
          filledFields.push(order.orderNo ? '工单号(覆盖)' : '工单号')
        }
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
      if (ocrResult.vin) {
        if (!order.vin || order.vin !== ocrResult.vin) {
          updateData.vin = ocrResult.vin
          filledFields.push(order.vin ? '车架号(覆盖)' : '车架号')
        }
        // VIN 修正提示
        if ((ocrResult as any).vinCorrected && (ocrResult as any).vinOriginal) {
          details.push(`${order.orderNo || order.id}: 车架号自动修正「${(ocrResult as any).vinOriginal}」→「${ocrResult.vin}」`)
        }
      }
      if (ocrResult.brand) {
        if (!order.brand || order.brand !== ocrResult.brand) {
          updateData.brand = ocrResult.brand
          filledFields.push(order.brand ? '品牌(覆盖)' : '品牌')
        }
      }
      if (ocrResult.date) {
        const orderDateStr = order.orderDate ? order.orderDate.slice(0, 10) : ''
        if (!orderDateStr || orderDateStr !== ocrResult.date) {
          updateData.orderDate = ocrResult.date
          filledFields.push(orderDateStr ? '工单日期(覆盖)' : '工单日期')
        }
      }

      if (filledFields.length === 0) {
        batchOcrProgress.value.skipped++
        details.push(`${order.orderNo || order.id}: 识别结果无有效数据，跳过`)
        continue
      }

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

  await loadOrders(true)
  selectionMode.value = false
  checkedOrderIds.value = []
}

// ===== 批量结算 =====
const batchSettleLoading = ref(false)
const batchUnsettleLoading = ref(false)

const settleableIds = computed(() => {
  return orders.value
    .filter(o => checkedOrderIds.value.includes(o.id) && o.status === 'AUDITED')
    .map(o => o.id)
})

const unsettleableIds = computed(() => {
  return orders.value
    .filter(o => checkedOrderIds.value.includes(o.id) && o.status === 'SETTLED')
    .map(o => o.id)
})

async function handleBatchSettle() {
  const ids = settleableIds.value
  if (ids.length === 0) {
    showNotify({ type: 'warning', message: '选中的工单中没有可结算的（需为已审核状态）' })
    return
  }
  batchSettleLoading.value = true
  try {
    const res = await batchSettleWorkOrders(ids)
    if (res.failed === 0) {
      showNotify({ type: 'success', message: `批量结算成功：${res.success} 条` })
    }
    else {
      showNotify({ type: 'warning', message: `结算完成：成功 ${res.success} 条，失败 ${res.failed} 条` })
    }
    checkedOrderIds.value = []
    await loadOrders(true)
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '批量结算失败' })
  }
  finally {
    batchSettleLoading.value = false
  }
}

async function handleBatchUnsettle() {
  const ids = unsettleableIds.value
  if (ids.length === 0) {
    showNotify({ type: 'warning', message: '选中的工单中没有可取消结算的（需为已结算状态）' })
    return
  }
  batchUnsettleLoading.value = true
  try {
    const res = await batchUnsettleWorkOrders(ids)
    if (res.failed === 0) {
      showNotify({ type: 'success', message: `批量取消结算成功：${res.success} 条` })
    }
    else {
      showNotify({ type: 'warning', message: `取消结算完成：成功 ${res.success} 条，失败 ${res.failed} 条` })
    }
    checkedOrderIds.value = []
    await loadOrders(true)
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '批量取消结算失败' })
  }
  finally {
    batchUnsettleLoading.value = false
  }
}

function onCardClick(order: PaintWorkOrder) {
  if (selectionMode.value)
    toggleOrderChecked(order.id)
  else goToDetail(order.id)
}

// ===== 合并工单 =====
const showMergePopup = ref(false)
const mergeLoading = ref(false)
const mergeTarget = ref<PaintWorkOrder | null>(null)
const mergeCandidates = ref<PaintWorkOrder[]>([])
const mergeSelectedIds = ref<string[]>([])

async function openMergePopup(order: PaintWorkOrder) {
  if (!order.orderNo) {
    showNotify({ type: 'warning', message: '该工单缺少工单号，无法查找重复工单' })
    return
  }
  mergeTarget.value = order
  mergeSelectedIds.value = []
  mergeLoading.value = true
  showMergePopup.value = true
  try {
    const res = await findDuplicateWorkOrders(order.orderNo, order.id, order.settlementMonth)
    const list = (res as any as PaintWorkOrder[]) || []
    mergeCandidates.value = list
    mergeSelectedIds.value = list.map(o => o.id)
  }
  catch {
    showNotify({ type: 'danger', message: '查找重复工单失败' })
    mergeCandidates.value = []
  }
  finally {
    mergeLoading.value = false
  }
}

function toggleMergeSelect(orderId: string) {
  const idx = mergeSelectedIds.value.indexOf(orderId)
  if (idx >= 0)
    mergeSelectedIds.value.splice(idx, 1)
  else mergeSelectedIds.value.push(orderId)
}

async function handleMerge() {
  if (!mergeTarget.value || mergeSelectedIds.value.length === 0)
    return
  mergeLoading.value = true
  try {
    await mergeWorkOrders(mergeTarget.value.id, mergeSelectedIds.value)
    showNotify({ type: 'success', message: '工单合并成功' })
    showMergePopup.value = false
    mergeSelectedIds.value = []
    await loadOrders(true)
    await loadStatusCounts()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '合并失败' })
  }
  finally {
    mergeLoading.value = false
  }
}

// ===== 无限滚动 =====
const sentinelRef = ref<HTMLElement | null>(null)
let scrollObserver: IntersectionObserver | null = null

function setupScrollObserver() {
  if (!sentinelRef.value)
    return
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
    { root: null, rootMargin: '200px', threshold: 0 },
  )
  scrollObserver.observe(sentinelRef.value)
}

onMounted(() => {
  // 仅绑定 1 个门店时自动选中（沿用原 loadShops 的副作用，改为消费共享缓存）
  ensureShops().then((list) => {
    if (list.length === 1 && !searchForm.shopId)
      searchForm.shopId = list[0].id
  })
  loadCategories()
  loadScope()
  initOnMounted()
  nextTick(() => setupScrollObserver())
  hasInitialized = true
})

onBeforeUnmount(() => {
  if (scrollObserver) {
    scrollObserver.disconnect()
    scrollObserver = null
  }
  hasInitialized = false
})

onActivated(() => {
  // onMounted 之后会触发 onActivated，已初始化则跳过
  if (!hasInitialized) {
    initOnMounted()
    nextTick(() => setupScrollObserver())
    hasInitialized = true
    return
  }
  // 已初始化的重新激活：从详情页返回时刷新状态计数+恢复滚动+重设 observer
  const fromDetail = sessionStorage.getItem('work-order-detail-from-list') === '1'
  if (!fromDetail && applyStatusFromSession()) {
    // 从首页携带状态筛选进入，重新加载列表
    loadOrders(true)
    loadStatusCounts()
  }
  else {
    reactivateOnActivated(fromDetail)
  }
})
</script>

<template>
  <div class="order-page">
    <!-- 顶部搜索与快捷操作 -->
    <div class="top-bar">
      <div class="search-row">
        <van-search
          v-model="searchForm.plateNumber"
          placeholder="搜索车牌号 / 工单号"
          shape="round"
          clearable
          @search="onSearch"
          @clear="onSearch"
        />
      </div>
      <div class="action-row">
        <div class="filter-trigger" @click="showFilterPopup = true">
          <van-icon name="filter-o" size="20" color="var(--color-primary)" />
          <span class="filter-text">筛选</span>
        </div>
        <div class="filter-trigger" @click="router.push({ name: 'Vehicle' })">
          <van-icon name="logistics" size="20" color="var(--color-primary)" />
          <span class="filter-text">车辆</span>
        </div>
        <div class="filter-trigger" @click="router.push({ name: 'PendingImage' })">
          <van-icon name="photo-o" size="20" color="var(--color-primary)" />
          <span class="filter-text">图片池</span>
        </div>
        <div v-if="allowBatchOcr" class="filter-trigger" @click="toggleSelectionMode">
          <van-icon name="checked" size="20" :color="selectionMode ? '#52c41a' : 'var(--color-primary)'" />
          <span class="filter-text" :style="{ color: selectionMode ? '#52c41a' : 'var(--color-primary)' }">
            {{ selectionMode ? '取消' : '选择' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 数据可见范围提示（在岗期口径） -->
    <van-notice-bar
      v-if="scopeHintText && !scopeHintDismissed"
      mode="closeable"
      wrapable
      :scrollable="false"
      left-icon="info-o"
      :text="scopeHintText"
      color="#ed6a0c"
      background="#fffbe8"
      @close="scopeHintDismissed = true"
    />

    <!-- 状态标签 -->
    <div class="status-tabs-wrapper">
      <van-tabs
        v-model:active="activeStatus"
        swipeable
        sticky
        offset-top="0"
        @change="onStatusChange"
      >
        <van-tab v-for="item in statusOptions" :key="item.value">
          <template #title>
            <span class="tab-label">{{ item.label }}</span>
            <span class="tab-count">{{ statusCounts[item.key as keyof typeof statusCounts] || 0 }}</span>
          </template>
        </van-tab>
      </van-tabs>
    </div>

    <!-- 汇总 -->
    <div v-if="orders.length > 0" class="summary-bar">
      <span class="summary-text">共 {{ statusCounts[statusOptions[activeStatus].key as keyof typeof statusCounts] || 0 }} 单</span>
      <span class="summary-text">搜索总幅数 {{ formatPaintCount(totalPaintCount) }} 幅</span>
    </div>

    <!-- 列表 -->
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="order-list">
        <AppEmpty v-if="orders.length === 0 && !loading" description="暂无工单数据" />

        <div
          v-for="order in orders"
          :key="order.id"
          class="order-card"
          :class="{ checked: selectionMode && checkedOrderIds.includes(order.id), selecting: selectionMode }"
          @click="onCardClick(order)"
        >
          <div class="status-stripe" :class="`stripe-${orderStatusTagType(order.status)}`" />
          <van-checkbox
            v-if="selectionMode"
            :model-value="checkedOrderIds.includes(order.id)"
            shape="square"
            class="card-checkbox"
            @click.stop="toggleOrderChecked(order.id)"
          />
          <div class="card-body">
            <div class="card-top">
              <div class="plate-wrap" @click.stop="goVehicleHistory(order)">
                <van-icon name="logistics" size="16" color="var(--color-primary)" />
                <span class="plate-number">{{ order.plateNumber || '未识别车牌' }}</span>
              </div>
              <div class="card-tags">
                <van-tag v-if="order._isDuplicate" type="danger" size="medium" class="dup-tag">
                  重复 {{ order._duplicateCount }} 条
                </van-tag>
                <van-tag v-if="order._isDuplicate" type="warning" size="medium" @click.stop="openMergePopup(order)">
                  合并
                </van-tag>
                <van-tag v-if="order._hasOtherMonthSettlement" type="success" size="medium" class="cross-month-tag">
                  跨月结算
                </van-tag>
                <van-tag v-if="order._count?.images || order.images?.length" type="primary" size="medium">
                  <van-icon name="photo-o" size="12" />
                  <span>{{ order._count?.images ?? order.images?.length }}</span>
                </van-tag>
                <OrderStatusTag :status="order.status" size="medium" />
                <van-tag v-if="order.isAdjustment" type="warning" size="medium">
                  调整
                </van-tag>
                <van-tag v-if="order.isRework" type="danger" size="medium">
                  返工
                </van-tag>
              </div>
            </div>

            <div class="card-info">
              <div class="info-item">
                <span class="info-label">工单号</span>
                <span class="info-value">{{ order.orderNo || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">车型 / 品牌</span>
                <span class="info-value">{{ order.carModel || '-' }} {{ order.brand ? `· ${order.brand}` : '' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">门店</span>
                <span class="info-value">{{ getShopName(order.shopId) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">日期</span>
                <span class="info-value">{{ formatDate(order.orderDate) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">结算月份</span>
                <span class="info-value">{{ order.settlementMonth || '未结算' }}</span>
              </div>
            </div>

            <div class="card-bottom">
              <div class="customer">
                <van-icon name="user-o" size="12" color="var(--text-tertiary)" />
                <span>{{ order.customerName || '-' }}</span>
              </div>
              <div class="paint-count">
                <span class="count-value">{{ formatPaintCount(order.totalPaintCount) }}</span>
                <span class="count-unit">幅</span>
              </div>
            </div>
          </div>
        </div>

        <AppLoading v-if="loading" />

        <div v-if="finished && orders.length > 0" class="finished-text">
          没有更多了
        </div>

        <div ref="sentinelRef" class="scroll-sentinel" />
      </div>
    </van-pull-refresh>

    <!-- 悬浮建单按钮 -->
    <div v-if="allowEdit && !selectionMode" class="fab-create" @click="goToCreate">
      <van-icon name="plus" size="24" color="#fff" />
    </div>

    <!-- 选择模式底部栏 -->
    <div v-if="selectionMode" class="selection-bar">
      <div class="selection-row">
        <div class="selection-left" @click="toggleSelectAll">
          <van-checkbox :model-value="allChecked" shape="square" />
          <span class="select-all-text">全选</span>
        </div>
        <div class="selection-info">
          已选 <span class="count">{{ checkedOrderIds.length }}</span> 条
        </div>
        <van-button type="primary" size="small" round @click="openBatchOcr">
          OCR ({{ ocrPendingSelectedCount }})
        </van-button>
      </div>
      <div class="selection-row selection-actions">
        <van-button type="success" size="small" round block :disabled="settleableIds.length === 0" :loading="batchSettleLoading" @click="handleBatchSettle">
          批量结算 ({{ settleableIds.length }})
        </van-button>
        <van-button type="warning" size="small" round block :disabled="unsettleableIds.length === 0" :loading="batchUnsettleLoading" @click="handleBatchUnsettle">
          批量取消结算 ({{ unsettleableIds.length }})
        </van-button>
      </div>
    </div>

    <!-- 筛选弹窗 -->
    <van-popup v-model:show="showFilterPopup" position="right" :style="{ width: '80%', height: '100%' }">
      <div class="filter-popup">
        <div class="filter-popup-header">
          <span class="filter-popup-title">筛选条件</span>
          <van-icon name="cross" size="20" color="var(--text-tertiary)" @click="showFilterPopup = false" />
        </div>
        <div class="filter-popup-body">
          <div class="filter-group">
            <div class="filter-group-title">
              结算月份
            </div>
            <div class="filter-options">
              <div
                v-for="m in monthColumns"
                :key="m.value"
                class="filter-option"
                :class="{ active: searchForm.settlementMonth === m.value }"
                @click="searchForm.settlementMonth = m.value"
              >
                {{ m.text }}
              </div>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-group-title">
              所属门店
            </div>
            <div class="filter-options">
              <div
                v-for="s in shopColumns"
                :key="s.value"
                class="filter-option"
                :class="{ active: searchForm.shopId === s.value }"
                @click="searchForm.shopId = s.value"
              >
                {{ s.text }}
              </div>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-group-title">
              返工标记
            </div>
            <div class="filter-options">
              <div
                class="filter-option"
                :class="{ active: searchForm.isRework === undefined }"
                @click="searchForm.isRework = undefined"
              >
                全部
              </div>
              <div
                class="filter-option"
                :class="{ active: searchForm.isRework === true }"
                @click="searchForm.isRework = true"
              >
                是
              </div>
              <div
                class="filter-option"
                :class="{ active: searchForm.isRework === false }"
                @click="searchForm.isRework = false"
              >
                否
              </div>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-group-title">
              部位
            </div>
            <div class="filter-options">
              <div
                class="filter-option"
                :class="{ active: searchForm.categoryId === '' }"
                @click="searchForm.categoryId = ''"
              >
                全部部位
              </div>
              <div
                v-for="c in categories"
                :key="c.id"
                class="filter-option"
                :class="{ active: searchForm.categoryId === c.id }"
                @click="searchForm.categoryId = c.id"
              >
                {{ c.name }}
              </div>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-group-title">
              新件
            </div>
            <div class="filter-options">
              <div
                class="filter-option"
                :class="{ active: searchForm.isNewPart === undefined }"
                @click="searchForm.isNewPart = undefined"
              >
                全部
              </div>
              <div
                class="filter-option"
                :class="{ active: searchForm.isNewPart === true }"
                @click="searchForm.isNewPart = true"
              >
                仅新件
              </div>
            </div>
          </div>
        </div>
        <div class="filter-popup-footer">
          <van-button round block @click="resetFilter">
            重置
          </van-button>
          <van-button type="primary" round block @click="confirmFilter">
            确定
          </van-button>
        </div>
      </div>
    </van-popup>

    <!-- 批量 OCR 弹窗 -->
    <van-popup
      v-model:show="showBatchOcr"
      position="center"
      round
      :close-on-click-overlay="!batchOcrLoading"
      :closeable="!batchOcrLoading"
      class="batch-ocr-popup"
    >
      <div class="batch-ocr-content">
        <div class="batch-ocr-title">
          一键OCR识别填充
        </div>
        <div class="batch-ocr-desc">
          仅处理待审核/草稿状态、含图片且存在空白字段的工单。
        </div>
        <div class="batch-ocr-section-title">
          处理范围
        </div>
        <van-radio-group v-model="batchOcrMode" :disabled="batchOcrLoading" direction="horizontal" class="batch-ocr-mode">
          <van-radio name="selected" :disabled="checkedOrderIds.length === 0">
            选中工单
          </van-radio>
          <van-radio name="all">
            已加载全部
          </van-radio>
        </van-radio-group>
        <div class="batch-ocr-section-title">
          识别模式
        </div>
        <van-radio-group v-model="batchOcrFillMode" :disabled="batchOcrLoading" direction="horizontal" class="batch-ocr-mode">
          <van-radio name="all">
            全部
          </van-radio>
          <van-radio name="basic">
            仅基础资料
          </van-radio>
          <van-radio name="items">
            仅部位
          </van-radio>
        </van-radio-group>
        <div class="batch-ocr-pending">
          可处理数量：<van-tag type="success">
            {{ batchOcrMode === 'selected' ? ocrPendingSelectedCount : ocrPendingAllCount }} 条
          </van-tag>
        </div>
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
            <van-tag type="success" size="medium">
              成功 {{ batchOcrProgress.success }}
            </van-tag>
            <van-tag type="danger" size="medium">
              失败 {{ batchOcrProgress.failed }}
            </van-tag>
            <van-tag type="warning" size="medium">
              跳过 {{ batchOcrProgress.skipped }}
            </van-tag>
          </div>
        </div>
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
        <div class="batch-ocr-actions">
          <van-button v-if="batchOcrLoading" type="danger" round block @click="cancelBatchOcr">
            取消处理
          </van-button>
          <van-button v-else-if="batchOcrResult" type="primary" round block @click="closeBatchOcr">
            关闭
          </van-button>
          <van-button
            v-else
            type="primary"

            round block
            :disabled="(batchOcrMode === 'selected' ? ocrPendingSelectedCount : ocrPendingAllCount) === 0"
            :loading="batchOcrLoading"
            @click="handleBatchOcrFill"
          >
            开始识别填充
          </van-button>
        </div>
      </div>
    </van-popup>

    <!-- 合并工单弹窗 -->
    <van-popup v-model:show="showMergePopup" position="bottom" round :style="{ maxHeight: '80%' }">
      <div class="merge-popup">
        <div class="merge-popup-header">
          <span class="merge-popup-title">合并重复工单</span>
          <van-icon name="cross" size="20" color="var(--text-tertiary)" @click="showMergePopup = false" />
        </div>
        <AppLoading v-if="mergeLoading && mergeCandidates.length === 0" />
        <div v-else-if="mergeCandidates.length === 0" class="merge-empty">
          未找到重复工单
        </div>
        <div v-else class="merge-body">
          <div class="merge-tip">
            仅合并图片；若当前工单缺少车牌号、车型等基础信息会自动补齐；当前工单幅数明细保持不变。
          </div>
          <div class="merge-target">
            <div class="merge-target-title">
              当前工单
            </div>
            <div class="merge-target-info">
              <div class="merge-target-plate">
                {{ mergeTarget?.plateNumber || '未识别车牌' }}
              </div>
              <div class="merge-target-no">
                {{ mergeTarget?.orderNo || '-' }}
              </div>
            </div>
          </div>
          <div class="merge-candidates">
            <div class="merge-candidates-title">
              选择要合并的工单（已选 {{ mergeSelectedIds.length }} 条）
            </div>
            <div
              v-for="order in mergeCandidates"
              :key="order.id"
              class="merge-candidate"
              :class="{ selected: mergeSelectedIds.includes(order.id) }"
              @click="toggleMergeSelect(order.id)"
            >
              <van-checkbox
                :model-value="mergeSelectedIds.includes(order.id)"
                shape="square"
                class="merge-candidate-checkbox"
                @click.stop
              />
              <div class="merge-candidate-main">
                <div class="merge-candidate-plate">
                  {{ order.plateNumber || '未识别车牌' }}
                </div>
                <div class="merge-candidate-meta">
                  {{ order.shop?.name || getShopName(order.shopId) }} · {{ order.images?.length || 0 }} 张图片 · {{ formatDate(order.orderDate) }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="merge-actions">
          <van-button round block :disabled="mergeSelectedIds.length === 0" :loading="mergeLoading" type="danger" @click="handleMerge">
            合并选中的 {{ mergeSelectedIds.length }} 条工单
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
  background: var(--color-bg);
  padding-bottom: 120px;
}

.top-bar {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.search-row {
  padding: 8px 12px 0;

  :deep(.van-search) {
    padding: 0;
    background: transparent;
  }
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 6px 8px 10px;
}

.filter-trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 2px;
}

.filter-text {
  font-size: 11px;
  color: var(--color-primary);
}

.status-tabs-wrapper {
  background: var(--color-surface);

  :deep(.van-tabs__wrap) {
    border-bottom: 1px solid var(--color-border);
  }

  :deep(.van-tab) {
    padding: 0 12px;
  }
}

.tab-label {
  font-size: 14px;
}

.tab-count {
  display: inline-block;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  padding: 0 5px;
  margin-left: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--color-border);
  border-radius: 8px;
  text-align: center;
}

:deep(.van-tab--active) .tab-count {
  color: #fff;
  background: var(--color-primary);
}

.summary-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: var(--color-bg);
  font-size: 13px;
  color: var(--text-secondary);
}

.order-list {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.order-card {
  position: relative;
  overflow: hidden;
  background: var(--color-surface);
  border-radius: 12px;
  padding: 14px 14px 14px 18px;
  display: flex;
  box-shadow: var(--shadow-card);
}

.order-card.checked {
  background: var(--color-info-bg);
  border: 1px solid var(--color-primary);
}

.order-card.selecting .card-top {
  padding-right: 30px;
}

.status-stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;

  &.stripe-primary {
    background: var(--color-primary);
  }
  &.stripe-success {
    background: var(--color-success);
  }
  &.stripe-warning {
    background: var(--color-warning);
  }
  &.stripe-danger {
    background: var(--color-danger);
  }
}

.card-checkbox {
  position: absolute;
  top: 12px;
  right: 10px;
  z-index: 2;
}

.card-body {
  flex: 1;
  min-width: 0;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.plate-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 2px 8px 2px 4px;
  border-radius: 4px;
  transition: background-color 0.2s;

  &:active {
    background-color: rgba(22, 119, 255, 0.1);
  }
}

.plate-number {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-primary);
}

.card-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.card-info {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.info-value {
  font-size: 13px;
  color: var(--text-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid var(--neutral-100);
}

.customer {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.paint-count {
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

.loading-wrap {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}

.finished-text {
  text-align: center;
  padding: 20px 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.scroll-sentinel {
  height: 1px;
}

.fab-create {
  position: fixed;
  right: 16px;
  bottom: 80px;
  width: 52px;
  height: 52px;
  border-radius: 26px;
  background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #fff));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(22, 119, 255, 0.35);
  z-index: 100;
}

.selection-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
  background: var(--color-surface);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
  z-index: 101;
}

.selection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.selection-actions {
  gap: 10px;
}

.selection-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.select-all-text {
  font-size: 14px;
  color: var(--text-regular);
}

.selection-info {
  font-size: 14px;
  color: var(--text-secondary);

  .count {
    color: var(--color-primary);
    font-weight: 600;
  }
}

.filter-popup {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
}

.filter-popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--color-surface);
}

.filter-popup-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-regular);
}

.filter-popup-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.filter-group {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.filter-group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-regular);
  margin-bottom: 12px;
}

.filter-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.filter-option {
  padding: 8px 14px;
  background: var(--color-bg);
  border-radius: 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

.filter-option.active {
  background: var(--color-info-bg);
  color: var(--color-primary);
}

.filter-popup-footer {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
}

.batch-ocr-popup {
  width: 85%;
  max-height: 80%;
}

.batch-ocr-content {
  padding: 20px;
}

.batch-ocr-title {
  font-size: 17px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 12px;
}

.batch-ocr-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.batch-ocr-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-regular);
  margin-bottom: 8px;
}

.batch-ocr-mode {
  margin-bottom: 16px;
}

.batch-ocr-pending {
  font-size: 14px;
  color: var(--text-regular);
  margin-bottom: 16px;
}

.batch-ocr-progress {
  margin-bottom: 16px;
}

.progress-head {
  display: flex;
  justify-content: flex-end;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.progress-stats {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.batch-ocr-result {
  max-height: 200px;
  overflow-y: auto;
  background: var(--color-bg);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.result-summary {
  font-size: 14px;
  color: var(--color-success);
  margin-bottom: 8px;
}

.result-summary.has-failed {
  color: var(--color-error);
}

.detail-line {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.batch-ocr-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.merge-popup {
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.merge-popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.merge-popup-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-regular);
}

.merge-loading,
.merge-empty {
  padding: 40px 16px;
  text-align: center;
  font-size: 14px;
  color: var(--text-tertiary);
}

.merge-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.merge-tip {
  font-size: 12px;
  color: var(--color-warning);
  background: var(--color-warning-bg);
  border-radius: 8px;
  padding: 10px 12px;
  line-height: 1.5;
  margin-bottom: 16px;
}

.merge-target {
  background: var(--color-bg);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 16px;
}

.merge-target-title {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.merge-target-plate {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-regular);
  margin-bottom: 4px;
}

.merge-target-no {
  font-size: 13px;
  color: var(--text-secondary);
}

.merge-candidates-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-regular);
  margin-bottom: 10px;
}

.merge-candidate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--color-bg);
  margin-bottom: 8px;
}

.merge-candidate.selected {
  background: var(--color-info-bg);
}

.merge-candidate-checkbox {
  flex-shrink: 0;
}

.merge-candidate-main {
  flex: 1;
  min-width: 0;
}

.merge-candidate-plate {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-regular);
  margin-bottom: 4px;
}

.merge-candidate-meta {
  font-size: 12px;
  color: var(--text-tertiary);
}

.merge-actions {
  padding: 12px 16px 24px;
  border-top: 1px solid var(--color-border);
}
</style>
