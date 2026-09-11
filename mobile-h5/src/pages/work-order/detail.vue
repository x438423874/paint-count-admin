<script setup lang="ts">
import {
  auditWorkOrder,
  deleteWorkOrder,
  deleteWorkOrderImage,
  fetchOrderNoRules,
  fetchVehicleByPlate,
  getShopCategoriesWithStandard,
  getSpecialPaintList,
  getWorkOrderDetail,
  ocrRecognizeImage,
  setAbnormal,
  settleWorkOrder,
  unauditWorkOrder,
  unsettleWorkOrder,
  updateWorkOrder,
  uploadWorkOrderImage,
} from '@/api/paint'
import type { CreateWorkOrderItemDto, PaintSpecialPaint, PaintStandard, PaintVehicle, PaintWorkOrder } from '@/api/types/paint'
import type { OrderNoRule } from '@/api/paint'
import { compressImage } from '@/utils/image-compress'
import { resolveImageUrl } from '@/utils/image-url'
import { phoneRegex, plateNumberRegex, vinRegex } from '@/utils/validators'
import { computeItemPaintCount, computeTotalPaintCount, formatAutoPaintCount, getPaintDecimalLength, normalizeOverridePaintCount } from '@/utils/paint-count'
import { applyOcrFields } from '@/utils/ocr-fields'
import { fetchImageAsFile, uploadCompressed } from '@/composables/useImageUpload'
import { canAudit, canDelete, canEdit } from '@/utils/permission'
import { analyzeOrderNoErrors } from '@/utils/order-no-rule'
import { useShopOptions } from '@/composables/useShopOptions'
import { orderStatusClass, orderStatusIcon, orderStatusLabel } from '@/constants/order-status'
import { confirmAction } from '@/composables/useConfirm'

// 权限标志
const allowAudit = canAudit()
const allowDelete = canDelete()
const allowEdit = canEdit()

const route = useRoute()
const router = useRouter()
const orderId = ref('')
const order = ref<PaintWorkOrder | null>(null)
// 返工备注输入（loadDetail 中会根据工单初始化，声明前置）
const reworkRemarkInput = ref('')
const loading = ref(false)
// 门店走 dict store 共享缓存，全应用只请求一次（原为每页各自 getShopList）
const { shops, ensureShops } = useShopOptions()
const isEditing = ref(false)
const saving = ref(false)
const ocrCorrectionMode = ref(false)

// 详情页操作栏：核心操作随状态常驻，次要操作收进「更多」面板
const showMoreActions = ref(false)
const moreActions = computed(() => {
  const o = order.value
  const s = o?.status
  const list: { name: string, color?: string }[] = []
  if (s && !isUnauditedStatus(s) && allowEdit && o.images && o.images.length) {
    list.push({ name: '修正OCR', color: 'var(--color-warning)' })
  }
  if (s && isAuditedStatus(s) && allowAudit) {
    list.push({ name: '取消审核', color: 'var(--color-warning)' })
    list.push({ name: '标记异常', color: 'var(--color-warning)' })
  }
  if (s && isUnauditedStatus(s) && allowDelete) {
    list.push({ name: '删除', color: 'var(--color-danger)' })
  }
  return list
})
function onMoreSelect(action: { name: string }) {
  showMoreActions.value = false
  switch (action.name) {
    case '修正OCR':
      enterOcrCorrection()
      break
    case '取消审核':
      handleUnaudit()
      break
    case '标记异常':
      openAbnormalPopup()
      break
    case '删除':
      handleDelete()
      break
  }
}

// OCR 识别状态
const ocrLoading = ref(false)
const showImagePicker = ref(false)
/** OCR识别模式：默认智能选择，用户可手动切换 */
const editOcrMode = ref<'basic' | 'items' | 'all'>('basic')

// 车辆主数据自动填充
const vehicleLookingUp = ref(false)
const vehicleFound = ref<PaintVehicle | null>(null)
const vehicleMatchedFields = ref<string[]>([])
// 查看模式下的车辆主数据（展示累计工单数等信息）
const viewModeVehicle = ref<PaintVehicle | null>(null)

// 编辑表单
const editForm = reactive({
  orderNo: '',
  plateNumber: '',
  carModel: '',
  vin: '',
  brand: '',
  orderDate: '',
  settlementMonth: '',
  customerName: '',
  phone: '',
  remark: '',
  items: [] as CreateWorkOrderItemDto[],
})

// 编辑表单校验
const editOrderNoError = ref('')
const editPlateNumberError = ref('')
const editVinError = ref('')
const editPhoneError = ref('')
const editOrderNoRules = ref<OrderNoRule[]>([])
const ocrVinCorrectionMsg = ref('')

// 校验正则统一维护在 utils/validators（车牌/手机号/车架号）

// 日期选择器
const showEditDatePicker = ref(false)
const editDatePickerValues = ref<string[]>(['2024', '01', '01'])

function onEditDateConfirm({ selectedValues }: any) {
  editForm.orderDate = selectedValues.join('-')
  showEditDatePicker.value = false
}

// 结算月份选择器
const showEditSettlementMonthPicker = ref(false)
const editSettlementMonthPickerValue = computed<string[]>({
  get: () => (editForm.settlementMonth ? editForm.settlementMonth.split('-') : []),
  set: (val) => {
    editForm.settlementMonth = val.join('-')
  },
})

function onEditSettlementMonthConfirm({ selectedValues }: { selectedValues: string[] }) {
  editForm.settlementMonth = selectedValues.join('-')
  showEditSettlementMonthPicker.value = false
}

// 编辑用的标准
const editStandards = ref<PaintStandard[]>([])
const specialPaints = ref<PaintSpecialPaint[]>([])
const showCategoryPicker = ref(false)
const editingItemIndex = ref(-1)
// 多选弹层
const showCategoryMultiPicker = ref(false)
const categoryColumns = computed(() => {
  const currentItem = editForm.items[editingItemIndex.value]
  const currentCategoryId = currentItem?.categoryId
  const selectedIds = new Set(editForm.items
    .filter((_, idx) => idx !== editingItemIndex.value)
    .map(i => i.categoryId)
    .filter(Boolean) as string[])
  return editStandards.value
    .filter(s => !selectedIds.has(s.categoryId) || s.categoryId === currentCategoryId)
    .map(s => ({
      text: `${s.category?.name || s.alias || s.categoryId} (${Number(s.coefficient).toFixed(1)}幅)`,
      value: s.categoryId,
    }))
})

