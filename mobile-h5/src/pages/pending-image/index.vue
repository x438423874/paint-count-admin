<script setup lang="ts">
import {
  getPendingImagePage,
  getPendingImageStatusCounts,
  getPendingImageCandidates,
  uploadPendingImage,
  autoMatchPendingImage,
  manualMatchPendingImage,
  createOrderFromPending,
  retryOcrPendingImage,
  deletePendingImage,
  getShopList,
  getWorkOrderPage,
} from '@/api/paint'
import type { PaintPendingImage, PendingImageStatus, PendingImageStatusCounts } from '@/api/types/paint'
import { showNotify, showConfirmDialog, showImagePreview } from 'vant'
import { compressImage } from '@/utils/image-compress'
import { resolveImageUrl } from '@/utils/image-url'
import { canEdit as canEditRole } from '@/utils/permission'
import { onMounted, onActivated, onDeactivated, onUnmounted, computed } from 'vue'

const router = useRouter()
const allowEdit = canEditRole()

const shops = ref<{ id: string; name: string }[]>([])
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

const statusOptions: { label: string; value: PendingImageStatus | '' }[] = [
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
  PENDING: counts.PENDING,
  NEEDS_REVIEW: counts.NEEDS_REVIEW,
  MATCHED: counts.MATCHED + counts.MANUAL,
  FAILED: counts.FAILED,
}))

const statusLabel: Record<string, string> = {
  PENDING: '待匹配', MATCHED: '已归类', NEEDS_REVIEW: '待确认', MANUAL: '人工', FAILED: '失败',
}
const statusColor: Record<string, string> = {
  PENDING: 'var(--color-warning)', MATCHED: 'var(--color-success)', NEEDS_REVIEW: 'var(--color-primary)', MANUAL: 'var(--color-success)', FAILED: 'var(--color-error)',
}
// 图片来源：POOL=图片池直接上传（用于匹配已有工单）；CREATE=新建工单时带图上传
const sourceLabel: Record<string, string> = {
  POOL: '匹配', CREATE: '新建',
}
const sourceColor: Record<string, string> = {
  POOL: 'var(--color-primary)', CREATE: 'var(--color-success)',
}

/** OCR 生命周期：PENDING/PROCESSING 表示识别中，用户可离开页面 */
function ocrState(item: PaintPendingImage): 'processing' | 'done' | 'failed' {
  const s = item.ocrStatus
  if (s === 'PENDING' || s === 'PROCESSING') return 'processing'
  if (s === 'FAILED') return 'failed'
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
    const records = res?.records || []
    const map = new Map(records.map((r: PaintPendingImage) => [r.id, r]))
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
  } catch {
    // 轮询失败忽略，下一轮继续
  }
  await loadCounts()
  if (!hasRecognizing.value) stopPolling()
}

function startPollingIfNeeded() {
  if (hasRecognizing.value && !pollTimer) {
    pollTimer = setInterval(pollStatuses, 3000)
  } else if (!hasRecognizing.value && pollTimer) {
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

const shopColumns = computed(() => {
  const cols = shops.value.map(s => ({ text: s.name, value: s.id }))
  return [{ text: '全部门店', value: '' }, ...cols]
})
const monthColumns = computed(() => {
  const list = [{ text: '全部月份', value: '' }]
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    list.push({ text: v, value: v })
  }
  return list
})

function getShopName(id: string) {
  if (!id) return '全部门店'
  return shops.value.find(s => s.id === id)?.name || id
}

async function loadShops() {
  try {
    const res = await getShopList()
    shops.value = (res as any) || []
    if (shops.value.length === 1 && !selectedShopId.value) {
      selectedShopId.value = shops.value[0].id
    }
  } catch {
    shops.value = []
  }
}

async function loadCounts() {
  try {
    const res = await getPendingImageStatusCounts(selectedShopId.value || undefined, selectedMonth.value || undefined)
    Object.assign(counts, res)
  } catch {
    // ignore
  }
}

// 递增令牌：重置加载时让过期响应失效，避免并发/竞态导致列表不刷新或错乱
let loadToken = 0

async function loadData(reset = false) {
  // 滚动加载（非重置）时才受 loading/finished 限制；重置（刷新/切换筛选）必须执行
  if (!reset && (loading.value || finished.value)) return
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
    if (token !== loadToken) return // 已有更新的请求，丢弃本次过期结果
    const records = res?.records || []
    list.value.push(...records)
    if (list.value.length >= (res?.total || 0) || records.length === 0) {
      finished.value = true
    }
    current.value++
  } catch {
    if (token === loadToken) finished.value = true
  } finally {
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
  uploading.value = true
  uploadTotal.value = files.length
  uploadDone.value = 0
  for (const f of files) {
    try {
      const raw = f.file as File
      const compressed = await compressImage(raw)
      await uploadPendingImage(compressed, selectedShopId.value, selectedMonth.value || undefined, 'POOL')
      uploadDone.value++
    } catch (e: any) {
      showNotify({ type: 'danger', message: `上传失败: ${e?.message || e}` })
    }
  }
  uploading.value = false
  if (uploadDone.value === uploadTotal.value) {
    showNotify({ type: 'success', message: `上传完成 ${uploadDone.value}/${uploadTotal.value}，正在后台识别…` })
  } else {
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
    } else if (res?.status === 'NEEDS_REVIEW') {
      showNotify({ type: 'warning', message: '命中多个候选，请人工确认' })
    } else {
      showNotify({ type: 'primary', message: res?.remark || '暂无匹配' })
    }
    onRefresh()
  } catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
}

