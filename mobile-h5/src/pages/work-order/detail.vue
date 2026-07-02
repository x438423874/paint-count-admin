<script setup lang="ts">
import {
  getWorkOrderDetail, auditWorkOrder, unauditWorkOrder, deleteWorkOrder,
  uploadWorkOrderImage, deleteWorkOrderImage, getShopList, updateWorkOrder, getShopCategoriesWithStandard,
  addSettlementRecord, removeSettlementRecord, getSettlementHistory, setAbnormal, ocrRecognizeImage,
  getSpecialPaintList,
} from '@/api/paint'
import type { PaintWorkOrder, PaintShop, PaintStandard, PaintSpecialPaint, CreateWorkOrderItemDto, SettlementRecord } from '@/api/types/paint'
import { compressImage } from '@/utils/image-compress'
import { canAudit, canDelete, canEdit } from '@/utils/permission'

// 权限标志
const allowAudit = canAudit()
const allowDelete = canDelete()
const allowEdit = canEdit()

const route = useRoute()
const router = useRouter()
const orderId = ref('')
const order = ref<PaintWorkOrder | null>(null)
const loading = ref(false)
const shops = ref<PaintShop[]>([])
const isEditing = ref(false)
const saving = ref(false)

// OCR 识别状态
const ocrLoading = ref(false)
const showOcrConflict = ref(false)
const ocrConflicts = ref<Array<{ key: string; label: string; oldValue: string; newValue: string; checked: boolean }>>([])
const showImagePicker = ref(false)

// 编辑表单
const editForm = reactive({
  orderNo: '',
  plateNumber: '',
  carModel: '',
  customerName: '',
  phone: '',
  remark: '',
  items: [] as CreateWorkOrderItemDto[],
})

// 编辑用的标准
const editStandards = ref<PaintStandard[]>([])
const specialPaints = ref<PaintSpecialPaint[]>([])
const showCategoryPicker = ref(false)
const editingItemIndex = ref(-1)
const categoryColumns = computed(() => {
  return editStandards.value.map(s => ({
    text: s.category?.name || s.alias || s.categoryId,
    value: s.categoryId,
  }))
})

// 编辑模式下的图片状态
const editPendingUploads = ref<{ file: File; previewUrl: string }[]>([])
const editPendingDeleteIds = ref<string[]>([])
const editImages = computed(() => {
  if (!order.value?.images) return []
  return order.value.images.filter(img => !editPendingDeleteIds.value.includes(img.id))
})