// 编辑模式下的图片状态
const editPendingUploads = ref<{ file: File, previewUrl: string }[]>([])
const editPendingDeleteIds = ref<string[]>([])
const editImages = computed(() => {
  if (!order.value?.images)
    return []
  return order.value.images.filter(img => !editPendingDeleteIds.value.includes(img.id))
})

function getShopName(shopId: string) {
  if (!shopId)
    return '-'
  const shop = shops.value.find(s => s.id === shopId)
  return shop?.name || shopId
}

function isUnauditedStatus(status?: string): boolean {
  return status === 'DRAFT' || status === 'PENDING'
}

function isAuditedStatus(status?: string): boolean {
  return status === 'AUDITED'
}

function isAbnormalStatus(status?: string): boolean {
  return status === 'ABNORMAL'
}

async function loadDetail() {
  if (!orderId.value)
    return
  loading.value = true
  try {
    const res = await getWorkOrderDetail(orderId.value)
    order.value = res as any as PaintWorkOrder
    reworkRemarkInput.value = order.value?.reworkRemark || ''
    // 查看模式下：若有车牌号则预查车辆主数据（显示累计工单数等）
    if (order.value?.plateNumber && order.value.plateNumber.trim()) {
      fetchVehicleByPlate(order.value.plateNumber.trim().toUpperCase())
        .then((data) => { viewModeVehicle.value = data })
        .catch(() => { viewModeVehicle.value = null })
    }
    else {
      viewModeVehicle.value = null
    }
  }
  catch {
    order.value = null
    reworkRemarkInput.value = ''
  }
  finally {
    loading.value = false
    nextTick(() => {
      window.scrollTo(0, 0)
    })
  }
}

function enterEdit() {
  if (!order.value || !isUnauditedStatus(order.value.status))
    return
  ocrCorrectionMode.value = false
  initEditForm(order.value)
  editPendingUploads.value = []
  editPendingDeleteIds.value = []
  loadEditStandards()
  loadSpecialPaints(order.value?.shopId)
  loadEditOrderNoRules()
  clearEditErrors()
  isEditing.value = true
}

function enterOcrCorrection() {
  if (!order.value || !isAuditedStatus(order.value.status))
    return
  ocrCorrectionMode.value = true
  initEditForm(order.value)
  editPendingUploads.value = []
  editPendingDeleteIds.value = []
  loadEditOrderNoRules()
  clearEditErrors()
  isEditing.value = true
}

function initEditForm(source: PaintWorkOrder) {
  editForm.orderNo = source.orderNo || ''
  editForm.plateNumber = source.plateNumber || ''
  editForm.carModel = source.carModel || ''
  editForm.vin = source.vin || ''
  editForm.brand = source.brand || ''
  editForm.orderDate = source.orderDate ? source.orderDate.slice(0, 10) : ''
  editForm.settlementMonth = source.settlementMonth || ''
  editForm.customerName = source.customerName || ''
  editForm.phone = source.phone || ''
  editForm.remark = source.remark || ''
  editForm.items = (source.items || []).map(item => ({
    categoryId: item.categoryId,
    quantity: item.quantity,
    newPartQuantity: item.newPartQuantity,
    specialPaintId: item.specialPaintId || undefined,
    // 保存已有 paintCount 作为 overridePaintCount，等 standards 加载后清理与自动计算一致的值
    overridePaintCount: item.paintCount !== undefined && item.paintCount !== null ? Number(item.paintCount) : undefined,
  }))
  // 重置车辆匹配状态，并在有车牌时触发一次查询（编辑模式打开时）
  vehicleFound.value = null
  vehicleMatchedFields.value = []
  if (editForm.plateNumber && editForm.plateNumber.trim()) {
    lookupVehicle(editForm.plateNumber)
  }
}

// 车辆主数据：按车牌号查询历史车辆并自动填充字段
// overwrite=false: 仅填充空字段（初始加载时用，不覆盖用户已填值）
// overwrite=true: 用车辆主数据覆盖所有字段（用户手动修改车牌号后失焦时用）
async function lookupVehicle(plate: string, overwrite = false) {
  const normalized = (plate || '').trim().toUpperCase()
  if (!normalized || !plateNumberRegex.test(normalized)) {
    vehicleFound.value = null
    vehicleMatchedFields.value = []
    return
  }
  if (vehicleFound.value?.plateNumber === normalized && !overwrite)
    return
  vehicleLookingUp.value = true
  try {
    const data = await fetchVehicleByPlate(normalized)
    if (data) {
      vehicleFound.value = data
      const fieldMap: Array<{ key: 'vin' | 'carModel' | 'brand' | 'customerName' | 'phone', vehicleKey: 'vin' | 'carModel' | 'brand' | 'customerName' | 'phone', label: string }> = [
        { key: 'vin', vehicleKey: 'vin', label: '车架号' },
        { key: 'carModel', vehicleKey: 'carModel', label: '车型' },
        { key: 'brand', vehicleKey: 'brand', label: '品牌' },
        { key: 'customerName', vehicleKey: 'customerName', label: '客户名称' },
        { key: 'phone', vehicleKey: 'phone', label: '电话' },
      ]
      const filled: string[] = []
      for (const { key, vehicleKey, label } of fieldMap) {
        const currentValue = ((editForm as any)[key] || '').trim()
        const vehicleValue = ((data as any)[vehicleKey] || '').trim()
        if (overwrite) {
          // 用户手动修改车牌号：用车辆主数据覆盖（空值也覆盖，即清空工单中不匹配的字段）
          if (vehicleValue && vehicleValue !== currentValue) {
            ;(editForm as any)[key] = vehicleValue
            filled.push(label)
          }
        }
        else {
          // 初始加载：仅填充空字段
          if (!currentValue && vehicleValue) {
            ;(editForm as any)[key] = vehicleValue
            filled.push(label)
          }
        }
      }
      vehicleMatchedFields.value = filled
      if (filled.length > 0) {
        showNotify({ type: 'success', message: `已匹配历史车辆，填充 ${filled.join('、')}（累计 ${data.totalOrderCount} 单）` })
      }
      else {
        showNotify({ type: 'primary', message: `匹配到历史车辆，累计 ${data.totalOrderCount} 单 / ${Number(data.totalPaintCount).toFixed(1)} 幅` })
      }
    }
    else {
      vehicleFound.value = null
      vehicleMatchedFields.value = []
    }
  }
  catch {
    vehicleFound.value = null
    vehicleMatchedFields.value = []
  }
  finally {
    vehicleLookingUp.value = false
  }
}

