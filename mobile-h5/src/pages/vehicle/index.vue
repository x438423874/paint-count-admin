<script setup lang="ts">
import {
  fetchPaintVehiclePage,
  deletePaintVehicle,
} from '@/api/paint'
import type { PaintVehicle, PageResult } from '@/api/types/paint'
import { canEdit } from '@/utils/permission'
import { showDialog, showNotify } from 'vant'

const route = useRoute()
const router = useRouter()

const allowEdit = canEdit()

// 搜索表单
const searchForm = reactive({
  plateNumber: '',
  customerName: '',
  phone: '',
  vin: '',
})

const vehicles = ref<PaintVehicle[]>([])
const loading = ref(false)
const finished = ref(false)
const current = ref(1)
// 每页大小：平衡首屏速度和加载次数（718条数据按10条需72次请求，20条只需36次）
const size = 20
const total = ref(0)
const refreshing = ref(false)
const showFilterPopup = ref(false)

// 滑动状态标记（避免滑动时触发点击跳转）
const swiping = ref(false)

// 加载车辆列表
async function loadVehicles(reset = false) {
  if (loading.value) return
  if (!reset && finished.value) return

  if (reset) {
    current.value = 1
    vehicles.value = []
    finished.value = false
  }

  loading.value = true
  try {
    const params: any = {
      current: current.value,
      size,
    }
    if (searchForm.plateNumber) params.plateNumber = searchForm.plateNumber.trim().toUpperCase()
    if (searchForm.customerName) params.customerName = searchForm.customerName
    if (searchForm.phone) params.phone = searchForm.phone
    if (searchForm.vin) params.vin = searchForm.vin.trim().toUpperCase()

    const res = await fetchPaintVehiclePage(params)
    const data = res as any as PageResult<PaintVehicle>
    const list = data.records || []

    if (reset) {
      vehicles.value = list
      total.value = data.total || 0
    }
    else {
      vehicles.value = [...vehicles.value, ...list]
    }

    if (list.length < size) {
      finished.value = true
    }
    else {
      current.value++
    }
  }
  catch {
    showNotify({ type: 'danger', message: '加载车辆列表失败' })
  }
  finally {
    loading.value = false
  }
}

// 下拉刷新
async function onRefresh() {
  refreshing.value = true
  await loadVehicles(true)
  refreshing.value = false
}

// 搜索
function onSearch() {
  loadVehicles(true)
}

// 重置筛选
function resetFilter() {
  searchForm.customerName = ''
  searchForm.phone = ''
  searchForm.vin = ''
  showFilterPopup.value = false
  loadVehicles(true)
}

// 确认筛选
function confirmFilter() {
  showFilterPopup.value = false
  loadVehicles(true)
}

// 跳转编辑页
function goToEdit(id: string) {
  if (swiping.value) return
  saveListState()
  sessionStorage.setItem('vehicle-edit-from-list', '1')
  router.push({ name: 'VehicleEdit', query: { mode: 'edit', id } })
}

// 跳转新增页
function goToAdd() {
  router.push({ name: 'VehicleEdit', query: { mode: 'add' } })
}

// 跳转历史工单
function goHistory(v: PaintVehicle) {
  router.push({
    name: '/work-order/vehicle-history',
    query: { id: v.id, plate: v.plateNumber },
  })
}

// 删除车辆
async function handleDelete(id: string) {
  try {
    await showDialog({
      title: '确认删除',
      message: '删除车辆不会删除关联工单，仅解除关联。确认删除？',
    })
    await deletePaintVehicle(id)
    showNotify({ type: 'success', message: '删除成功' })
    // 从列表中移除
    vehicles.value = vehicles.value.filter(v => v.id !== id)
    total.value = Math.max(0, total.value - 1)
  }
  catch {
    // 用户取消或删除失败
  }
}

// 格式化日期
function formatDate(dateStr?: string | null) {
  if (!dateStr) return '-'
  return dateStr.slice(0, 10)
}

// ===== 列表状态缓存 =====
const LIST_STATE_KEY = 'vehicle-list-state'
const STATE_MAX_AGE = 5 * 60 * 1000
// 标记是否已初始化（区分 onMounted 首次加载和 onActivated 重新激活）
let hasInitialized = false