function getShopName(shopId: string) {
  if (!shopId) return '-'
  const shop = shops.value.find(s => s.id === shopId)
  return shop?.name || shopId
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

async function loadDetail() {
  if (!orderId.value) return
  loading.value = true
  try {
    const res = await getWorkOrderDetail(orderId.value)
    order.value = res as any as PaintWorkOrder
  }
  catch {
    order.value = null
  }
  finally {
    loading.value = false
  }
}

function enterEdit() {
  if (!order.value || order.value.isAudited) return
  editForm.orderNo = order.value.orderNo || ''
  editForm.plateNumber = order.value.plateNumber || ''
  editForm.carModel = order.value.carModel || ''
  editForm.customerName = order.value.customerName || ''
  editForm.phone = order.value.phone || ''
  editForm.remark = order.value.remark || ''
  editForm.items = (order.value.items || []).map(item => ({
    categoryId: item.categoryId,
    quantity: item.quantity,
    newPartQuantity: item.newPartQuantity,
    specialPaintId: item.specialPaintId || undefined,
  }))
  editPendingUploads.value = []
  editPendingDeleteIds.value = []
  loadEditStandards()
  loadSpecialPaints()
  isEditing.value = true
}

async function loadSpecialPaints() {
  try {
    const res = await getSpecialPaintList(true)
    specialPaints.value = (res as any as PaintSpecialPaint[]) || []
  }
  catch {
    specialPaints.value = []
  }
}

async function loadEditStandards() {
  if (!order.value?.shopId) return
  try {
    const res = await getShopCategoriesWithStandard(order.value.shopId)
    editStandards.value = (res as any as PaintStandard[]).filter(s => Number(s.coefficient) > 0)
  }
  catch {
    editStandards.value = []
  }
}

function cancelEdit() {
  isEditing.value = false
  // 释放待上传图片的 Object URL
  editPendingUploads.value.forEach(item => URL.revokeObjectURL(item.previewUrl))
  editPendingUploads.value = []
  editPendingDeleteIds.value = []
}

// OCR 识别（识别工单已有图片，仅识别填入编辑表单，不保存）
function handleOcrRecognize() {
  const images = editImages.value
  if (!images || images.length === 0) {
    showNotify({ type: 'warning', message: '工单无图片，无法识别' })
    return
  }
  if (images.length === 1) {
    doOcrRecognizeByUrl(images[0].url)
  }
  else {
    showImagePicker.value = true
  }
}

// 选择图片后识别
function onPickImage(url: string) {
  showImagePicker.value = false
  doOcrRecognizeByUrl(url)
}

// 根据图片 URL 进行 OCR 识别
async function doOcrRecognizeByUrl(imageUrl: string) {
  const shopId = order.value?.shopId
  if (!shopId) {
    showNotify({ type: 'warning', message: '门店信息缺失，无法识别' })
    return
  }
  ocrLoading.value = true
  try {
    // 获取工单图片并转为 File
    const resp = await fetch(imageUrl)
    if (!resp.ok) throw new Error('获取图片失败')
    const blob = await resp.blob()
    const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' })
    const compressed = await compressImage(file)
    const result = await ocrRecognizeImage(compressed, shopId)

    const fieldMap = [
      { key: 'plateNumber', label: '车牌号', ocrKey: 'plateNumber' },
      { key: 'orderNo', label: '工单号', ocrKey: 'orderNo' },
      { key: 'customerName', label: '客户名称', ocrKey: 'customerName' },
      { key: 'phone', label: '联系电话', ocrKey: 'phone' },
      { key: 'carModel', label: '车型', ocrKey: 'carModel' },
    ]

    const filledMessages: string[] = []
    const conflicts: Array<{ key: string; label: string; oldValue: string; newValue: string; checked: boolean }> = []

    for (const { key, label, ocrKey } of fieldMap) {
      const ocrValue = ((result as any)[ocrKey] || '').trim()
      if (!ocrValue) continue

      const currentValue = ((editForm as any)[key] || '').trim()
      if (!currentValue) {
        ;(editForm as any)[key] = ocrValue
        filledMessages.push(`${label}：${ocrValue}`)
      }
      else if (currentValue !== ocrValue) {
        conflicts.push({ key, label, oldValue: currentValue, newValue: ocrValue, checked: false })
      }
    }

    if (filledMessages.length > 0) {
      showNotify({ type: 'success', message: `已填充 ${filledMessages.join('、')}` })
    }

    if (conflicts.length > 0) {
      ocrConflicts.value = conflicts
      showOcrConflict.value = true
    }
    else if (filledMessages.length === 0) {
      showNotify({ type: 'warning', message: '未识别到有效信息' })
    }
  }
  catch {
    showNotify({ type: 'danger', message: 'OCR识别失败' })
  }
  finally {
    ocrLoading.value = false
  }
}

// 确认覆盖冲突字段
function confirmOcrConflict() {
  const selected = ocrConflicts.value.filter(f => f.checked)
  for (const field of selected) {
    ;(editForm as any)[field.key] = field.newValue
  }
  if (selected.length > 0) {
    showNotify({ type: 'success', message: `已覆盖 ${selected.map(f => f.label).join('、')}` })
  }
  showOcrConflict.value = false
  ocrConflicts.value = []
}

async function saveEdit() {
  if (!order.value) return
  const validItems = editForm.items.filter(item => item.quantity && item.quantity > 0)
  if (validItems.length === 0) {
    showNotify({ type: 'warning', message: '请至少添加一个喷漆项目' })
    return
  }
  saving.value = true
  try {
    // 1. 保存基本信息
    await updateWorkOrder({
      id: order.value.id,
      orderNo: editForm.orderNo || undefined,
      plateNumber: editForm.plateNumber || undefined,
      carModel: editForm.carModel || undefined,
      customerName: editForm.customerName || undefined,
      phone: editForm.phone || undefined,
      remark: editForm.remark || undefined,
      items: validItems,
    })

    // 2. 批量删除图片
    for (const imageId of editPendingDeleteIds.value) {
      try {
        await deleteWorkOrderImage(imageId)
      }
      catch {
        // 单个图片删除失败不阻断整体流程
      }
    }

    // 3. 批量上传新图片（压缩后上传）
    for (const item of editPendingUploads.value) {
      try {
        const compressed = await compressImage(item.file)
        await uploadWorkOrderImage(orderId.value, compressed, 'BEFORE')
      }
      catch {
        // 单个图片上传失败不阻断整体流程
      }
    }

    showNotify({ type: 'success', message: '保存成功' })
    isEditing.value = false
    // 释放待上传图片的 Object URL
    editPendingUploads.value.forEach(item => URL.revokeObjectURL(item.previewUrl))
    editPendingUploads.value = []
    editPendingDeleteIds.value = []
    loadDetail()
  }
  catch {
    showNotify({ type: 'danger', message: '保存失败' })
  }
  finally {
    saving.value = false
  }
}

function removeEditItem(index: number) {
  editForm.items.splice(index, 1)
}

function addEditItem() {
  if (editStandards.value.length === 0) {
    showNotify({ type: 'warning', message: '部位标准加载中，请稍后重试' })
    return
  }
  editForm.items.push({
    categoryId: editStandards.value[0]?.categoryId || '',
    quantity: 1,
    newPartQuantity: 0,
  })
  // 自动打开分类选择器
  editingItemIndex.value = editForm.items.length - 1
  showCategoryPicker.value = true
}

function openCategoryPicker(index: number) {
  editingItemIndex.value = index
  showCategoryPicker.value = true
}

function onCategoryConfirm({ selectedValues }: any) {
  if (editingItemIndex.value >= 0 && selectedValues[0]) {
    editForm.items[editingItemIndex.value].categoryId = selectedValues[0]
  }
  showCategoryPicker.value = false
}

function getEditItemName(index: number) {
  const item = editForm.items[index]
  if (!item) return ''
  const std = editStandards.value.find(s => s.categoryId === item.categoryId)
  return std?.category?.name || std?.alias || item.categoryId || `项目${index + 1}`
}

async function handleAudit() {
  if (!order.value) return
  showDialog({
    title: '确认审核',
    message: '审核后工单将不可修改，确认审核？',
  }).then(async () => {
    try {
      await auditWorkOrder(order.value!.id)
      showNotify({ type: 'success', message: '审核成功' })
      loadDetail()
    }
    catch {
      showNotify({ type: 'danger', message: '审核失败' })
    }
  }).catch(() => {})
}

async function handleUnaudit() {
  if (!order.value) return
  showDialog({
    title: '取消审核',
    message: '确认取消审核？',
  }).then(async () => {
    try {
      await unauditWorkOrder(order.value!.id)
      showNotify({ type: 'success', message: '已取消审核' })
      loadDetail()
    }
    catch {
      showNotify({ type: 'danger', message: '取消审核失败' })
    }
  }).catch(() => {})
}

async function handleDelete() {
  if (!order.value) return
  showDialog({
    title: '确认删除',
    message: '删除后不可恢复，确认删除？',
  }).then(async () => {
    try {
      await deleteWorkOrder(order.value!.id)
      showNotify({ type: 'success', message: '已删除' })
      setTimeout(() => router.back(), 1000)
    }
    catch {
      showNotify({ type: 'danger', message: '删除失败' })
    }
  }).catch(() => {})
}

// ===== 结算相关 =====
const showSettlePopup = ref(false)
const settleMonth = ref('')
const settleRemark = ref('')
const settlementRecords = ref<SettlementRecord[]>([])
const showSettlementHistory = ref(false)

// ===== 异常标注相关 =====
const showAbnormalPopup = ref(false)
const abnormalFlag = ref(true)
const abnormalRemarkInput = ref('')

function openAbnormalPopup() {
  if (!order.value) return
  abnormalFlag.value = !order.value.isAbnormal
  abnormalRemarkInput.value = order.value.abnormalRemark || ''
  showAbnormalPopup.value = true
}

async function confirmAbnormal() {
  if (!order.value) return
  try {
    await setAbnormal(order.value.id, abnormalFlag.value, abnormalRemarkInput.value || undefined)
    showNotify({ type: 'success', message: abnormalFlag.value ? '已标记异常' : '已取消异常' })
    showAbnormalPopup.value = false
    await loadDetail()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function openSettlePopup() {
  settleMonth.value = order.value?.settlementMonth || getCurrentMonth()
  settleRemark.value = ''
  showSettlePopup.value = true
}

async function confirmSettle() {
  if (!order.value || !settleMonth.value) return
  try {
    await addSettlementRecord(order.value.id, settleMonth.value, settleRemark.value || undefined)
    showNotify({ type: 'success', message: '结算成功' })
    showSettlePopup.value = false
    await loadDetail()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '结算失败' })
  }
}

async function handleUnsettle(recordId: string) {
  if (!order.value) return
  showDialog({
    title: '确认取消结算',
    message: '确认删除此结算记录？',
  }).then(async () => {
    try {
      await removeSettlementRecord(order.value!.id, recordId)
      showNotify({ type: 'success', message: '已取消结算' })
      await loadDetail()
      // 刷新结算历史
      const res = await getSettlementHistory(order.value!.id)
      settlementRecords.value = res as any as SettlementRecord[]
    }
    catch (e: any) {
      showNotify({ type: 'danger', message: e?.message || '取消结算失败' })
    }
  }).catch(() => {})
}

async function openSettlementHistoryPopup() {
  if (!order.value) return
  try {
    const res = await getSettlementHistory(order.value.id)
    settlementRecords.value = res as any as SettlementRecord[]
  }
  catch {
    settlementRecords.value = []
  }
  showSettlementHistory.value = true
}

function handleAddImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = (e: Event) => {
    const files = (e.target as HTMLInputElement).files
    if (!files) return
    for (const file of Array.from(files)) {
      const previewUrl = URL.createObjectURL(file)
      editPendingUploads.value.push({ file, previewUrl })
    }
  }
  input.click()
}