async function onRetryOcr(item: PaintPendingImage) {
  try {
    await retryOcrPendingImage(item.id)
    showNotify({ type: 'success', message: '已提交重试，正在后台识别…' })
    onRefresh()
  } catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
}

function onCreateOrder(item: PaintPendingImage) {
  showConfirmDialog({
    title: '补建工单',
    message: '将用 OCR 基础资料创建一条无幅数工单并归类该图片，是否继续？',
  }).then(async () => {
    try {
      await createOrderFromPending(item.id, selectedMonth.value || undefined)
      showNotify({ type: 'success', message: '已补建工单并归类' })
      onRefresh()
    } catch (e: any) {
      showNotify({ type: 'danger', message: e?.message || '操作失败' })
    }
  }).catch(() => void 0)
}

function onDelete(item: PaintPendingImage) {
  showConfirmDialog({
    title: '删除图片',
    message: '确定删除该图片？',
  }).then(async () => {
    try {
      await deletePendingImage(item.id)
      showNotify({ type: 'success', message: '已删除' })
      onRefresh()
    } catch (e: any) {
      showNotify({ type: 'danger', message: e?.message || '操作失败' })
    }
  }).catch(() => void 0)
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
  } catch {
    matchPopup.candidates = []
  }
}

async function searchOrders() {
  const kw = matchPopup.searchKeyword.trim()
  if (!kw) return
  matchPopup.searching = true
  try {
    const res: any = await getWorkOrderPage({
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      plateNumber: kw,
      current: 1,
      size: 20,
    } as any)
    searchResults.value = res?.records || []
  } catch {
    searchResults.value = []
  } finally {
    matchPopup.searching = false
  }
}

async function confirmMatch(orderId: string) {
  try {
    await manualMatchPendingImage(matchPopup.pendingId, orderId)
    showNotify({ type: 'success', message: '已归类' })
    matchPopup.show = false
    onRefresh()
  } catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
}