function saveListState() {
  sessionStorage.setItem(
    LIST_STATE_KEY,
    JSON.stringify({
      searchForm: { ...searchForm },
      current: current.value,
      vehicles: vehicles.value,
      finished: finished.value,
      total: total.value,
      scrollTop: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0,
      timestamp: Date.now(),
    }),
  )
}

function restoreListState(): boolean {
  const raw = sessionStorage.getItem(LIST_STATE_KEY)
  if (!raw) return false
  try {
    const state = JSON.parse(raw)
    if (!state.timestamp || Date.now() - state.timestamp > STATE_MAX_AGE) {
      clearListState()
      return false
    }
    Object.assign(searchForm, state.searchForm || {})
    if (state.current !== undefined) current.value = state.current
    if (state.vehicles) vehicles.value = state.vehicles
    if (state.finished !== undefined) finished.value = state.finished
    if (state.total !== undefined) total.value = state.total
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

/**
 * onMounted 首次加载
 */
function initOnMounted() {
  // 检查是否需要强制刷新（从编辑页返回且数据有变更）
  const needRefresh = sessionStorage.getItem('vehicle-list-need-refresh') === '1'
  if (needRefresh) {
    sessionStorage.removeItem('vehicle-list-need-refresh')
    clearListState()
    loadVehicles(true)
    return
  }

  const fromEdit = sessionStorage.getItem('vehicle-edit-from-list') === '1'
  if (fromEdit) {
    sessionStorage.removeItem('vehicle-edit-from-list')
    const restored = restoreListState()
    if (restored) return
  }
  clearListState()
  loadVehicles(true)
}

/**
 * onActivated 重新激活（keepAlive 组件从编辑页返回）
 */
function reactivateOnActivated(fromEditExit: boolean) {
  // 检查是否需要强制刷新（编辑页保存/删除后）
  const needRefresh = sessionStorage.getItem('vehicle-list-need-refresh') === '1'
  if (needRefresh) {
    sessionStorage.removeItem('vehicle-list-need-refresh')
    clearListState()
    loadVehicles(true)
    return
  }

  if (fromEditExit) {
    sessionStorage.removeItem('vehicle-edit-from-list')
    // 恢复滚动位置（keepAlive 内存缓存保留了列表）
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
  // 重新设置 IntersectionObserver
  nextTick(() => setupScrollObserver())
}

// ===== 无限滚动 =====
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
        loadVehicles()
      }
    },
    { root: null, rootMargin: '200px', threshold: 0 },
  )
  scrollObserver.observe(sentinelRef.value)
}

// URL query 预填搜索条件
onMounted(() => {
  const queryPlate = route.query.plateNumber as string
  if (queryPlate) {
    searchForm.plateNumber = queryPlate
  }
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
  // 已初始化的重新激活：从编辑页返回时恢复滚动+重设 observer
  const fromEdit = sessionStorage.getItem('vehicle-edit-from-list') === '1'
  reactivateOnActivated(fromEdit)
})
</script>

