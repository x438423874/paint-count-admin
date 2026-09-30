<script setup lang="ts">
import {
  autoMatchPendingImage,
  correctPendingImageOcr,
  createOrderFromPending,
  deletePendingImage,
  getPendingImageCandidates,
  getPendingImagePage,
  getPendingImageStatusCounts,
  getWorkOrderPage,
  manualMatchPendingImage,
  retryOcrPendingImage,
  uploadPendingImage,
} from '@/api/paint'
import type { PaintPendingImage, PendingImageStatus, PendingImageStatusCounts } from '@/api/types/paint'
import { showImagePreview, showNotify } from 'vant'
import { confirmAction } from '@/composables/useConfirm'
import { describeUploadError, uploadCompressed } from '@/composables/useImageUpload'
import { recentMonthOptions } from '@/utils/month-options'
import { resolveImageUrl } from '@/utils/image-url'
import { canEdit as canEditRole, canPending } from '@/utils/permission'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'
import { useShopOptions } from '@/composables/useShopOptions'

const router = useRouter()
const allowEdit = canEditRole()

// 上传门槛：需已选门店 + 已选结算月（封单校验由后端兜底）
const canUpload = computed(() => canPending('upload') && !!selectedShopId.value && !!selectedMonth.value)

// 门店走 dict store 共享缓存，全应用只请求一次（原为每页各自 getShopList）
const { ensureShops, getShopName } = useShopOptions()
const selectedShopId = ref('')
const selectedMonth = ref('')
const selectedStatus = ref<PendingImageStatus | ''>('')
const keyword = ref('')

const list = ref<PaintPendingImage[]>([])
const loading = ref(false)
const finished = ref(false)
const current = ref(1)
const size = 20
const refreshing = ref(false)

const counts = reactive<PendingImageStatusCounts>({ PENDING: 0, MATCHED: 0, NEEDS_REVIEW: 0, MANUAL: 0, FAILED: 0, total: 0 })

const statusOptions: { label: string, value: PendingImageStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '待匹配', value: 'PENDING' },
  { label: '待确认', value: 'NEEDS_REVIEW' },
  { label: '已归类', value: 'MATCHED' },
  { label: '失败', value: 'FAILED' },
]
const activeStatus = ref(0)

// 状态标签对应的计数（合并到 tab 标题上显示，替代原独立统计条）
const tabStat = computed<Record<string, number>>(() => ({
  '': counts.total,
  'PENDING': counts.PENDING,
  'NEEDS_REVIEW': counts.NEEDS_REVIEW,
  'MATCHED': counts.MATCHED + counts.MANUAL,
  'FAILED': counts.FAILED,
}))

const statusLabel: Record<string, string> = {
  PENDING: '待匹配',
  MATCHED: '已归类',
  NEEDS_REVIEW: '待确认',
  MANUAL: '人工',
  FAILED: '失败',
}
const statusColor: Record<string, string> = {
  PENDING: 'var(--color-warning)',
  MATCHED: 'var(--color-success)',
  NEEDS_REVIEW: 'var(--color-primary)',
  MANUAL: 'var(--color-success)',
  FAILED: 'var(--color-error)',
}
// 图片来源：POOL=图片池直接上传（用于匹配已有工单）；CREATE=新建工单时带图上传
const sourceLabel: Record<string, string> = {
  POOL: '匹配',
  CREATE: '新建',
}
const sourceColor: Record<string, string> = {
  POOL: 'var(--color-primary)',
  CREATE: 'var(--color-success)',
}

/** OCR 生命周期：PENDING/PROCESSING 表示识别中，用户可离开页面 */
function ocrState(item: PaintPendingImage): 'processing' | 'done' | 'failed' {
  const s = item.ocrStatus
  if (s === 'PENDING' || s === 'PROCESSING')
    return 'processing'
  if (s === 'FAILED')
    return 'failed'
  return 'done'
}