function previewImage(url: string) {
  let urls: string[]
  if (isEditing.value) {
    // 编辑模式下使用过滤后的图片列表
    urls = [
      ...editImages.value.map(img => img.url),
      ...editPendingUploads.value.map(item => item.previewUrl),
    ]
  }
  else {
    urls = (order.value?.images || []).map(img => img.url)
  }
  showImagePreview({ images: urls, startPosition: Math.max(0, urls.indexOf(url)) })
}

function deleteImage(imageId: string) {
  if (!editPendingDeleteIds.value.includes(imageId)) {
    editPendingDeleteIds.value.push(imageId)
  }
}

function removePendingUpload(index: number) {
  const item = editPendingUploads.value[index]
  if (item)
    URL.revokeObjectURL(item.previewUrl)
  editPendingUploads.value.splice(index, 1)
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  return dateStr.slice(0, 10)
}

// 编辑模式下的总幅数和部位数
const editTotalPaintCount = computed(() => {
  return editForm.items.reduce((sum, item) => {
    if (!item.quantity || item.quantity <= 0) return sum
    const std = editStandards.value.find(s => s.categoryId === item.categoryId)
    if (!std) return sum
    const coefficient = Number(std.coefficient) || 0
    const newPartAddition = Number(std.newPartAddition) || 0
    // 特殊车漆倍数
    let specialMultiplier = 1
    if (item.specialPaintId) {
      const sp = specialPaints.value.find(s => s.id === item.specialPaintId)
      if (sp) specialMultiplier = Number(sp.multiplier) || 1
    }
    const paintCount = (item.quantity * coefficient + item.newPartQuantity * newPartAddition) * specialMultiplier
    return sum + paintCount
  }, 0)
})