<template>
  <div class="vehicle-page">
    <!-- 顶部搜索 -->
    <div class="search-header">
      <van-search
        v-model="searchForm.plateNumber"
        placeholder="搜索车牌号"
        shape="round"
        clearable
        @search="onSearch"
        @clear="onSearch"
      />
      <div class="filter-trigger" @click="showFilterPopup = true">
        <van-icon name="filter-o" size="20" color="#1677ff" />
        <span class="filter-text">筛选</span>
      </div>
    </div>

    <!-- 汇总 -->
    <div v-if="vehicles.length > 0" class="summary-bar">
      <span class="summary-text">共 {{ total }} 辆车</span>
    </div>

    <!-- 列表 -->
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="vehicle-list">
        <van-empty v-if="vehicles.length === 0 && !loading" description="暂无车辆数据" />

        <van-swipe-cell
          v-for="v in vehicles"
          :key="v.id"
          @open="swiping = true"
          @close="swiping = false"
        >
          <div class="vehicle-card" @click="goToEdit(v.id)">
            <div class="card-top">
              <div class="plate-wrap">
                <van-icon name="car-o" size="16" color="#1677ff" />
                <span class="plate-number">{{ v.plateNumber }}</span>
              </div>
              <div class="card-tags">
                <van-tag type="primary" size="medium">
                  {{ v.totalOrderCount }} 单
                </van-tag>
              </div>
            </div>

            <div class="card-info">
              <div class="info-item">
                <span class="info-label">车型/品牌</span>
                <span class="info-value">{{ v.carModel || '-' }} {{ v.brand ? `· ${v.brand}` : '' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">客户</span>
                <span class="info-value">{{ v.customerName || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">电话</span>
                <span class="info-value">{{ v.phone || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">累计幅数</span>
                <span class="info-value paint-count">{{ Number(v.totalPaintCount).toFixed(1) }}</span>
              </div>
            </div>

            <div class="card-bottom">
              <div class="visit-info">
                <span v-if="v.lastOrderAt">最近：{{ formatDate(v.lastOrderAt) }}</span>
                <span v-else>暂无工单</span>
                <span v-if="v.lastShopName" class="shop-name"> · {{ v.lastShopName }}</span>
              </div>
              <van-button
                size="mini"
                type="primary"
                plain
                @click.stop="goHistory(v)"
              >
                历史
              </van-button>
            </div>
          </div>

          <template #right>
            <van-button
              v-if="allowEdit"
              square
              type="danger"
              text="删除"
              class="delete-btn"
              @click="handleDelete(v.id)"
            />
          </template>
        </van-swipe-cell>

        <div v-if="loading" class="loading-wrap">
          <van-loading size="24px">加载中...</van-loading>
        </div>

        <div v-if="finished && vehicles.length > 0" class="finished-text">
          没有更多了
        </div>

        <div ref="sentinelRef" class="scroll-sentinel" />
      </div>
    </van-pull-refresh>

    <!-- 悬浮新增按钮 -->
    <div v-if="allowEdit" class="fab-create" @click="goToAdd">
      <van-icon name="plus" size="24" color="#fff" />
    </div>

    <!-- 筛选弹窗 -->
    <van-popup v-model:show="showFilterPopup" position="right" :style="{ width: '80%', height: '100%' }">
      <div class="filter-popup">
        <div class="filter-popup-header">
          <span class="filter-popup-title">筛选条件</span>
          <van-icon name="cross" size="20" color="#999" @click="showFilterPopup = false" />
        </div>
        <div class="filter-popup-body">
          <van-cell-group inset>
            <van-field v-model="searchForm.customerName" label="客户名称" placeholder="搜索客户名称" clearable />
            <van-field v-model="searchForm.phone" label="电话" placeholder="搜索电话" clearable type="tel" />
            <van-field v-model="searchForm.vin" label="车架号" placeholder="搜索VIN" clearable />
          </van-cell-group>
        </div>
        <div class="filter-popup-footer">
          <van-button block round @click="resetFilter">
            重置
          </van-button>
          <van-button type="primary" block round @click="confirmFilter">
            确定
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<route lang="json5">
{
  name: 'Vehicle',
  meta: {
    keepAlive: true
  }
}
</route>

<style lang="less" scoped>
.vehicle-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 120px;
}

.search-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fff;

  :deep(.van-search) {
    flex: 1;
    padding: 0;
    background: transparent;
  }
}

.filter-trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  gap: 2px;
}

.filter-text {
  font-size: 11px;
  color: #1677ff;
}

.summary-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: #f5f7fa;
  font-size: 13px;
  color: #666;
}

.vehicle-list {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vehicle-card {
  background: #fff;
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.plate-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.plate-number {
  font-size: 16px;
  font-weight: 700;
  color: #333;
}

.card-tags {
  display: flex;
  align-items: center;
  gap: 6px;
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
  color: #999;
}

.info-value {
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paint-count {
  color: #1677ff;
  font-weight: 600;
}

.card-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid #f5f5f5;
}

.visit-info {
  font-size: 12px;
  color: #999;

  .shop-name {
    color: #666;
  }
}

.delete-btn {
  height: 100%;
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
  color: #999;
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
  background: linear-gradient(135deg, #1677ff, #4096ff);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(22, 119, 255, 0.35);
  z-index: 100;
}

.filter-popup {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f5f7fa;
}

.filter-popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #fff;
}

.filter-popup-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.filter-popup-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}

.filter-popup-footer {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border-top: 1px solid #f0f0f0;
}
</style>