function onEditPlateNumberBlur() {
  const plate = (editForm.plateNumber || '').trim().toUpperCase()
  if (!plate) {
    vehicleFound.value = null
    vehicleMatchedFields.value = []
    return
  }
  // 用户手动修改车牌号后失焦，用车辆主数据覆盖字段
  lookupVehicle(plate, true)
}

function onEditPlateNumberInput() {
  if (vehicleFound.value) {
    const currentPlate = (editForm.plateNumber || '').trim().toUpperCase()
    if (vehicleFound.value.plateNumber !== currentPlate) {
      vehicleFound.value = null
      vehicleMatchedFields.value = []
    }
  }
}

function goVehicleHistory() {
  if (!vehicleFound.value)
    return
  router.push({ name: '/work-order/vehicle-history', query: { id: vehicleFound.value.id, plate: vehicleFound.value.plateNumber } })
}

/** 查看模式下跳转车辆历史（优先用 viewModeVehicle，否则用车牌号重新查询） */
function goViewModeVehicleHistory() {
  if (viewModeVehicle.value) {
    router.push({ name: '/work-order/vehicle-history', query: { id: viewModeVehicle.value.id, plate: viewModeVehicle.value.plateNumber } })
  }
  else if (order.value?.plateNumber) {
    // fallback：没有预查到车辆主数据，用车牌号作为查询参数
    router.push({ name: '/work-order/vehicle-history', query: { plate: order.value.plateNumber } })
  }
}

async function loadEditOrderNoRules() {
  if (!order.value?.shopId) {
    editOrderNoRules.value = []
    return
  }
  try {
    const res = await fetchOrderNoRules(order.value.shopId)
    editOrderNoRules.value = (res as any as OrderNoRule[]) || []
  }
  catch {
    editOrderNoRules.value = []
  }
}

function clearEditErrors() {
  editOrderNoError.value = ''
  editPlateNumberError.value = ''
  editVinError.value = ''
  editPhoneError.value = ''
  ocrVinCorrectionMsg.value = ''
}

async function loadSpecialPaints(shopId?: string) {
  // 仅加载该门店关联标准模板下的特殊车漆，避免不同模板间同名车漆重复出现
  const templateId = shopId ? shops.value.find(s => s.id === shopId)?.standardTemplateId : undefined
  try {
    const res = await getSpecialPaintList(true, templateId)
    specialPaints.value = (res as any as PaintSpecialPaint[]) || []
  }
  catch {
    specialPaints.value = []
  }
}

async function loadEditStandards() {
  if (!order.value?.shopId)
    return
  try {
    const res = await getShopCategoriesWithStandard(order.value.shopId)
    editStandards.value = (res as any as PaintStandard[]).filter(s => Number(s.coefficient) > 0)
    // 清理与自动计算值一致的 overridePaintCount
    editForm.items.forEach((item) => {
      if (item.overridePaintCount !== undefined && item.overridePaintCount !== null && item.categoryId) {
        const autoCount = getEditItemAutoPaintCount(item)
        if (Math.abs(item.overridePaintCount - autoCount) < 0.01) {
          item.overridePaintCount = undefined
        }
      }
    })
  }
  catch {
    editStandards.value = []
  }
}

function cancelEdit() {
  isEditing.value = false
  ocrCorrectionMode.value = false
  // 释放待上传图片的 Object URL
  editPendingUploads.value.forEach(item => URL.revokeObjectURL(item.previewUrl))
  editPendingUploads.value = []
  editPendingDeleteIds.value = []
}

// OCR 识别（识别工单已有图片或待上传图片，仅识别填入编辑表单，不保存）
function handleOcrRecognize() {
  const savedImages = editImages.value
  const pendingImages = editPendingUploads.value
  const totalCount = savedImages.length + pendingImages.length

  if (totalCount === 0) {
    showNotify({ type: 'warning', message: '工单无图片，无法识别' })
    return
  }
  // 只有一张图片时直接识别
  if (totalCount === 1) {
    if (savedImages.length === 1) {
      doOcrRecognize(resolveImageUrl(savedImages[0].url))
    }
    else {
      doOcrRecognize(pendingImages[0].file)
    }
    return
  }
  // 多张图片时弹出选择
  showImagePicker.value = true
}

// 选择图片后识别
function onPickImage(url: string) {
  showImagePicker.value = false
  doOcrRecognize(resolveImageUrl(url))
}

// 选择待上传图片后识别
function onPickPendingImage(index: number) {
  showImagePicker.value = false
  const item = editPendingUploads.value[index]
  if (item) {
    doOcrRecognize(item.file)
  }
}

// OCR 识别：来源为待上传的 File 或已保存图片的 URL（URL 来源先拉取转 File）
async function doOcrRecognize(source: File | string) {
  const shopId = order.value?.shopId
  if (!shopId) {
    showNotify({ type: 'warning', message: '门店信息缺失，无法识别' })
    return
  }
  ocrLoading.value = true
  try {
    const raw = typeof source === 'string' ? await fetchImageAsFile(source) : source
    const compressed = await compressImage(raw)
    const result = await ocrRecognizeImage(compressed, shopId, editOcrMode.value)
    applyOcrResult(result)
  }
  catch {
    showNotify({ type: 'danger', message: 'OCR识别失败' })
  }
  finally {
    ocrLoading.value = false
  }
}

// 将 OCR 识别结果应用到编辑表单（基础字段统一走 applyOcrFields，仅填充空白字段）
function applyOcrResult(result: any) {
  const { filledMessages, orderNoCorrected, vinCorrected } = applyOcrFields(editForm, result)

  // 工单号修正提示：OCR 识别的工单号不符合规则，后端已自动修正
  if (orderNoCorrected) {
    showNotify({ type: 'warning', message: `工单号已自动修正为 ${orderNoCorrected}` })
  }

  // VIN 车架号修正提示：OCR 识别的 VIN 含易混淆字符（O↔0、I↔1、Q↔0），后端已自动修正
  if (vinCorrected) {
    ocrVinCorrectionMsg.value = `OCR识别车架号含易混淆字符，已自动修正：「${vinCorrected.original}」→「${vinCorrected.corrected}」`
    showNotify({ type: 'warning', message: ocrVinCorrectionMsg.value })
  }
  else {
    ocrVinCorrectionMsg.value = ''
  }

  // OCR 填充完车牌后，触发车辆主数据查询，自动补全 OCR 未识别到的空字段
  if (editForm.plateNumber && editForm.plateNumber.trim()) {
    vehicleFound.value = null
    vehicleMatchedFields.value = []
    lookupVehicle(editForm.plateNumber)
  }

  if (filledMessages.length > 0) {
    showNotify({ type: 'success', message: `已填充 ${filledMessages.join('、')}` })
  }
  else if (!orderNoCorrected) {
    showNotify({ type: 'warning', message: '未识别到有效信息或所有字段已填写' })
  }
}