const editPartCount = computed(() => {
  return editForm.items.filter(item => item.quantity && item.quantity > 0).length
})

// 查看模式下的部位数
const viewPartCount = computed(() => {
  if (!order.value?.items) return 0
  return order.value.items.filter(item => item.quantity && item.quantity > 0).length
})

onMounted(() => {
  orderId.value = (route.query.id as string) || ''
  loadShops()
  loadDetail()
})
</script>

<template>
  <div class="detail-page">
    <div v-if="loading" class="loading-wrap">
      <van-loading size="24px">加载中...</van-loading>
    </div>

    <div v-else-if="order" class="detail-content">
      <!-- 顶部状态栏 -->
      <div :class="['status-banner', order.isAudited ? (order.isAbnormal ? 'abnormal' : 'audited') : 'pending']">
        <div class="status-left">
          <van-icon :name="order.isAbnormal ? 'warning-o' : (order.isAudited ? 'success' : 'clock-o')" size="20" color="#fff" />
          <span class="status-text">{{ order.isAbnormal ? '异常' : (order.isAudited ? '已审核' : '待审核') }}</span>
        </div>
        <span class="order-no">{{ order.orderNo }}</span>
      </div>

      <!-- 基本信息 -->
      <div class="info-section">
        <div class="section-title">
          基本信息
        </div>

        <!-- 查看模式 -->
        <div v-if="!isEditing" class="info-grid">
          <div class="info-item">
            <span class="info-label">车牌号</span>
            <span class="info-value">{{ order.plateNumber || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">车型</span>
            <span class="info-value">{{ order.carModel || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">所属门店</span>
            <span class="info-value">{{ getShopName(order.shopId) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">客户名称</span>
            <span class="info-value">{{ order.customerName || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">联系电话</span>
            <span class="info-value">{{ order.phone || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">工单日期</span>
            <span class="info-value">{{ formatDate(order.orderDate) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">结算月份</span>
            <span class="info-value">{{ order.settlementMonth || '-' }}</span>
          </div>
          <div v-if="order.isAbnormal" class="info-item" style="grid-column: 1 / -1">
            <van-notice-bar left-icon="warning" :text="'异常原因: ' + (order.abnormalRemark || '未填写')" background="#fff2f0" color="#ff4d4f" />
          </div>
        </div>

        <!-- 编辑模式 -->
        <div v-else class="edit-grid">
          <div class="ocr-btn-wrap">
            <van-button type="primary" size="small" plain icon="scan" :loading="ocrLoading" loading-text="识别中..." @click="handleOcrRecognize">
              OCR识别填充
            </van-button>
          </div>
          <van-field v-model="editForm.orderNo" label="工单号" placeholder="请输入工单号" />
          <van-field v-model="editForm.plateNumber" label="车牌号" placeholder="请输入车牌号" />
          <van-field v-model="editForm.carModel" label="车型" placeholder="请输入车型" />
          <van-field v-model="editForm.customerName" label="客户名称" placeholder="请输入客户名称" />
          <van-field v-model="editForm.phone" label="联系电话" placeholder="请输入电话" type="tel" />
          <van-field v-model="editForm.remark" label="备注" type="textarea" placeholder="请输入备注" rows="2" />
        </div>
      </div>

      <!-- 喷漆项目 -->
      <div class="info-section">
        <div class="section-title">
          喷漆项目
        </div>

        <!-- 查看模式 -->
        <div v-if="!isEditing && order.items && order.items.length" class="items-list">
          <div v-for="item in order.items" :key="item.id" class="item-card">
            <div class="item-header">
              <span class="item-name">{{ item.category?.name || item.categoryName || item.categoryId }}</span>
              <span class="item-paint">{{ Number(item.paintCount) }} 幅</span>
            </div>
            <div class="item-detail">
              <span class="item-info">数量: {{ item.quantity }}</span>
              <span v-if="item.newPartQuantity" class="item-info">新件: {{ item.newPartQuantity }}</span>
              <span v-if="item.specialPaint?.name" class="item-info special">{{ item.specialPaint.name }}</span>
            </div>
          </div>
        </div>

        <!-- 编辑模式 -->
        <div v-if="isEditing" class="edit-items-list">
          <div v-for="(item, index) in editForm.items" :key="index" class="edit-item-card">
            <div class="edit-item-header">
              <span class="item-name clickable" @click="openCategoryPicker(index)">
                {{ getEditItemName(index) }}
                <van-icon name="arrow-down" size="12" color="#1677ff" />
              </span>
              <van-icon name="delete-o" size="18" color="#ff4d4f" @click="removeEditItem(index)" />
            </div>
            <div class="edit-item-controls">
              <div class="control-group">
                <span class="control-label">数量</span>
                <van-stepper v-model="item.quantity" min="0" />
              </div>
              <div v-if="editStandards.find(s => s.categoryId === item.categoryId && Number(s.newPartAddition) > 0)" class="control-group">
                <span class="control-label">新件</span>
                <van-stepper v-model="item.newPartQuantity" min="0" />
              </div>
            </div>
          </div>
          <div class="add-item-btn" @click="addEditItem">
            <van-icon name="add-o" />
            <span>添加项目</span>
          </div>
        </div>

        <van-empty v-if="!isEditing && (!order.items || !order.items.length)" description="暂无喷漆项目" image="search" />

        <!-- 总幅数和部位数 -->
        <div v-if="!isEditing" class="total-bar">
          <div class="total-item">
            <span class="total-label">部位数</span>
            <span class="total-value">{{ viewPartCount }}</span>
          </div>
          <div class="total-item">
            <span class="total-label">总幅数</span>
            <span class="total-value highlight">{{ order.totalPaintCount }}</span>
          </div>
        </div>
        <div v-else class="total-bar">
          <div class="total-item">
            <span class="total-label">部位数</span>
            <span class="total-value">{{ editPartCount }}</span>
          </div>
          <div class="total-item">
            <span class="total-label">总幅数</span>
            <span class="total-value highlight">{{ editTotalPaintCount.toFixed(1) }}</span>
          </div>
        </div>
      </div>

      <!-- 工单图片 -->
      <div class="info-section">
        <div class="section-title-row">
          <span class="section-title">工单图片</span>
          <div v-if="isEditing" class="add-image-btn" @click="handleAddImage">
            <van-icon name="plus" />
            <span>添加</span>
          </div>
        </div>
        <div v-if="isEditing" class="image-grid">
          <!-- 已有图片（未标记删除的） -->
          <div v-for="img in editImages" :key="img.id" class="image-item">
            <van-image :src="img.thumbnailUrl || img.url" fit="cover" class="order-image" @click="previewImage(img.url)" />
            <div class="delete-image-btn" @click.stop="deleteImage(img.id)">
              <van-icon name="cross" size="12" color="#fff" />
            </div>
          </div>
          <!-- 待上传的新图片 -->
          <div v-for="(item, index) in editPendingUploads" :key="`pending-${index}`" class="image-item">
            <van-image :src="item.previewUrl" fit="cover" class="order-image" />
            <div class="delete-image-btn" @click.stop="removePendingUpload(index)">
              <van-icon name="cross" size="12" color="#fff" />
            </div>
          </div>
        </div>
        <div v-else>
          <div v-if="order.images && order.images.length" class="image-grid">
            <van-image
              v-for="img in order.images"
              :key="img.id"
              :src="img.thumbnailUrl || img.url"
              fit="cover"
              class="order-image"
              @click="previewImage(img.url)"
            />
          </div>
          <van-empty v-else description="暂无图片" image="search" />
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="action-bar">
        <template v-if="isEditing">
          <van-button block @click="cancelEdit">
            取消
          </van-button>
          <van-button type="primary" block :loading="saving" loading-text="保存中..." @click="saveEdit">
            保存
          </van-button>
        </template>
        <template v-else>
          <van-button v-if="!order.isAudited && allowEdit" plain type="primary" @click="enterEdit">
            编辑
          </van-button>
          <van-button v-if="!order.isAudited && allowAudit" type="primary" @click="handleAudit">
            审核
          </van-button>
          <van-button v-if="order.isAudited && allowAudit" type="warning" @click="handleUnaudit">
            取消审核
          </van-button>
          <van-button v-if="order.isAudited && !order.settlements?.length && allowAudit" type="success" @click="openSettlePopup">
            结算
          </van-button>
          <van-button v-if="order.isAudited && !order.isAbnormal && !order.settlements?.length && allowAudit" type="warning" plain @click="openAbnormalPopup">
            标记异常
          </van-button>
          <van-button v-if="order.isAudited && order.isAbnormal && allowAudit" type="danger" plain @click="openAbnormalPopup">
            取消异常
          </van-button>
          <van-button v-if="order.settlements?.length" type="warning" plain @click="openSettlementHistoryPopup">
            结算记录({{ order.settlements.length }})
          </van-button>
          <van-button v-if="!order.isAudited && allowDelete" type="danger" plain @click="handleDelete">
            删除
          </van-button>
        </template>
      </div>
    </div>

    <!-- 分类选择器 -->
    <van-popup v-model:show="showCategoryPicker" position="bottom" round>
      <van-picker
        :columns="categoryColumns"
        @confirm="onCategoryConfirm"
        @cancel="showCategoryPicker = false"
      />
    </van-popup>

    <!-- 异常标注弹窗 -->
    <van-popup v-model:show="showAbnormalPopup" position="bottom" round :style="{ padding: '20px' }">
      <div class="settle-popup">
        <div class="settle-title">{{ abnormalFlag ? '标记异常' : '取消异常' }}</div>
        <van-notice-bar v-if="abnormalFlag" left-icon="warning" text="标记异常后该工单将无法结算" background="#fffbe8" color="#ed6a0c" />
        <van-field v-model="abnormalRemarkInput" label="异常原因" type="textarea" :placeholder="abnormalFlag ? '请输入异常原因' : '备注（选填）'" rows="3" />
        <div class="settle-actions">
          <van-button block @click="showAbnormalPopup = false">取消</van-button>
          <van-button :type="abnormalFlag ? 'warning' : 'success'" block @click="confirmAbnormal">{{ abnormalFlag ? '确认标记' : '确认取消异常' }}</van-button>
        </div>
      </div>
    </van-popup>

    <!-- 结算弹窗 -->
    <van-popup v-model:show="showSettlePopup" position="bottom" round :style="{ padding: '20px' }">
      <div class="settle-popup">
        <div class="settle-title">结算工单</div>
        <van-field v-model="settleMonth" label="结算月份" placeholder="如 2026-05" />
        <van-field v-model="settleRemark" label="备注" type="textarea" placeholder="选填" rows="2" />
        <div class="settle-actions">
          <van-button block @click="showSettlePopup = false">取消</van-button>
          <van-button type="primary" block @click="confirmSettle">确认结算</van-button>
        </div>
      </div>
    </van-popup>

    <!-- 结算历史弹窗 -->
    <van-popup v-model:show="showSettlementHistory" position="bottom" round :style="{ maxHeight: '60vh' }">
      <div class="settlement-history">
        <div class="settle-title">结算记录</div>
        <van-empty v-if="settlementRecords.length === 0" description="暂无结算记录" />
        <div v-else class="settlement-list">
          <div v-for="record in settlementRecords" :key="record.id" class="settlement-item">
            <div class="settlement-info">
              <div class="settlement-month">{{ record.settlementMonth }}</div>
              <div class="settlement-detail">幅数: {{ Number(record.paintCount).toFixed(1) }} | 项目数: {{ record.itemCount }}</div>
              <div v-if="record.remark" class="settlement-remark">备注: {{ record.remark }}</div>
              <div class="settlement-time">{{ formatDate(record.createdAt) }}</div>
            </div>
            <van-button type="danger" size="small" plain @click="handleUnsettle(record.id)">删除</van-button>
          </div>
        </div>
        <van-button block style="margin-top: 12px" @click="showSettlementHistory = false">关闭</van-button>
      </div>
    </van-popup>

    <!-- OCR 冲突确认弹窗 -->
    <van-dialog
      v-model:show="showOcrConflict"
      title="OCR识别结果冲突"
      show-cancel-button
      confirm-button-text="覆盖选中"
      cancel-button-text="不覆盖"
      @confirm="confirmOcrConflict"
    >
      <div style="padding: 12px 16px; max-height: 300px; overflow-y: auto;">
        <p style="font-size: 13px; color: #969799; margin-bottom: 12px;">
          以下字段识别结果与已有数据不一致，勾选需覆盖的字段
        </p>
        <div
          v-for="(field, index) in ocrConflicts"
          :key="field.key"
          style="display: flex; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid #f5f5f5;"
        >
          <van-checkbox v-model="ocrConflicts[index].checked" />
          <div style="flex: 1;">
            <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px;">{{ field.label }}</div>
            <div style="font-size: 13px; color: #969799;">
              <span style="text-decoration: line-through;">{{ field.oldValue }}</span>
              <span style="margin: 0 6px;">→</span>
              <span style="color: #ff976a; font-weight: bold;">{{ field.newValue }}</span>
            </div>
          </div>
        </div>
      </div>
    </van-dialog>

    <!-- 多图片选择弹窗 -->
    <van-popup v-model:show="showImagePicker" position="bottom" round :style="{ padding: '16px' }">
      <div class="image-picker">
        <div class="picker-title">选择要识别的图片</div>
        <div class="picker-grid">
          <div
            v-for="(img, index) in editImages"
            :key="img.id"
            class="picker-item"
            @click="onPickImage(img.url)"
          >
            <van-image :src="img.thumbnailUrl || img.url" fit="cover" class="picker-image" />
            <div class="picker-index">{{ index + 1 }}</div>
          </div>
        </div>
        <div class="picker-cancel" @click="showImagePicker = false">取消</div>
      </div>
    </van-popup>
  </div>
</template>

<route lang="json5">
{
  name: 'WorkOrderDetail'
}
</route>

<style lang="less" scoped>
.detail-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 80px;
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.status-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  color: #fff;

  &.pending { background: linear-gradient(135deg, #fa8c16, #ffa940); }
  &.audited { background: linear-gradient(135deg, #52c41a, #73d13d); }
  &.abnormal { background: linear-gradient(135deg, #ff4d4f, #ff7875); }
}

.status-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-text {
  font-size: 16px;
  font-weight: 600;
}

.order-no {
  font-size: 14px;
  opacity: 0.9;
}

.info-section {
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

.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  .section-title { margin-bottom: 0; }
}

.add-image-btn {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: #1677ff;
}

.info-grid {
  display: flex;
  flex-wrap: wrap;
}

.info-item {
  width: 50%;
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
}

.info-label {
  font-size: 12px;
  color: #999;
  margin-bottom: 2px;
}

.info-value {
  font-size: 14px;
  color: #333;
}

.edit-grid {
  :deep(.van-field) {
    padding: 10px 16px;
  }
}

.ocr-btn-wrap {
  padding: 10px 14px;
  border-bottom: 1px solid #f5f5f5;
  display: flex;
  justify-content: flex-end;
}

.image-picker {
  .picker-title {
    text-align: center;
    font-size: 16px;
    font-weight: bold;
    padding: 8px 0 16px;
  }

  .picker-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    max-height: 50vh;
    overflow-y: auto;
  }

  .picker-item {
    position: relative;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;

    .picker-image {
      width: 100%;
      height: 100%;
    }

    .picker-index {
      position: absolute;
      top: 4px;
      left: 4px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  .picker-cancel {
    text-align: center;
    padding: 16px 0 4px;
    color: #969799;
    font-size: 14px;
  }
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item-card {
  padding: 10px;
  background: #f8f9fa;
  border-radius: 8px;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;

  &.clickable {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #1677ff;
    cursor: pointer;
  }
}

.item-paint {
  font-size: 14px;
  font-weight: 600;
  color: #1677ff;
}

.item-detail {
  display: flex;
  gap: 12px;
}

.item-info {
  font-size: 12px;
  color: #666;

  &.special { color: #722ed1; }
}

.edit-items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.edit-item-card {
  padding: 10px;
  background: #f8f9fa;
  border-radius: 8px;
}

.edit-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.edit-item-controls {
  display: flex;
  gap: 20px;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-label {
  font-size: 12px;
  color: #999;
}

.add-item-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px;
  border: 1px dashed #d9d9d9;
  border-radius: 8px;
  color: #1677ff;
  font-size: 13px;
  cursor: pointer;
}

.total-bar {
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.total-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.total-label {
  font-size: 12px;
  color: #999;
}

.total-value {
  font-size: 18px;
  font-weight: 600;
  color: #333;

  &.highlight {
    color: #1677ff;
  }
}

.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-item {
  position: relative;
  width: calc(33.33% - 6px);
  aspect-ratio: 1;
}

.order-image {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
}

.delete-image-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  background: #fff;
  box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.06);

  :deep(.van-button) {
    flex: 1;
  }
}

.settle-popup {
  .settle-title {
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    margin-bottom: 16px;
  }

  .settle-actions {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }
}

.settlement-history {
  padding: 16px;

  .settle-title {
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    margin-bottom: 12px;
  }
}

.settlement-list {
  max-height: 40vh;
  overflow-y: auto;
}

.settlement-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f7f8fa;
  border-radius: 8px;
  margin-bottom: 8px;
}

.settlement-info {
  flex: 1;
}

.settlement-month {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.settlement-detail {
  font-size: 13px;
  color: #666;
  margin-top: 4px;
}

.settlement-remark {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.settlement-time {
  font-size: 12px;
  color: #bbb;
  margin-top: 2px;
}
</style>