onMounted(async () => {
  await loadShops()
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
          v-if="allowEdit"
          :after-read="onAfterRead"
          multiple
          accept="image/jpeg,image/png,image/webp"
          :preview-image="false"
        >
          <van-button size="small" type="primary" icon="photo-o" :loading="uploading">
            {{ uploading ? `上传 ${uploadDone}/${uploadTotal}` : '上传图片' }}
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
          <van-empty v-if="!loading && list.length === 0" description="暂无图片" />

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
                  <van-tag v-else :color="statusColor[item.status]" plain size="medium">{{ statusLabel[item.status] }}</van-tag>
                  <van-tag v-if="item.source" :color="sourceColor[item.source]" plain size="medium">{{ sourceLabel[item.source] }}</van-tag>
                  <span class="month-tag">{{ item.settlementMonth || '未指定月份' }}</span>
                </div>
              </template>
              <template #desc>
                <div class="card-desc">
                  <div>工单号: {{ item.ocrOrderNo || '-' }}</div>
                  <div>车牌: {{ item.ocrPlateNumber || '-' }}</div>
                  <div v-if="item.ocrCarModel">车型: {{ item.ocrCarModel }}</div>
                  <div v-if="item.matchRemark" class="remark">{{ item.matchRemark }}</div>
                  <div v-if="item.matchedOrderId && item.order" class="matched">
                    已归类: {{ item.order.orderNo || item.order.plateNumber || item.order.id }}
                  </div>
                </div>
              </template>
              <template #footer>
                <div v-if="allowEdit" class="card-actions">
                  <span v-if="ocrState(item) === 'processing'" class="recognizing-hint">识别中，请稍候…</span>
                  <template v-else>
                    <van-button size="mini" @click="onAutoMatch(item)">匹配</van-button>
                    <van-button
                      v-if="item.status === 'NEEDS_REVIEW' || item.status === 'PENDING'"
                      size="mini" type="primary" @click="openMatchPopup(item)"
                    >指派</van-button>
                    <van-button
                      v-if="item.status !== 'MATCHED' && item.status !== 'MANUAL'"
                      size="mini" type="warning" @click="onCreateOrder(item)"
                    >补建</van-button>
                    <van-button v-if="item.status === 'FAILED'" size="mini" @click="onRetryOcr(item)">重试</van-button>
                  </template>
                  <van-button size="mini" type="danger" plain @click="onDelete(item)">删除</van-button>
                </div>
              </template>
            </van-card>
          </div>
        </van-list>
      </van-pull-refresh>
    </div>

    <!-- 门店选择 -->
    <van-popup v-model:show="showShopPicker" position="bottom">
      <van-picker :columns="shopColumns" @confirm="(v: any) => { selectedShopId = v.selectedValues[0]; showShopPicker = false; onSearch() }" @cancel="showShopPicker = false" />
    </van-popup>
    <!-- 月份选择 -->
    <van-popup v-model:show="showMonthPicker" position="bottom">
      <van-picker :columns="monthColumns" @confirm="(v: any) => { selectedMonth = v.selectedValues[0]; showMonthPicker = false; onSearch() }" @cancel="showMonthPicker = false" />
    </van-popup>

    <!-- 人工指派弹窗 -->
    <van-popup v-model:show="matchPopup.show" position="bottom" round :style="{ height: '70%' }">
      <div class="match-popup">
        <van-nav-bar title="人工指派到工单" />
        <div class="match-section-title">候选工单（按 OCR 工单号/车牌匹配）</div>
        <div v-if="matchPopup.candidates.length" class="match-list">
          <van-cell v-for="o in matchPopup.candidates" :key="o.id" @click="confirmMatch(o.id)">
            <template #title>
              <div class="match-cell">
                <van-tag size="medium" :type="o.status === 'SETTLED' ? 'primary' : o.status === 'AUDITED' ? 'success' : 'warning'">{{ o.status }}</van-tag>
                <span class="match-no">{{ o.orderNo || '(无工单号)' }}</span>
                <span class="match-plate">{{ o.plateNumber || '-' }}</span>
                <span class="match-extra">{{ o.carModel || '' }} {{ o.settlementMonth || '' }}</span>
              </div>
            </template>
            <template #value>
              <van-button size="mini" type="primary">归类</van-button>
            </template>
          </van-cell>
        </div>
        <van-empty v-else description="无候选工单" />

        <div class="match-section-title">手动搜索工单</div>
        <van-search v-model="matchPopup.searchKeyword" placeholder="工单号 / 车牌" @search="searchOrders" />
        <div v-if="searchResults.length" class="match-list">
          <van-cell v-for="o in searchResults" :key="o.id" @click="confirmMatch(o.id)">
            <template #title>
              <div class="match-cell">
                <span class="match-no">{{ o.orderNo || '(无工单号)' }}</span>
                <span class="match-plate">{{ o.plateNumber || '-' }}</span>
                <span class="match-extra">{{ o.carModel || '' }} {{ o.settlementMonth || '' }}</span>
              </div>
            </template>
            <template #value>
              <van-button size="mini" type="primary">归类</van-button>
            </template>
          </van-cell>
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
  gap: 8px;
}
.month-tag {
  font-size: 12px;
  color: var(--text-tertiary);
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
.match-section-title {
  padding: 10px 12px 4px;
  font-size: 13px;
  color: var(--text-tertiary);
}
.match-list {
  flex: 1;
  overflow-y: auto;
}
.match-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  .match-no { font-weight: 600; }
  .match-plate { color: var(--color-primary); }
  .match-extra { color: var(--text-tertiary); font-size: 12px; }
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