// 轮询：存在“识别中”卡片时，每 3s 原地刷新状态（保留滚动位置），全部完成自动停止
let pollTimer: ReturnType<typeof setInterval> | null = null
const hasRecognizing = computed(() => list.value.some(it => ocrState(it) === 'processing'))

async function pollStatuses() {
  try {
    const res: any = await getPendingImagePage({
      current: current.value,
      size,
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      status: (selectedStatus.value || undefined) as any,
      keyword: keyword.value || undefined,
    })
    const records = (res?.records || []) as PaintPendingImage[]
    const map = new Map(records.map(r => [r.id, r]))
    for (const it of list.value) {
      const upd = map.get(it.id)
      if (upd) {
        it.ocrStatus = upd.ocrStatus
        it.status = upd.status
        it.ocrOrderNo = upd.ocrOrderNo
        it.ocrPlateNumber = upd.ocrPlateNumber
        it.ocrCarModel = upd.ocrCarModel
        it.matchedOrderId = upd.matchedOrderId
        it.matchRemark = upd.matchRemark
        it.order = upd.order
      }
    }
  }
  catch {
    // 轮询失败忽略，下一轮继续
  }
  await loadCounts()
  if (!hasRecognizing.value)
    stopPolling()
}

function startPollingIfNeeded() {
  if (hasRecognizing.value && !pollTimer) {
    pollTimer = setInterval(pollStatuses, 3000)
  }
  else if (!hasRecognizing.value && pollTimer) {
    stopPolling()
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const showShopPicker = ref(false)
const showMonthPicker = ref(false)

function onShopConfirm(value: string) {
  selectedShopId.value = value
  onSearch()
}

// 月份列统一走 recentMonthOptions（全部月份 + 近 12 个月）
const monthColumns = computed(() => recentMonthOptions({ includeAll: true }))

async function loadCounts() {
  try {
    const res = await getPendingImageStatusCounts(selectedShopId.value || undefined, selectedMonth.value || undefined)
    Object.assign(counts, res)
  }
  catch {
    // ignore
  }
}

// 递增令牌：重置加载时让过期响应失效，避免并发/竞态导致列表不刷新或错乱
let loadToken = 0

async function loadData(reset = false) {
  // 滚动加载（非重置）时才受 loading/finished 限制；重置（刷新/切换筛选）必须执行
  if (!reset && (loading.value || finished.value))
    return
  if (reset) {
    current.value = 1
    list.value = []
    finished.value = false
  }
  const token = ++loadToken
  loading.value = true
  try {
    const res: any = await getPendingImagePage({
      current: current.value,
      size,
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      status: (selectedStatus.value || undefined) as any,
      keyword: keyword.value || undefined,
    })
    if (token !== loadToken)
      return // 已有更新的请求，丢弃本次过期结果
    const records = res?.records || []
    list.value.push(...records)
    if (list.value.length >= (res?.total || 0) || records.length === 0) {
      finished.value = true
    }
    current.value++
  }
  catch {
    if (token === loadToken)
      finished.value = true
  }
  finally {
    if (token === loadToken) {
      loading.value = false
      refreshing.value = false
      startPollingIfNeeded()
    }
  }
}

function onLoad() {
  loadData(false)
}

function onRefresh() {
  loadData(true)
  loadCounts()
}

/** 筛选条件变化：重置列表并重新加载（列表 + 计数） */
function applyFilter() {
  loadData(true)
  loadCounts()
}

function onStatusChange(idx: number) {
  selectedStatus.value = statusOptions[idx].value as any
  applyFilter()
}

function onSearch() {
  applyFilter()
}

// ==================== 上传 ====================
const uploading = ref(false)
const uploadDone = ref(0)
const uploadTotal = ref(0)

async function onAfterRead(fileItem: any) {
  // 支持多选
  const files: any[] = Array.isArray(fileItem) ? fileItem : [fileItem]
  if (!selectedShopId.value) {
    showNotify({ type: 'warning', message: '请先选择门店' })
    return
  }
  if (!selectedMonth.value) {
    showNotify({ type: 'warning', message: '请先选择结算月份' })
    return
  }
  uploading.value = true
  uploadTotal.value = files.length
  uploadDone.value = 0
  for (const f of files) {
    // 压缩 + 上传（429/5xx 自动重试，统一走 useImageUpload）
    const result = await uploadCompressed(
      f.file as File,
      (compressed, thumbnail) => uploadPendingImage(compressed, selectedShopId.value, selectedMonth.value || undefined, 'POOL', thumbnail),
    )
    if (result.ok) {
      uploadDone.value++
    }
    else {
      showNotify({ type: 'danger', message: `上传失败: ${describeUploadError(result.error)}` })
    }
  }
  uploading.value = false
  if (uploadDone.value === uploadTotal.value) {
    showNotify({ type: 'success', message: `上传完成 ${uploadDone.value}/${uploadTotal.value}，正在后台识别…` })
  }
  else {
    showNotify({ type: 'warning', message: `上传完成 ${uploadDone.value}/${uploadTotal.value}，部分失败` })
  }
  onRefresh()
}

// ==================== 操作 ====================
async function onAutoMatch(item: PaintPendingImage) {
  try {
    const res: any = await autoMatchPendingImage(item.id)
    if (res?.status === 'MATCHED' || res?.status === 'MANUAL') {
      showNotify({ type: 'success', message: '已归类' })
    }
    else if (res?.status === 'NEEDS_REVIEW') {
      showNotify({ type: 'warning', message: '命中多个候选，请人工确认' })
    }
    else {
      showNotify({ type: 'primary', message: res?.remark || '暂无匹配' })
    }
    onRefresh()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
}

async function onRetryOcr(item: PaintPendingImage) {
  try {
    await retryOcrPendingImage(item.id)
    showNotify({ type: 'success', message: '已提交重试，正在后台识别…' })
    onRefresh()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
}

async function onCreateOrder(item: PaintPendingImage) {
  // 防重复预检：同结算月内同工单号的工单可能已通过 Excel 导入存在。
  // 命中时直接引导「一键归类到该工单」，而不是补建出重复单（幅数会重复计入结算）。
  const orderNo = (item.ocrOrderNo || '').trim()
  if (orderNo) {
    try {
      const res: any = await getWorkOrderPage({
        shopId: selectedShopId.value || undefined,
        settlementMonth: selectedMonth.value || undefined,
        orderNo,
        current: 1,
        size: 1,
      })
      const existed = res?.records?.[0]
      if (existed) {
        confirmAction({
          title: '发现系统已有该工单',
          message: `系统已存在工单号 ${orderNo} 的工单（可能为导入数据）。是否直接把这张图片归类到该工单？`,
        })
          .then(async () => {
            try {
              await manualMatchPendingImage(item.id, existed.id)
              showNotify({ type: 'success', message: `已归类到工单 ${existed.orderNo || orderNo}` })
              onRefresh()
            }
            catch (e: any) {
              showNotify({ type: 'danger', message: e?.response?.data?.message || e?.message || '归类失败' })
            }
          })
          .catch(() => void 0)
        return
      }
    }
    catch {
      // 预检失败不阻断补建，后端仍有兜底校验
    }
  }

  confirmAction({
    title: '补建工单',
    message: '将用 OCR 基础资料创建一条无幅数工单并归类该图片，是否继续？',
  }).then(async () => {
    try {
      await createOrderFromPending(item.id, selectedMonth.value || undefined)
      showNotify({ type: 'success', message: '已补建工单并归类' })
      onRefresh()
    }
    catch (e: any) {
      showNotify({ type: 'danger', message: e?.response?.data?.message || e?.message || '操作失败' })
    }
  }).catch(() => void 0)
}

function onDelete(item: PaintPendingImage) {
  confirmAction({
    title: '删除图片',
    message: '确定删除该图片？',
  }).then(async () => {
    try {
      await deletePendingImage(item.id)
      showNotify({ type: 'success', message: '已删除' })
      onRefresh()
    }
    catch (e: any) {
      showNotify({ type: 'danger', message: e?.message || '操作失败' })
    }
  }).catch(() => void 0)
}

// ==================== 修正识别结果 ====================
// 待匹配(PENDING)/待确认(NEEDS_REVIEW)/失败(FAILED) 均可修正后重新匹配
function canCorrect(item: PaintPendingImage) {
  return canPending('correct') && !item._sealed && ocrState(item) !== 'processing' && item.status !== 'MATCHED' && item.status !== 'MANUAL'
}

const correctPopup = reactive({
  show: false,
  submitting: false,
  pendingId: '',
  previewUrl: '',
})
const correctForm = reactive<Record<string, string>>({
  orderNo: '',
  plateNumber: '',
  vin: '',
  carModel: '',
  brand: '',
  customerName: '',
  phone: '',
  date: '',
})
const correctMonth = ref('')
const showCorrectMonthPicker = ref(false)

const correctFields: { key: string, label: string, placeholder: string }[] = [
  { key: 'orderNo', label: '工单号', placeholder: '用于匹配工单的关键字段' },
  { key: 'plateNumber', label: '车牌号', placeholder: '工单号缺失时按车牌匹配' },
  { key: 'vin', label: '车架号', placeholder: 'VIN' },
  { key: 'carModel', label: '车型', placeholder: '如 别克君威' },
  { key: 'brand', label: '品牌', placeholder: '如 别克' },
  { key: 'customerName', label: '客户名称', placeholder: '客户姓名' },
  { key: 'phone', label: '电话', placeholder: '联系电话' },
  { key: 'date', label: '工单日期', placeholder: 'YYYY-MM-DD' },
]

function openCorrectPopup(item: PaintPendingImage) {
  correctPopup.pendingId = item.id
  correctPopup.previewUrl = resolveImageUrl(item.url)
  correctForm.orderNo = item.ocrOrderNo || ''
  correctForm.plateNumber = item.ocrPlateNumber || ''
  correctForm.vin = item.ocrVin || ''
  correctForm.carModel = item.ocrCarModel || ''
  correctForm.brand = item.ocrBrand || ''
  correctForm.customerName = item.ocrCustomerName || ''
  correctForm.phone = item.ocrPhone || ''
  correctForm.date = item.ocrDate || ''
  correctMonth.value = item.settlementMonth || ''
  correctPopup.show = true
}

async function submitCorrect(rematch: boolean) {
  if (!correctPopup.pendingId)
    return
  correctPopup.submitting = true
  try {
    const res: any = await correctPendingImageOcr(
      correctPopup.pendingId,
      {
        orderNo: correctForm.orderNo,
        plateNumber: correctForm.plateNumber,
        vin: correctForm.vin,
        carModel: correctForm.carModel,
        brand: correctForm.brand,
        customerName: correctForm.customerName,
        phone: correctForm.phone,
        date: correctForm.date,
        settlementMonth: correctMonth.value || '',
      },
      rematch,
    )
    const match = res?.match
    if (!rematch) {
      showNotify({ type: 'success', message: '识别结果已保存' })
    }
    else if (match?.status === 'MATCHED' || match?.status === 'MANUAL') {
      showNotify({ type: 'success', message: '已修正并归类到工单' })
    }
    else if (match?.status === 'NEEDS_REVIEW') {
      showNotify({ type: 'warning', message: '已修正，命中多个候选，请人工指派' })
    }
    else {
      showNotify({ type: 'primary', message: match?.remark || '已修正，仍未匹配到工单' })
    }
    correctPopup.show = false
    onRefresh()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
  finally {
    correctPopup.submitting = false
  }
}

// ==================== 人工指派 ====================
const matchPopup = reactive({
  show: false,
  pendingId: '',
  candidates: [] as any[],
  searchKeyword: '',
  searching: false,
})
const searchResults = ref<any[]>([])

const WORK_ORDER_STATUS_TEXT: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  AUDITED: '已审核',
  SETTLED: '已结算',
  ABNORMAL: '异常',
  VOID: '已作废',
}
function statusText(s: string) {
  return WORK_ORDER_STATUS_TEXT[s] || s
}
function statusTagType(s: string): 'default' | 'warning' | 'success' | 'primary' | 'danger' {
  if (s === 'AUDITED') return 'success'
  if (s === 'SETTLED') return 'primary'
  if (s === 'ABNORMAL' || s === 'VOID') return 'danger'
  if (s === 'PENDING') return 'warning'
  return 'default'
}

function openMatchPopup(item: PaintPendingImage) {
  matchPopup.pendingId = item.id
  matchPopup.searchKeyword = ''
  searchResults.value = []
  matchPopup.show = true
  loadCandidates(item.id)
}

async function loadCandidates(id: string) {
  try {
    const res: any = await getPendingImageCandidates(id)
    matchPopup.candidates = res || []
  }
  catch {
    matchPopup.candidates = []
  }
}

async function searchOrders() {
  const kw = matchPopup.searchKeyword.trim()
  if (!kw)
    return
  matchPopup.searching = true
  try {
    const res: any = await getWorkOrderPage({
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      plateNumber: kw,
      current: 1,
      size: 20,
    } as any)
    // 已审核/已结算/异常/作废的工单不可再归类，过滤掉避免误点触发拦截
    const LOCKED = new Set(['AUDITED', 'SETTLED', 'ABNORMAL', 'VOID'])
    searchResults.value = (res?.records || []).filter((o: any) => !LOCKED.has(o.status))
  }
  catch {
    searchResults.value = []
  }
  finally {
    matchPopup.searching = false
  }
}

async function confirmMatch(orderId: string) {
  try {
    await manualMatchPendingImage(matchPopup.pendingId, orderId)
    showNotify({ type: 'success', message: '已归类' })
    matchPopup.show = false
    onRefresh()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
}

onMounted(async () => {
  const list = await ensureShops()
  // 仅绑定 1 个门店时自动选中（沿用原 loadShops 副作用）
  if (list.length === 1 && !selectedShopId.value)
    selectedShopId.value = list[0].id
  applyFilter()
})

// 返回页面时刷新（捕获后台识别进度）；离开/卸载时停止轮询
onActivated(() => {
  applyFilter()
})
onDeactivated(() => stopPolling())
onUnmounted(() => stopPolling())
</script>

<template>
  <div class="pending-page">
    <van-nav-bar title="图片池" left-arrow @click-left="router.back()" />

    <!-- 顶部筛选与上传 -->
    <div class="filter-header">
      <van-search
        v-model="keyword"
        placeholder="工单号 / 车牌"
        shape="round"
        clearable
        @search="onSearch"
        @clear="onSearch"
      />
      <div class="filter-bar">
        <div class="chip" @click="showShopPicker = true">
          <van-icon name="shop-o" size="14" color="var(--text-secondary)" />
          <span class="chip-text">{{ getShopName(selectedShopId) }}</span>
          <van-icon name="arrow-down" size="12" color="var(--text-tertiary)" />
        </div>
        <div class="chip" @click="showMonthPicker = true">
          <van-icon name="calendar-o" size="14" color="var(--text-secondary)" />
          <span class="chip-text">{{ selectedMonth || '全部月份' }}</span>
          <van-icon name="arrow-down" size="12" color="var(--text-tertiary)" />
        </div>
        <van-uploader
          v-if="canPending('upload')"
          :after-read="onAfterRead"
          multiple
          accept="image/jpeg,image/png,image/webp"
          :preview-image="false"
          :disabled="!canUpload"
        >
          <van-button
            size="small"
            type="primary"
            icon="photo-o"
            :loading="uploading"
            :disabled="!canUpload"
          >
            {{ uploading ? `上传 ${uploadDone}/${uploadTotal}` : !selectedShopId ? '先选门店' : !selectedMonth ? '先选月份' : '上传图片' }}
          </van-button>
        </van-uploader>
      </div>
    </div>

    <!-- 状态标签（带上计数，替代原独立统计条） -->
    <van-tabs v-model:active="activeStatus" class="tabs-bar" @change="onStatusChange">
      <van-tab v-for="item in statusOptions" :key="item.value">
        <template #title>
          <span class="tab-title">
            {{ item.label }}
            <span class="tab-count" :class="{ active: (tabStat[item.value] || 0) > 0 }">{{ tabStat[item.value] || 0 }}</span>
          </span>
        </template>
      </van-tab>
    </van-tabs>

    <!-- 列表 -->
    <div class="list-wrapper">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="没有更多了"
          loading-text="加载中..."
          :immediate-check="false"
          @load="onLoad"
        >
          <AppEmpty v-if="!loading && list.length === 0" description="暂无图片" />

          <div v-for="item in list" :key="item.id" class="card-item">
            <van-card>
              <template #thumb>
                <van-image
                  :src="resolveImageUrl(item.thumbnailUrl || item.url)"
                  width="100%" height="100%" fit="cover"
                  @click="showImagePreview({ images: [resolveImageUrl(item.url)] })"
                />
              </template>
              <template #title>
                <div class="card-title">
                  <van-tag v-if="ocrState(item) === 'processing'" color="var(--color-primary)" plain size="medium">
                    <van-loading size="12px" style="margin-right: 4px" />识别中
                  </van-tag>
                  <van-tag v-else :color="statusColor[item.status]" plain size="medium">
                    {{ statusLabel[item.status] }}
                  </van-tag>
                  <van-tag v-if="item.source" :color="sourceColor[item.source]" plain size="medium">
                    {{ sourceLabel[item.source] }}
                  </van-tag>
                  <van-tag v-if="item._sealed" type="danger" size="medium">
                    已封单
                  </van-tag>
                  <span class="month-tag">{{ item.settlementMonth || '未指定月份' }}</span>
                </div>
              </template>
              <template #desc>
                <div class="card-desc">
                  <div>工单号: {{ item.ocrOrderNo || '-' }}</div>
                  <div>车牌: {{ item.ocrPlateNumber || '-' }}</div>
                  <div v-if="item.ocrCarModel">
                    车型: {{ item.ocrCarModel }}
                  </div>
                  <div v-if="item.matchRemark" class="remark">
                    {{ item.matchRemark }}
                  </div>
                  <div v-if="item.matchedOrderId && item.order" class="matched">
                    已归类: {{ item.order.orderNo || item.order.plateNumber || item.order.id }}
                  </div>
                </div>
              </template>
              <template #footer>
                <div v-if="allowEdit" class="card-actions">
                  <span v-if="ocrState(item) === 'processing'" class="recognizing-hint">识别中，请稍候…</span>
                  <template v-else>
                    <van-button v-if="canCorrect(item)" size="mini" @click="openCorrectPopup(item)">
                      修正
                    </van-button>
                    <template v-if="!item._sealed">
                    <van-button v-if="canPending('match')" size="mini" @click="onAutoMatch(item)">
                      匹配
                    </van-button>
                    <van-button
                      v-if="canPending('assign') && (item.status === 'NEEDS_REVIEW' || item.status === 'PENDING')"
                      size="mini" type="primary" @click="openMatchPopup(item)"
                    >
                      指派
                    </van-button>
                    <van-button
                      v-if="canPending('create-order') && item.status !== 'MATCHED' && item.status !== 'MANUAL'"
                      size="mini" type="warning" @click="onCreateOrder(item)"
                    >
                      补建
                    </van-button>
                    <van-button v-if="canPending('retry') && item.status === 'FAILED'" size="mini" @click="onRetryOcr(item)">
                      重试
                    </van-button>
                  </template>
                  <van-button v-if="canPending('delete') && !item._sealed" size="mini" type="danger" plain @click="onDelete(item)">
                    删除
                  </van-button>
                  </template>
                </div>
              </template>
            </van-card>
          </div>
        </van-list>
      </van-pull-refresh>
    </div>

    <!-- 门店选择 -->
    <ShopPicker v-model:show="showShopPicker" :model-value="selectedShopId" @confirm="onShopConfirm" />
    <!-- 月份选择 -->
    <PopupPicker
      v-model:show="showMonthPicker"
      :columns="monthColumns"
      :model-value="selectedMonth"
      title="选择月份"
      @confirm="(v: string) => { selectedMonth = v; onSearch() }"
    />

    <!-- 修正月份选择 -->
    <PopupPicker
      v-model:show="showCorrectMonthPicker"
      :columns="monthColumns"
      :model-value="correctMonth"
      title="选择月份"
      @confirm="(v: string) => { correctMonth = v }"
    />

    <!-- 修正识别结果弹窗 -->
    <van-popup v-model:show="correctPopup.show" position="bottom" round :style="{ height: '85%' }">
      <div class="correct-popup">
        <van-nav-bar title="修正识别结果" left-text="取消" @click-left="correctPopup.show = false" />
        <div class="correct-body">
          <div class="correct-preview" @click="showImagePreview({ images: [correctPopup.previewUrl] })">
            <van-image :src="correctPopup.previewUrl" fit="contain" height="150px" />
            <div class="correct-preview-tip">
              点击可查看大图
            </div>
          </div>
          <van-cell-group inset>
            <van-field
              v-for="f in correctFields"
              :key="f.key"
              v-model="correctForm[f.key]"
              :label="f.label"
              :placeholder="f.placeholder"
            />
            <van-field
              :model-value="correctMonth || '不限月份'"
              label="结算月份"
              readonly
              is-link
              @click="showCorrectMonthPicker = true"
            />
          </van-cell-group>
          <div class="correct-tip">
            结算月份用于限定匹配范围，留空则在该门店全部月份中匹配。
          </div>
        </div>
        <div class="correct-footer">
          <van-button block :loading="correctPopup.submitting" @click="submitCorrect(false)">
            仅保存
          </van-button>
          <van-button block type="primary" :loading="correctPopup.submitting" @click="submitCorrect(true)">
            保存并重新匹配
          </van-button>
        </div>
      </div>
    </van-popup>

    <!-- 人工指派弹窗 -->
    <van-popup v-model:show="matchPopup.show" position="bottom" round :style="{ height: '78%' }">
      <div class="match-popup">
        <van-nav-bar title="人工指派到工单" />
        <div class="match-body">
          <div class="match-section-title">
            候选工单<span class="match-sub">（按 OCR 工单号 / 车牌匹配）</span>
          </div>
          <div v-if="matchPopup.candidates.length" class="match-list">
            <div
              v-for="o in matchPopup.candidates"
              :key="o.id"
              class="match-item"
              @click="confirmMatch(o.id)"
            >
              <div class="match-item-main">
                <div class="match-row1">
                  <van-tag size="medium" :type="statusTagType(o.status)">{{ statusText(o.status) }}</van-tag>
                  <span class="match-no">{{ o.orderNo || '(无工单号)' }}</span>
                </div>
                <div class="match-row2">
                  <span class="match-plate">{{ o.plateNumber || '无车牌' }}</span>
                  <span v-if="o.carModel" class="match-extra">{{ o.carModel }}</span>
                  <span v-if="o.settlementMonth" class="match-extra">{{ o.settlementMonth }}</span>
                </div>
              </div>
              <van-button size="small" type="primary" class="match-btn">归类</van-button>
            </div>
          </div>
          <AppEmpty v-else description="无候选工单，可手动搜索" />

          <div class="match-section-title">手动搜索工单</div>
          <van-search
            v-model="matchPopup.searchKeyword"
            placeholder="工单号 / 车牌"
            shape="round"
            :loading="matchPopup.searching"
            @search="searchOrders"
          />
          <div v-if="searchResults.length" class="match-list">
            <div
              v-for="o in searchResults"
              :key="o.id"
              class="match-item"
              @click="confirmMatch(o.id)"
            >
              <div class="match-item-main">
                <div class="match-row1">
                  <van-tag size="medium" :type="statusTagType(o.status)">{{ statusText(o.status) }}</van-tag>
                  <span class="match-no">{{ o.orderNo || '(无工单号)' }}</span>
                </div>
                <div class="match-row2">
                  <span class="match-plate">{{ o.plateNumber || '无车牌' }}</span>
                  <span v-if="o.carModel" class="match-extra">{{ o.carModel }}</span>
                  <span v-if="o.settlementMonth" class="match-extra">{{ o.settlementMonth }}</span>
                </div>
              </div>
              <van-button size="small" type="primary" class="match-btn">归类</van-button>
            </div>
          </div>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style lang="less">
.pending-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
}
.filter-header {
  flex-shrink: 0;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);

  :deep(.van-search) {
    padding: 8px 12px 2px;
  }
}
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 12px 10px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 45%;
  padding: 5px 10px;
  background: var(--neutral-100);
  border-radius: 16px;
  font-size: 12px;
  color: var(--text-regular);
}
.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tabs-bar {
  flex-shrink: 0;
  background: var(--color-surface);
}
.tab-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tab-count {
  display: inline-block;
  min-width: 16px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-tertiary);
  background: var(--color-border);
  border-radius: 8px;
  text-align: center;

  &.active {
    color: #fff;
    background: var(--color-primary);
  }
}
.card-item {
  margin: 8px 0;

  :deep(.van-card) {
    background: var(--color-surface);
    border-radius: 10px;
  }
  :deep(.van-card__thumb) {
    border-radius: 8px;
    overflow: hidden;
  }
}
.card-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.card-title :deep(.van-tag) {
  flex-shrink: 0;
}
.month-tag {
  font-size: 12px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.card-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  .remark {
    color: var(--color-warning);
    font-size: 12px;
    margin-top: 2px;
  }
  .matched {
    color: var(--color-success);
    font-size: 12px;
    margin-top: 2px;
  }
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.recognizing-hint {
  color: var(--color-primary);
  font-size: 12px;
}
.list-wrapper {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  min-height: 0;
}
.match-popup {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.match-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 12px;
}
.match-section-title {
  padding: 12px 12px 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.match-sub {
  font-weight: 400;
  color: var(--text-tertiary);
}
.match-list {
  padding: 0 12px;
}
.match-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  min-width: 0;
}
.match-item-main {
  flex: 1;
  min-width: 0;
}
.match-row1 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.match-row2 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  min-width: 0;
}
.match-no {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.match-plate {
  color: var(--color-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-extra {
  color: var(--text-tertiary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-btn {
  flex-shrink: 0;
}
.correct-popup {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.correct-body {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}
.correct-preview {
  text-align: center;
  padding: 8px 0 2px;
  background: var(--color-surface);
}
.correct-preview-tip {
  font-size: 12px;
  color: var(--text-tertiary);
  padding-bottom: 6px;
}
.correct-tip {
  padding: 8px 16px 0;
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.correct-footer {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
}
</style>

<route lang="json5">
{
  name: 'PendingImage',
  meta: {
    hideNavBar: true
  }
}
</route>