async function saveEdit() {
  if (!order.value)
    return

  // 校验工单号规则
  if (editForm.orderNo && editForm.orderNo.trim() && editOrderNoRules.value.length > 0) {
    const upper = editForm.orderNo.trim().toUpperCase()
    let matched = false
    for (const rule of editOrderNoRules.value) {
      try {
        const regex = new RegExp(`^${rule.pattern}$`)
        if (regex.test(upper)) {
          matched = true
          break
        }
      }
      catch {
        continue
      }
    }
    if (!matched) {
      const errors = analyzeOrderNoErrors(upper, editOrderNoRules.value)
      editOrderNoError.value = errors.length > 0
        ? errors.join('；')
        : `工单号不符合门店规则（长度应为 ${editOrderNoRules.value.map(r => r.length).join('/')}）`
      showNotify({ type: 'warning', message: editOrderNoError.value })
      return
    }
  }

  // 校验车牌号
  if (editForm.plateNumber && editForm.plateNumber.trim()) {
    if (!plateNumberRegex.test(editForm.plateNumber.trim().toUpperCase())) {
      editPlateNumberError.value = '车牌号格式不正确（普通车牌7位，新能源车牌8位）'
      showNotify({ type: 'warning', message: editPlateNumberError.value })
      return
    }
  }

  // 校验车架号（非必填，填了则校验格式）
  if (editForm.vin && editForm.vin.trim() && !vinRegex.test(editForm.vin.trim().toUpperCase())) {
    editVinError.value = '车架号应为17位字母数字（不含I、O、Q）'
    showNotify({ type: 'warning', message: editVinError.value })
    return
  }

  // 校验手机号（非必填，填了则校验格式）
  if (editForm.phone && editForm.phone.trim() && !phoneRegex.test(editForm.phone.trim())) {
    editPhoneError.value = '手机号应为11位数字，以1开头'
    showNotify({ type: 'warning', message: editPhoneError.value })
    return
  }

  saving.value = true
  try {
    if (ocrCorrectionMode.value) {
      // 修正 OCR：只提交基础字段，不修改项目、不增删图片
      await updateWorkOrder({
        id: order.value.id,
        orderNo: editForm.orderNo || undefined,
        plateNumber: editForm.plateNumber || undefined,
        carModel: editForm.carModel || undefined,
        vin: editForm.vin || undefined,
        brand: editForm.brand || undefined,
        orderDate: editForm.orderDate || undefined,
        customerName: editForm.customerName || undefined,
        phone: editForm.phone || undefined,
      })
    }
    else {
      const validItems = editForm.items.filter(item => item.quantity && item.quantity > 0)
      if (validItems.length === 0) {
        showNotify({ type: 'warning', message: '请至少添加一个喷漆项目' })
        saving.value = false
        return
      }
      // 负幅数自动识别为调整单（用于抵消/订正月报），统计时只贡献幅数、不计入工单数
      const isAdjustment = validItems.some(
        it => it.overridePaintCount !== undefined && it.overridePaintCount !== null && it.overridePaintCount < 0,
      )
      // 1. 保存基本信息
      await updateWorkOrder({
        id: order.value.id,
        orderNo: editForm.orderNo || undefined,
        plateNumber: editForm.plateNumber || undefined,
        carModel: editForm.carModel || undefined,
        vin: editForm.vin || undefined,
        brand: editForm.brand || undefined,
        orderDate: editForm.orderDate || undefined,
        settlementMonth: editForm.settlementMonth || undefined,
        customerName: editForm.customerName || undefined,
        phone: editForm.phone || undefined,
        remark: editForm.remark || undefined,
        isAdjustment,
        items: validItems.map((it) => {
          const item: any = {
            categoryId: it.categoryId,
            quantity: it.quantity,
            newPartQuantity: it.newPartQuantity,
            specialPaintId: it.specialPaintId || undefined,
          }
          if (it.overridePaintCount !== undefined && it.overridePaintCount !== null) {
            item.overridePaintCount = it.overridePaintCount
          }
          return item
        }),
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

      // 3. 批量上传新图片（压缩 + 429/5xx 自动重试统一走 useImageUpload）
      for (const item of editPendingUploads.value) {
        await uploadCompressed(item.file, (compressed, thumbnail) => uploadWorkOrderImage(orderId.value, compressed, 'BEFORE', thumbnail))
      }
    }

    showNotify({ type: 'success', message: '保存成功' })
    isEditing.value = false
    ocrCorrectionMode.value = false
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

// 部位数量修改：部位数量为 0 时直接删除该项目；并收敛超过部位数量的新件数量
function onEditQuantityChange(index: number) {
  const item = editForm.items[index]
  if (!item)
    return
  if (!item.quantity || item.quantity <= 0) {
    removeEditItem(index)
    return
  }
  if (item.newPartQuantity && item.newPartQuantity > item.quantity) {
    item.newPartQuantity = item.quantity
  }
}

function addEditItem() {
  if (editStandards.value.length === 0) {
    showNotify({ type: 'warning', message: '部位标准加载中，请稍后重试' })
    return
  }
  const selectedIds = new Set(editForm.items.map(i => i.categoryId).filter(Boolean) as string[])
  const hasUnselected = editStandards.value.some(s => !selectedIds.has(s.categoryId))
  if (!hasUnselected) {
    showNotify({ type: 'warning', message: '所有部位已选择' })
    return
  }
  // 打开多选弹层（勾选状态由组件内部管理，打开时自动重置）
  showCategoryMultiPicker.value = true
}

// 多选弹层可勾选的部位（排除已选）
const categoryMultiOptions = computed(() => {
  const selectedIds = new Set(editForm.items.map(i => i.categoryId).filter(Boolean) as string[])
  return editStandards.value
    .filter(s => !selectedIds.has(s.categoryId))
    .map(s => ({
      id: s.categoryId,
      label: `${s.category?.name || s.alias || s.categoryId} (${Number(s.coefficient).toFixed(1)}幅)`,
    }))
})

function onCategoryMultiConfirm(ids: string[]) {
  for (const categoryId of ids) {
    // 防御：跳过已被选中的部位
    if (editForm.items.some(i => i.categoryId === categoryId))
      continue
    editForm.items.push({
      categoryId,
      quantity: 1,
      newPartQuantity: 0,
    })
  }
}

function openCategoryPicker(index: number) {
  editingItemIndex.value = index
  showCategoryPicker.value = true
}

function onCategoryConfirm(value: string) {
  if (editingItemIndex.value >= 0 && value) {
    editForm.items[editingItemIndex.value].categoryId = value
  }
}

function getEditItemName(index: number) {
  const item = editForm.items[index]
  if (!item)
    return ''
  const std = editStandards.value.find(s => s.categoryId === item.categoryId)
  return std?.category?.name || std?.alias || item.categoryId || `项目${index + 1}`
}

async function handleAudit() {
  if (!order.value)
    return
  confirmAction({
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
  if (!order.value)
    return
  confirmAction({
    title: '取消审核',
    message: '确认取消审核？',
  }).then(async () => {
    try {
      await unauditWorkOrder(order.value!.id)
      showNotify({ type: 'success', message: '已取消审核' })
      loadDetail()
    }
    catch (e: any) {
      const msg = e?.message || e?.msg || '取消审核失败'
      showNotify({ type: 'danger', message: msg })
    }
  }).catch(() => {})
}

async function handleDelete() {
  if (!order.value)
    return
  confirmAction({
    title: '确认删除',
    message: '删除后不可恢复，确认删除？',
    danger: true,
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

async function handleSettle() {
  if (!order.value)
    return
  confirmAction({
    title: '确认结算',
    message: '确认结算此工单？',
  }).then(async () => {
    try {
      await settleWorkOrder(order.value!.id)
      showNotify({ type: 'success', message: '结算成功' })
      await loadDetail()
    }
    catch (e: any) {
      showNotify({ type: 'danger', message: e?.message || '结算失败' })
    }
  }).catch(() => {})
}

// ===== 异常标注相关 =====
const showAbnormalPopup = ref(false)
const abnormalFlag = ref(true)
const abnormalRemarkInput = ref('')

function openAbnormalPopup() {
  if (!order.value)
    return
  abnormalFlag.value = order.value.status !== 'ABNORMAL'
  abnormalRemarkInput.value = order.value.abnormalRemark || ''
  showAbnormalPopup.value = true
}

async function confirmAbnormal() {
  if (!order.value)
    return
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

// ===== 返工标记相关 =====
const reworkSaving = ref(false)

async function toggleRework(isRework: boolean) {
  if (!order.value || reworkSaving.value)
    return
  reworkSaving.value = true
  try {
    await updateWorkOrder({
      id: order.value.id,
      isRework,
      reworkRemark: isRework ? (reworkRemarkInput.value || undefined) : undefined,
    })
    showNotify({ type: 'success', message: isRework ? '已标记返工' : '已取消返工' })
    await loadDetail()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '操作失败' })
  }
  finally {
    reworkSaving.value = false
  }
}

async function handleUnsettle() {
  if (!order.value)
    return
  confirmAction({
    title: '确认取消结算',
    message: '确认取消结算？',
  }).then(async () => {
    try {
      await unsettleWorkOrder(order.value!.id)
      showNotify({ type: 'success', message: '已取消结算' })
      await loadDetail()
    }
    catch (e: any) {
      showNotify({ type: 'danger', message: e?.message || '取消结算失败' })
    }
  }).catch(() => {})
}

function handleAddImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = (e: Event) => {
    const files = (e.target as HTMLInputElement).files
    if (!files)
      return
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
      ...editImages.value.map(img => resolveImageUrl(img.url)),
      ...editPendingUploads.value.map(item => item.previewUrl),
    ]
  }
  else {
    urls = (order.value?.images || []).map(img => resolveImageUrl(img.url))
  }
  const target = resolveImageUrl(url)
  showImagePreview({ images: urls, startPosition: Math.max(0, urls.indexOf(target)) })
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
  if (!dateStr)
    return ''
  return dateStr.slice(0, 10)
}

// 编辑模式下的总幅数和部位数
/** 获取编辑模式下单个 item 的自动计算幅数 */
function getEditItemAutoPaintCount(item: CreateWorkOrderItemDto): number {
  if (!item.quantity || item.quantity <= 0)
    return 0
  const std = editStandards.value.find(s => s.categoryId === item.categoryId)
  return computeItemPaintCount(item, std, specialPaints.value)
}

// 幅数小数位控制：默认显示1位小数，聚焦输入时允许输入2位小数
const paintFocusIndex = ref<number | null>(null)

function onPaintCountBlur(item: CreateWorkOrderItemDto) {
  paintFocusIndex.value = null
  normalizeOverridePaintCount(item)
}

// 特殊车漆选项（编辑模式）
const specialPaintOptions = computed(() => [
  { text: '无', value: '' },
  ...specialPaints.value.map(sp => ({ text: `${sp.name} x${sp.multiplier}`, value: sp.id })),
])

const showSpecialPaintPicker = ref(false)
const editingSpecialPaintIndex = ref(-1)

function openSpecialPaintPicker(index: number) {
  editingSpecialPaintIndex.value = index
  showSpecialPaintPicker.value = true
}

function onSpecialPaintConfirm(value: string) {
  const index = editingSpecialPaintIndex.value
  if (index < 0 || !editForm.items[index])
    return
  const item = editForm.items[index]
  const nextId = value || undefined
  if ((item.specialPaintId || undefined) === nextId)
    return
  item.specialPaintId = nextId
  // 系数变化后，原有覆盖幅数不再匹配自动计算值时清除覆盖，保证按新系数重算
  if (item.overridePaintCount !== undefined && item.overridePaintCount !== null) {
    const autoCount = getEditItemAutoPaintCount(item)
    if (Math.abs(item.overridePaintCount - autoCount) >= 0.01)
      item.overridePaintCount = undefined
  }
}

function getSpecialPaintName(specialPaintId?: string) {
  if (!specialPaintId)
    return '无'
  const sp = specialPaints.value.find(s => s.id === specialPaintId)
  return sp ? `${sp.name} x${sp.multiplier}` : '无'
}

const editTotalPaintCount = computed(() => computeTotalPaintCount(editForm.items, editStandards.value, specialPaints.value))

const editPartCount = computed(() => {
  return editForm.items.reduce((sum, item) => sum + (item.quantity || 0), 0)
})

// 查看模式下的部位数
const viewPartCount = computed(() => {
  if (!order.value?.items)
    return 0
  return order.value.items.reduce((sum, item) => sum + (item.quantity || 0), 0)
})

onMounted(() => {
  orderId.value = (route.query.id as string) || ''
  window.scrollTo(0, 0)
  ensureShops()
  loadDetail()
})
</script>

<template>
  <div class="detail-page">
    <div v-if="loading" class="loading-wrap">
      <div class="skeleton-card">
        <van-skeleton title avatar :row="2" />
      </div>
      <div class="skeleton-card">
        <van-skeleton title :row="3" />
      </div>
      <div class="skeleton-card">
        <van-skeleton :row="2" />
      </div>
    </div>

    <div v-else-if="order" class="detail-content">
      <!-- 顶部状态栏 -->
      <div class="status-banner" :class="[orderStatusClass(order.status)]">
        <div class="status-left">
          <van-icon :name="orderStatusIcon(order.status)" size="20" color="#fff" />
          <span class="status-text">{{ orderStatusLabel(order.status) }}</span>
          <van-tag v-if="order.isAdjustment" type="warning" size="medium">调整单</van-tag>
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
            <span class="info-value">
              {{ order.plateNumber || '-' }}
              <van-tag
                v-if="viewModeVehicle && viewModeVehicle.totalOrderCount > 0"
                type="primary"
                size="medium"
                style="margin-left: 6px; cursor: pointer;"
                @click="goViewModeVehicleHistory"
              >
                历史{{ viewModeVehicle.totalOrderCount }}单
              </van-tag>
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">车型</span>
            <span class="info-value">{{ order.carModel || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">车架号</span>
            <span class="info-value">{{ order.vin || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">品牌</span>
            <span class="info-value">{{ order.brand || '-' }}</span>
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
          <div v-if="isAbnormalStatus(order.status)" class="info-item" style="grid-column: 1 / -1">
            <van-notice-bar left-icon="warning" :text="`异常原因: ${order.abnormalRemark || '未填写'}`" background="var(--color-error-bg)" color="var(--color-error)" />
          </div>
          <div v-if="order.isRework && order.reworkRemark" class="info-item" style="grid-column: 1 / -1">
            <van-notice-bar left-icon="warning" :text="`返工原因: ${order.reworkRemark}`" background="var(--color-error-bg)" color="var(--color-error)" />
          </div>
        </div>

        <!-- 编辑模式 -->
        <div v-else class="edit-grid">
          <div class="ocr-btn-wrap">
            <van-button type="primary" size="small" plain icon="scan" :loading="ocrLoading" loading-text="识别中..." @click="handleOcrRecognize">
              OCR识别填充
            </van-button>
            <van-radio-group v-model="editOcrMode" direction="horizontal" style="margin-left: 8px;">
              <van-radio name="basic" style="font-size: 12px;">
                基础资料
              </van-radio>
              <van-radio name="items" style="font-size: 12px;">
                部位
              </van-radio>
              <van-radio name="all" style="font-size: 12px;">
                全部
              </van-radio>
            </van-radio-group>
          </div>
          <van-field v-model="editForm.orderNo" label="工单号" placeholder="请输入工单号" :error-message="editOrderNoError" @update:model-value="editOrderNoError = ''" />
          <van-field
            v-model="editForm.plateNumber"
            label="车牌号"
            placeholder="请输入车牌号"
            :error-message="editPlateNumberError"
            :loading="vehicleLookingUp"
            @blur="onEditPlateNumberBlur"
            @update:model-value="() => { editPlateNumberError = ''; onEditPlateNumberInput(); }"
          >
            <template v-if="vehicleFound" #button>
              <van-button size="small" type="primary" plain @click="goVehicleHistory">
                历史{{ vehicleFound.totalOrderCount }}单
              </van-button>
            </template>
          </van-field>
          <van-notice-bar
            v-if="vehicleFound"
            left-icon="checked"
            :text="`已匹配历史车辆${vehicleMatchedFields.length ? `，已填充：${vehicleMatchedFields.join('、')}` : ''}（累计 ${vehicleFound.totalOrderCount} 单 / ${Number(vehicleFound.totalPaintCount).toFixed(1)} 幅）`"
            background="var(--color-success-bg)"
            color="var(--color-success)"
            style="margin: 0 16px 8px;"
          />
          <van-field v-model="editForm.carModel" label="车型" placeholder="请输入车型" />
          <van-field v-model="editForm.vin" label="车架号" placeholder="请输入车架号(VIN)" :error-message="editVinError || ocrVinCorrectionMsg" @update:model-value="editVinError = ''; ocrVinCorrectionMsg = ''" />
          <van-notice-bar v-if="ocrVinCorrectionMsg" left-icon="warning-o" :text="ocrVinCorrectionMsg" background="var(--color-warning-bg)" color="var(--color-warning)" style="margin: 0 16px 8px;" />
          <van-field v-model="editForm.brand" label="品牌" placeholder="请输入品牌" />
          <van-cell title="工单日期" :value="editForm.orderDate || '请选择日期'" is-link @click="showEditDatePicker = true" />
          <van-cell title="结算月份" :value="editForm.settlementMonth || '请选择月份'" is-link @click="showEditSettlementMonthPicker = true" />
          <van-field v-model="editForm.customerName" label="客户名称" placeholder="请输入客户名称" />
          <van-field v-model="editForm.phone" label="联系电话" placeholder="请输入电话" type="tel" :error-message="editPhoneError" @update:model-value="editPhoneError = ''" />
          <van-field v-model="editForm.remark" label="备注" type="textarea" placeholder="请输入备注" rows="2" />
        </div>
      </div>

      <!-- 返工标记 -->
      <div v-if="!isEditing" class="info-section">
        <div class="section-title">
          返工标记
        </div>
        <van-cell center title="是否返工">
          <template #right-icon>
            <van-switch
              :model-value="order.isRework"
              :loading="reworkSaving"
              size="22"
              @update:model-value="toggleRework"
            />
          </template>
        </van-cell>
        <van-field
          v-if="order.isRework"
          v-model="reworkRemarkInput"
          label="返工原因"
          type="textarea"
          placeholder="请输入返工原因（选填）"
          rows="2"
        />
        <van-button
          v-if="order.isRework"
          block
          type="danger"
          size="small"
          :loading="reworkSaving"
          @click="toggleRework(true)"
        >
          保存返工原因
        </van-button>
      </div>

      <!-- 喷漆项目 -->
      <div v-if="!isEditing || !ocrCorrectionMode" class="info-section">
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
        <div v-if="isEditing && !ocrCorrectionMode" class="edit-items-list">
          <div v-for="(item, index) in editForm.items" :key="index" class="edit-item-card">
            <div class="edit-item-header">
              <span class="item-name clickable" @click="openCategoryPicker(index)">
                {{ getEditItemName(index) }}
                <van-icon name="arrow-down" size="12" color="var(--color-primary)" />
              </span>
              <van-icon name="delete-o" size="18" color="var(--color-error)" @click="removeEditItem(index)" />
            </div>
            <div class="edit-item-controls">
              <div class="control-group">
                <span class="control-label">数量</span>
                <van-stepper v-model="item.quantity" min="0" @change="onEditQuantityChange(index)" />
              </div>
              <div v-if="editStandards.find(s => s.categoryId === item.categoryId && Number(s.newPartAddition) > 0)" class="control-group">
                <span class="control-label">新件</span>
                <van-stepper v-model="item.newPartQuantity" min="0" :max="item.quantity" />
              </div>
              <div class="control-group">
                <span class="control-label">幅数</span>
                <div class="paint-count-control">
                  <van-stepper
                    v-if="item.overridePaintCount !== undefined && item.overridePaintCount !== null"
                    :model-value="item.overridePaintCount"
                    min="-99" max="99" step="0.1" :decimal-length="getPaintDecimalLength(paintFocusIndex, index, item.overridePaintCount)"
                    input-width="48px"
                    @focus="paintFocusIndex = index"
                    @blur="onPaintCountBlur(item)"
                    @update:model-value="(val: number) => { item.overridePaintCount = val }"
                  />
                  <span v-else class="paint-count-value" @click="item.overridePaintCount = Number(formatAutoPaintCount(getEditItemAutoPaintCount(item), Boolean(item.specialPaintId)))">
                    {{ formatAutoPaintCount(getEditItemAutoPaintCount(item), Boolean(item.specialPaintId)) }}
                  </span>
                  <van-icon
                    v-if="item.overridePaintCount !== undefined && item.overridePaintCount !== null"
                    name="close"
                    size="14"
                    color="var(--color-error)"
                    style="margin-left: 4px; cursor: pointer;"
                    @click="item.overridePaintCount = undefined"
                  />
                </div>
              </div>
            </div>
            <div v-if="specialPaints.length > 0 && item.quantity > 0" class="special-paint-row">
              <van-cell
                title="特殊车漆"
                :value="getSpecialPaintName(item.specialPaintId)"
                is-link
                @click="openSpecialPaintPicker(index)"
              />
            </div>
          </div>
          <div class="add-item-btn" @click="addEditItem">
            <van-icon name="add-o" />
            <span>添加项目</span>
          </div>
        </div>

        <AppEmpty v-if="!isEditing && (!order.items || !order.items.length)" description="暂无喷漆项目" image="search" />

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
            <span class="total-value highlight">{{ formatAutoPaintCount(editTotalPaintCount, editForm.items.some(i => i.specialPaintId)) }}</span>
          </div>
        </div>
      </div>

      <!-- 工单图片 -->
      <div class="info-section">
        <div class="section-title-row">
          <span class="section-title">工单图片</span>
          <div v-if="isEditing && !ocrCorrectionMode" class="add-image-btn" @click="handleAddImage">
            <van-icon name="plus" />
            <span>添加</span>
          </div>
        </div>
        <div v-if="isEditing && !ocrCorrectionMode" class="image-grid">
          <!-- 已有图片（未标记删除的） -->
          <div v-for="img in editImages" :key="img.id" class="image-item">
            <van-image :src="resolveImageUrl(img.thumbnailUrl || img.url)" fit="cover" class="order-image" @click="previewImage(img.url)" />
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
              :src="resolveImageUrl(img.thumbnailUrl || img.url)"
              fit="cover"
              class="order-image"
              @click="previewImage(img.url)"
            />
          </div>
          <AppEmpty v-else description="暂无图片" image="search" />
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="action-bar">
        <template v-if="isEditing">
          <div class="primary-actions">
            <van-button @click="cancelEdit">
              取消
            </van-button>
            <van-button type="primary" :loading="saving" loading-text="保存中..." @click="saveEdit">
              保存
            </van-button>
          </div>
        </template>
        <template v-else>
          <!-- 核心操作：随状态常驻 -->
          <div class="primary-actions">
            <van-button v-if="isUnauditedStatus(order.status) && allowEdit" plain type="primary" @click="enterEdit">
              编辑
            </van-button>
            <van-button v-if="isUnauditedStatus(order.status) && allowAudit" type="primary" @click="handleAudit">
              审核
            </van-button>
            <van-button v-if="isAuditedStatus(order.status) && allowAudit" type="success" @click="handleSettle">
              结算
            </van-button>
            <van-button v-if="order.status === 'SETTLED' && allowAudit" type="warning" @click="handleUnsettle">
              取消结算
            </van-button>
            <van-button v-if="isAbnormalStatus(order.status) && allowAudit" type="danger" plain @click="openAbnormalPopup">
              取消异常
            </van-button>
          </div>
          <!-- 次要操作：收进更多面板 -->
          <van-button
            v-if="moreActions.length"
            class="more-btn"
            icon="ellipsis"
            @click="showMoreActions = true"
          >
            更多
          </van-button>
        </template>
      </div>

      <!-- 更多操作面板（次要操作） -->
      <van-action-sheet
        v-model:show="showMoreActions"
        :actions="moreActions"
        cancel-text="取消"
        description="更多操作"
        @select="onMoreSelect"
      />
    </div>

    <!-- 分类选择器（单选：修改已有部位类别） -->
    <PopupPicker
      v-model:show="showCategoryPicker"
      :columns="categoryColumns"
      title="选择部位"
      @confirm="onCategoryConfirm"
    />

    <!-- 分类多选弹层（添加部位） -->
    <CategoryMultiPicker
      v-model:show="showCategoryMultiPicker"
      :options="categoryMultiOptions"
      @confirm="onCategoryMultiConfirm"
    />

    <!-- 特殊车漆选择器（编辑模式） -->
    <PopupPicker
      v-model:show="showSpecialPaintPicker"
      :columns="specialPaintOptions"
      title="特殊车漆"
      @confirm="onSpecialPaintConfirm"
    />

    <!-- 编辑日期选择器 -->
    <van-popup v-model:show="showEditDatePicker" position="bottom" round>
      <van-date-picker
        v-model="editDatePickerValues"
        title="选择工单日期"
        :min-date="new Date(2020, 0, 1)"
        :max-date="new Date()"
        @confirm="onEditDateConfirm"
        @cancel="showEditDatePicker = false"
      />
    </van-popup>

    <!-- 编辑结算月份选择器 -->
    <van-popup v-model:show="showEditSettlementMonthPicker" position="bottom" round>
      <van-date-picker
        v-model="editSettlementMonthPickerValue"
        title="选择结算月份"
        :columns-type="['year', 'month']"
        :min-date="new Date(2020, 0, 1)"
        :max-date="new Date()"
        @confirm="onEditSettlementMonthConfirm"
        @cancel="showEditSettlementMonthPicker = false"
      />
    </van-popup>

    <!-- 异常标注弹窗 -->
    <van-popup v-model:show="showAbnormalPopup" position="bottom" round :style="{ padding: '20px' }">
      <div class="settle-popup">
        <div class="settle-title">
          {{ abnormalFlag ? '标记异常' : '取消异常' }}
        </div>
        <van-notice-bar v-if="abnormalFlag" left-icon="warning" text="标记异常后该工单将无法结算" background="var(--color-warning-bg)" color="var(--color-warning)" />
        <van-field v-model="abnormalRemarkInput" label="异常原因" type="textarea" :placeholder="abnormalFlag ? '请输入异常原因' : '备注（选填）'" rows="3" />
        <div class="settle-actions">
          <van-button block @click="showAbnormalPopup = false">
            取消
          </van-button>
          <van-button :type="abnormalFlag ? 'warning' : 'success'" block @click="confirmAbnormal">
            {{ abnormalFlag ? '确认标记' : '确认取消异常' }}
          </van-button>
        </div>
      </div>
    </van-popup>

    <!-- 多图片选择弹窗 -->
    <van-popup v-model:show="showImagePicker" position="bottom" round :style="{ padding: '16px' }">
      <div class="image-picker">
        <div class="picker-title">
          选择要识别的图片
        </div>
        <div class="picker-grid">
          <div
            v-for="(img, index) in editImages"
            :key="`saved-${img.id}`"
            class="picker-item"
            @click="onPickImage(img.url)"
          >
            <van-image :src="resolveImageUrl(img.thumbnailUrl || img.url)" fit="cover" class="picker-image" />
            <div class="picker-index">
              {{ index + 1 }}
            </div>
          </div>
          <div
            v-for="(item, index) in editPendingUploads"
            :key="`pending-${index}`"
            class="picker-item"
            @click="onPickPendingImage(index)"
          >
            <van-image :src="item.previewUrl" fit="cover" class="picker-image" />
            <div class="picker-index">
              {{ editImages.length + index + 1 }}
            </div>
          </div>
        </div>
        <div class="picker-cancel" @click="showImagePicker = false">
          取消
        </div>
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
  background: var(--color-bg);
  padding-bottom: 80px;
}

.loading-wrap {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-card {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--shadow-card);
}

.status-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  color: #fff;

  &.draft {
    background: linear-gradient(135deg, #8c8c8c, #bfbfbf);
  }
  &.pending {
    background: linear-gradient(135deg, var(--color-warning), #ffa940);
  }
  &.audited {
    background: linear-gradient(135deg, #52c41a, #73d13d);
  }
  &.settled {
    background: linear-gradient(135deg, #1890ff, #40a9ff);
  }
  &.abnormal {
    background: linear-gradient(135deg, var(--color-error), color-mix(in srgb, var(--color-error) 65%, #fff));
  }
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
  background: var(--color-surface);
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  .section-title {
    margin-bottom: 0;
  }
}

.add-image-btn {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--color-primary);
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
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.info-value {
  font-size: 14px;
  color: var(--text-regular);
}

.edit-grid {
  :deep(.van-field) {
    padding: 10px 16px;
  }
}

.ocr-btn-wrap {
  padding: 10px 14px;
  border-bottom: 1px solid var(--neutral-100);
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
    color: var(--text-tertiary);
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
  background: var(--color-bg);
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
  color: var(--text-regular);

  &.clickable {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--color-primary);
    cursor: pointer;
  }
}

.item-paint {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
}

.item-detail {
  display: flex;
  gap: 12px;
}

.item-info {
  font-size: 12px;
  color: var(--text-secondary);

  &.special {
    color: #722ed1;
  }
}

.edit-items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.edit-item-card {
  padding: 10px;
  background: var(--color-bg);
  border-radius: 8px;
}

.edit-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.edit-item-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;

  // 幅数（最后一项）独占整行，stepper 撑满更易操作
  .control-group:last-child {
    grid-column: 1 / -1;

    .paint-count-control {
      flex: 1;
    }

    :deep(.van-stepper) {
      width: 100%;
    }
  }
}

.special-paint-row {
  margin-top: 8px;

  :deep(.van-cell) {
    padding: 6px 0;
    font-size: 13px;
  }
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.paint-count-control {
  display: flex;
  align-items: center;
}

.paint-count-value {
  font-size: 13px;
  color: var(--text-regular);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-bg);
  min-width: 40px;
  text-align: center;
}

.add-item-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
}

.total-bar {
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid var(--color-border);
}

.total-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.total-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.total-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-regular);

  &.highlight {
    color: var(--color-primary);
  }
}

.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-item {
  position: relative;
  width: 100%;
  height: 220px;
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
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.04);
  z-index: 100;

  .primary-actions {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    :deep(.van-button) {
      flex: 1;
      min-width: 88px;
    }
  }

  .more-btn {
    flex: 0 0 auto;
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
</style>
