<script setup lang="ts">
import { createOrderFromPending, createWorkOrder, fetchOrderNoRules, fetchVehicleByPlate, getShopCategoriesWithStandard, getSpecialPaintList, ocrRecognizeImage, uploadPendingImage } from '@/api/paint'
import type { OrderNoRule } from '@/api/paint'
import type { CreateWorkOrderItemDto, PaintSpecialPaint, PaintStandard, PaintVehicle } from '@/api/types/paint'
import { compressImage } from '@/utils/image-compress'
import { analyzeOrderNoErrors } from '@/utils/order-no-rule'
import { phoneRegex, plateNumberRegex, vinRegex } from '@/utils/validators'
import { computeItemPaintCount, computeTotalPaintCount, formatAutoPaintCount, getPaintDecimalLength, normalizeOverridePaintCount } from '@/utils/paint-count'
import { applyOcrFields } from '@/utils/ocr-fields'
import { recentMonthOptions } from '@/utils/month-options'
import { getMyScopeCached, earliestTenureDate } from '@/utils/tenure'
import type { MyScope } from '@/api/paint'
import { describeUploadError, uploadCompressed } from '@/composables/useImageUpload'
import { useShopOptions } from '@/composables/useShopOptions'

const route = useRoute()
const router = useRouter()
const isManual = ref(false)
// 门店走 dict store 共享缓存，全应用只请求一次（原为每页各自 getShopList）
const { shops, ensureShops } = useShopOptions({ includeAll: false })
const standards = ref<PaintStandard[]>([])
const specialPaints = ref<PaintSpecialPaint[]>([])
const submitting = ref(false)
const plateNumberError = ref('')
const vinError = ref('')
const phoneError = ref('')
const orderNoError = ref('')
const orderNoRules = ref<OrderNoRule[]>([])
const ocrVinCorrectionMsg = ref('')

// 车辆主数据自动填充
const vehicleLookingUp = ref(false)
const vehicleFound = ref<PaintVehicle | null>(null)
const vehicleMatchedFields = ref<string[]>([])

// 校验正则统一维护在 utils/validators（车牌/手机号/车架号）

const form = reactive({
  shopId: '',
  orderNo: '',
  orderDate: '',
  settlementMonth: '',
  plateNumber: '',
  carModel: '',
  vin: '',
  brand: '',
  customerName: '',
  phone: '',
  remark: '',
  items: [] as CreateWorkOrderItemDto[],
})

// 车架号即时校验：非必填，填了就实时校验格式；错误保持显示直到修正或清空
watch(() => form.vin, (v) => {
  const val = (v || '').trim()
  vinError.value = val && !vinRegex.test(val.toUpperCase()) ? '车架号应为17位字母数字（不含I、O、Q）' : ''
})


const shopName = computed(() => {
  const shop = shops.value.find(s => s.id === form.shopId)
  return shop?.name || ''
})

const showShopPicker = ref(false)
const showDatePicker = ref(false)
const showMonthPicker = ref(false)

// 批量上传模式：
//  'create' = 直接创建工单：图片作为当前工单的 BEFORE 图（需先提交创建工单拿到工单号）
//  'ocr'    = OCR 创建工单：图片进图片池，OCR 后自动按门店/结算月份 + OCR 资料补建新工单
const uploadMode = ref<'create' | 'ocr'>('ocr')
// 提交创建工单成功后记录工单 id，供“直接创建工单”模式上传图片使用
const createdOrderId = ref<string>('')
const createdOrderNo = ref<string>('')
// 上传模式选择弹窗
const showUploadModePicker = ref(false)

// 在岗期 scope：会话级缓存，与月份/日期选项共用（加载失败宽松降级为近 30 天）
const scope = ref<MyScope | null>(null)
onMounted(async () => {
  scope.value = await getMyScopeCached()
})

// 结算月份选择列统一走 recentMonthOptions（当月及往前共 13 个月 ∩ 在岗期，最早到入职月）
const monthColumns = computed(() => recentMonthOptions({ months: 13, scope: scope.value }))

// 本地时区格式化为 yyyy-MM-dd（避免 toISOString 的 UTC 截断出现前一天）
function formatLocalDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dateColumns = computed(() => {
  const list = []
  const now = new Date()
  // 起始日：默认近 30 天；门店员工有入职时间时，从入职日开始显示
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  const hire = earliestTenureDate(scope.value)
  const start = hire ?? defaultStart
  for (let i = 0; ; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    if (d < start) break
    const value = formatLocalDate(d)
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    const label = `${value} 周${weekDay}`
    list.push({ text: label, value })
  }
  return list
})

function onShopConfirm(value: string) {
  form.shopId = value
  if (value) {
    loadStandards(value)
    loadOrderNoRules(value)
  }
}

function onDateConfirm(value: string) {
  form.orderDate = value
  if (value && value.length >= 7) {
    form.settlementMonth = value.slice(0, 7)
  }
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

async function loadStandards(shopId: string) {
  try {
    const res = await getShopCategoriesWithStandard(shopId)
    standards.value = (res as any as PaintStandard[]).filter(s => Number(s.coefficient) > 0)
    form.items = standards.value.map(s => ({
      categoryId: s.categoryId,
      quantity: 0,
      newPartQuantity: 0,
      specialPaintId: undefined,
    }))
  }
  catch {
    standards.value = []
    form.items = []
  }
}

async function loadOrderNoRules(shopId: string) {
  try {
    const res = await fetchOrderNoRules(shopId)
    orderNoRules.value = (res as any as OrderNoRule[]) || []
  }
  catch {
    orderNoRules.value = []
  }
}

// 总幅数计算（统一走 utils/paint-count，与详情页编辑口径一致）
const totalPaintCount = computed(() => computeTotalPaintCount(form.items, standards.value, specialPaints.value))

/**
 * 负幅数自动识别为调整单：
 * 任一提交项的幅数为负，整单即作为调整单提交（用于抵消/订正月报），
 * 统计时只贡献幅数、不计入工单数与车辆数。
 */
const isAdjustmentOrder = computed(() =>
  form.items.some(
    item =>
      item.quantity > 0
      && item.overridePaintCount !== undefined
      && item.overridePaintCount !== null
      && item.overridePaintCount < 0,
  ),
)

/** 获取单个 item 的自动计算幅数 */
function getItemAutoPaintCount(index: number): number {
  const item = form.items[index]
  if (!item || !item.quantity || item.quantity <= 0)
    return 0
  const std = standards.value.find(s => s.categoryId === item.categoryId)
  return computeItemPaintCount(item, std, specialPaints.value)
}

// 幅数小数位控制：默认显示1位小数，聚焦输入时允许输入2位小数
const paintFocusIndex = ref<number | null>(null)

function onPaintCountBlur(item: CreateWorkOrderItemDto) {
  paintFocusIndex.value = null
  normalizeOverridePaintCount(item)
}

// 特殊车漆选项
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
  if (editingSpecialPaintIndex.value >= 0 && form.items[editingSpecialPaintIndex.value]) {
    form.items[editingSpecialPaintIndex.value].specialPaintId = value || undefined
  }
}

function getSpecialPaintName(specialPaintId?: string) {
  if (!specialPaintId)
    return '无'
  const sp = specialPaints.value.find(s => s.id === specialPaintId)
  return sp ? `${sp.name} x${sp.multiplier}` : '无'
}

async function handleSubmit(opts?: { skipStrict?: boolean }) {
  const skipStrict = opts?.skipStrict ?? false
  if (!form.shopId) {
    showNotify({ type: 'warning', message: '请选择门店' })
    return
  }

  // 校验工单号规则（手动建单校验；图片批量建单放宽：不强制）
  if (!skipStrict && form.orderNo && form.orderNo.trim() && orderNoRules.value.length > 0) {
    const upper = form.orderNo.trim().toUpperCase()
    let matched = false
    for (const rule of orderNoRules.value) {
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
      const errors = analyzeOrderNoErrors(upper, orderNoRules.value)
      orderNoError.value = errors.length > 0
        ? errors.join('；')
        : `工单号不符合门店规则（长度应为 ${orderNoRules.value.map(r => r.length).join('/')}）`
      showNotify({ type: 'warning', message: orderNoError.value })
      return
    }
  }

  // 校验车牌号（图片批量建单放宽：仅需门店+结算月份）
  if (!skipStrict) {
    if (!form.plateNumber || !form.plateNumber.trim()) {
      plateNumberError.value = '请输入车牌号'
      return
    }
    if (!plateNumberRegex.test(form.plateNumber.trim().toUpperCase())) {
      plateNumberError.value = '车牌号格式不正确（普通车牌7位，新能源车牌8位）'
      return
    }
  }

  // 校验车架号（非必填，填了则校验格式）
  if (form.vin && form.vin.trim() && !vinRegex.test(form.vin.trim().toUpperCase())) {
    vinError.value = '车架号应为17位字母数字（不含I、O、Q）'
    return
  }

  // 校验手机号（非必填，填了则校验格式）
  if (form.phone && form.phone.trim() && !phoneRegex.test(form.phone.trim())) {
    phoneError.value = '手机号应为11位数字，以1开头'
    return
  }

  const validItems = form.items.filter(item => item.quantity > 0)
  if (!skipStrict && validItems.length === 0) {
    showNotify({ type: 'warning', message: '请至少添加一个喷漆项目' })
    return
  }

  submitting.value = true
  try {
    const created = await createWorkOrder({
      shopId: form.shopId,
      orderNo: form.orderNo || undefined,
      orderDate: form.orderDate || undefined,
      settlementMonth: form.settlementMonth || undefined,
      plateNumber: form.plateNumber || undefined,
      carModel: form.carModel || undefined,
      vin: form.vin || undefined,
      brand: form.brand || undefined,
      customerName: form.customerName || undefined,
      phone: form.phone || undefined,
      remark: form.remark || undefined,
      isAdjustment: isAdjustmentOrder.value || undefined,
      items: validItems.length > 0
        ? validItems.map((it) => {
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
          })
        : undefined,
    })
    // 记录新建工单，供“直接创建工单”模式上传图片使用
    createdOrderId.value = created?.id || ''
    createdOrderNo.value = created?.orderNo || ''
    // 新工单不在列表缓存中，标记列表过期（返回列表时静默刷新）
    sessionStorage.setItem('work-order-list-dirty', '1')
    showNotify({ type: 'success', message: '创建成功，可继续上传该工单图片' })
  }
  catch {
    showNotify({ type: 'danger', message: '创建失败' })
  }
  finally {
    submitting.value = false
  }
}

// 车辆主数据：按车牌号查询历史车辆并自动填充空字段（与 OCR 策略一致：仅填充空字段，不覆盖用户已填值）
async function lookupVehicle(plate: string) {
  const normalized = (plate || '').trim().toUpperCase()
  if (!normalized || !plateNumberRegex.test(normalized)) {
    vehicleFound.value = null
    vehicleMatchedFields.value = []
    return
  }
  // 已匹配到同一车牌则不重复查询
  if (vehicleFound.value?.plateNumber === normalized)
    return
  vehicleLookingUp.value = true
  try {
    const data = await fetchVehicleByPlate(normalized)
    if (data) {
      vehicleFound.value = data
      const fieldMap: Array<{ key: 'vin' | 'carModel' | 'brand' | 'customerName' | 'phone' | 'contactPerson', vehicleKey: 'vin' | 'carModel' | 'brand' | 'customerName' | 'phone' | 'contactPerson', label: string }> = [
        { key: 'vin', vehicleKey: 'vin', label: '车架号' },
        { key: 'carModel', vehicleKey: 'carModel', label: '车型' },
        { key: 'brand', vehicleKey: 'brand', label: '品牌' },
        { key: 'customerName', vehicleKey: 'customerName', label: '客户名称' },
        { key: 'phone', vehicleKey: 'phone', label: '电话' },
        { key: 'contactPerson', vehicleKey: 'contactPerson', label: '联系人' },
      ]
      const filled: string[] = []
      for (const { key, vehicleKey, label } of fieldMap) {
        const currentValue = ((form as any)[key] || '').trim()
        const vehicleValue = ((data as any)[vehicleKey] || '').trim()
        if (!currentValue && vehicleValue) {
          ;(form as any)[key] = vehicleValue
          filled.push(label)
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

function onPlateNumberBlur() {
  const plate = (form.plateNumber || '').trim().toUpperCase()
  if (!plate) {
    vehicleFound.value = null
    vehicleMatchedFields.value = []
    return
  }
  lookupVehicle(plate)
}

function onPlateNumberInput() {
  // 车牌号被修改时清除匹配状态（下次 blur 时重新查询）
  if (vehicleFound.value) {
    const currentPlate = (form.plateNumber || '').trim().toUpperCase()
    if (vehicleFound.value.plateNumber !== currentPlate) {
      vehicleFound.value = null
      vehicleMatchedFields.value = []
    }
  }
}

// 跳转车辆历史工单页
function goVehicleHistory() {
  if (!vehicleFound.value)
    return
  router.push({ name: '/work-order/vehicle-history', query: { id: vehicleFound.value.id, plate: vehicleFound.value.plateNumber } })
}

function handleTakePhoto() {
  if (!form.shopId) {
    showNotify({ type: 'warning', message: '请先选择门店' })
    return
  }
  if (!form.settlementMonth) {
    showNotify({ type: 'warning', message: '请先选择结算月份' })
    return
  }
  // 先选择上传模式（直接创建工单 / OCR 创建工单）
  showUploadModePicker.value = true
}

// 上传模式选择（van-action-sheet，选择后自动关闭并继续）
const uploadModeActions = [
  { name: '直接创建工单', subname: '每张图片上传成功后自动创建一个独立工单（一图一单），需先选门店和结算月份' },
  { name: 'OCR 创建工单', subname: '图片存入图片池，系统后台 OCR 识别后按门店/月份自动补建新工单' },
]

function onUploadModeSelect(action: { name: string }) {
  uploadMode.value = action.name === '直接创建工单' ? 'create' : 'ocr'
  onUploadModeConfirm()
}

// 选择上传模式后进入文件选择
async function onUploadModeConfirm() {
  showUploadModePicker.value = false
  if (uploadMode.value === 'create' && !createdOrderId.value) {
    // 直接创建工单：每张图片上传成功后会自动创建一个独立工单，前置仅需门店+结算月份。
    // 此处只做前置校验；建单在图片上传成功后进行（batchQuickCreate）。
    if (!form.shopId || !form.settlementMonth) {
      showNotify({ type: 'warning', message: '请先选择门店和结算月份，再使用「直接创建工单」上传图片' })
      return
    }
  }
  pickFilesAndUpload()
}

function pickFilesAndUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  // 不设置 capture，允许用户选择"拍照"或"从相册选择"
  input.multiple = true
  input.onchange = async (e: Event) => {
    const files = Array.from((e.target as HTMLInputElement).files || [])
    if (files.length === 0)
      return
    await batchQuickCreate(files)
  }
  input.click()
}

// 批量快速创建相关状态
const batchCreating = ref(false)
const batchProgress = ref({ current: 0, total: 0, success: 0, failed: 0 })
const batchResults = ref<Array<{ fileName: string, success: boolean, message: string }>>([])
const showBatchResult = ref(false)
// OCR 识别模式：basic 仅基础资料 / items 仅部位 / all 全部（用于单张图片手动智能识别）
const ocrMode = ref<'basic' | 'items' | 'all'>('basic')

async function batchQuickCreate(files: File[]) {
  batchCreating.value = true
  batchProgress.value = { current: 0, total: files.length, success: 0, failed: 0 }
  batchResults.value = []
  showLoadingToast({
    message: `上传中 0/${batchProgress.value.total}`,
    forbidClick: true,
    duration: 0,
  })

  // 串行上传（压缩 + 429/5xx 自动重试统一走 useImageUpload），避免并发压垮后端和触发限流
  for (const file of files) {
    batchProgress.value.current++

    // 每张图片独立处理。直接创建工单：先上传图片到图片池（成功即已安全落库），
    // 再立即为该图片补建独立工单并归档（一图一单）；补建失败图片仍在图片池可补建。
    let createdOrderNoForImage = ''
    let pendingCreateWarn = ''
    const doUpload = async (compressed: File, thumbnail: File) => {
      if (uploadMode.value !== 'create') {
        // OCR 创建工单：上传到图片池，后端 OCR 后自动按门店/结算月份 + OCR 资料补建工单
        return uploadPendingImage(compressed, form.shopId, form.settlementMonth || undefined, 'CREATE', thumbnail)
      }
      const pending: any = await uploadPendingImage(compressed, form.shopId, form.settlementMonth || undefined, 'CREATE', thumbnail)
      if (!pending?.id)
        return pending
      try {
        const order: any = await createOrderFromPending(pending.id, form.settlementMonth || undefined)
        createdOrderNoForImage = order?.orderNo || order?.order?.orderNo || ''
      }
      catch (e: any) {
        const msg: string = e?.message || ''
        // OCR 已自动归类（图片已有归属工单）：等同成功
        if (msg.includes('已归类'))
          return pending
        // 补建失败：图片已安全在图片池，不算上传失败，提示稍后在图片池补建
        createdOrderNoForImage = ''
        pendingCreateWarn = msg || '补建工单失败'
        return pending
      }
      return pending
    }
    const result = await uploadCompressed(file, doUpload)

    if (result.ok) {
      batchProgress.value.success++
      batchResults.value.push({
        fileName: file.name,
        success: true,
        message: uploadMode.value === 'create'
          ? (createdOrderNoForImage ? `已创建工单 ${createdOrderNoForImage}，图片已归档` : `图片已上传${pendingCreateWarn ? `（${pendingCreateWarn}，可稍后在图片池补建工单）` : ''}`)
          : '已加入图片池，OCR 后将自动建单',
      })
    }
    else {
      batchProgress.value.failed++
      const status = result.error?.response?.status || result.error?.statusCode
      // 401 未登录不重试，直接提示并跳登录
      if (status === 401) {
        showNotify({ type: 'danger', message: '登录已过期，请重新登录' })
        setTimeout(() => router.push({ name: 'Login' }), 1500)
      }
      batchResults.value.push({ fileName: file.name, success: false, message: describeUploadError(result.error) })
    }

    // 更新进度提示
    showLoadingToast({
      message: `上传中 ${batchProgress.value.current}/${batchProgress.value.total}`,
      forbidClick: true,
      duration: 0,
    })
  }

  closeToast()
  batchCreating.value = false
  showBatchResult.value = true
}

// 批量结果确认：OCR 模式有成功则前往图片池；直接创建模式图片已关联工单，留在当前页
function onBatchResultConfirm() {
  // 仅关闭结果弹窗，留在当前页（图片池/工单列表均可从菜单进入，不再自动跳转）
  showBatchResult.value = false
}

// 部位数量改变时，收敛超过部位数量的新件数量
function clampNewPart(index: number) {
  const item = form.items[index]
  if (!item)
    return
  if (item.newPartQuantity && item.newPartQuantity > (item.quantity || 0)) {
    item.newPartQuantity = item.quantity || 0
  }
}

// OCR 识别状态
const ocrLoading = ref(false)

// OCR 识别（仅识别填入表单，不创建工单）
function handleOcrRecognize() {
  if (!form.shopId) {
    showNotify({ type: 'warning', message: '请先选择门店' })
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  // 不设置 capture，允许用户选择"拍照"或"从相册选择"
  input.onchange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file)
      return
    ocrLoading.value = true
    try {
      const compressed = await compressImage(file)
      const result = await ocrRecognizeImage(compressed, form.shopId, ocrMode.value)

      // 基础字段填充统一走 applyOcrFields（仅填充空白字段，与详情页口径一致）
      const { filledMessages, orderNoCorrected, vinCorrected } = applyOcrFields(form, result)

      // 部位项目：用 OCR 识别到的部位填充（仅填充数量为0的部位）
      if (result.items && result.items.length > 0) {
        const matchedItems = result.items.filter(it => it.matched && it.categoryId)
        let filledItemCount = 0
        for (const ocrItem of matchedItems) {
          const formItem = form.items.find(fi => fi.categoryId === ocrItem.categoryId)
          if (formItem && (!formItem.quantity || formItem.quantity === 0)) {
            formItem.quantity = ocrItem.quantity
            formItem.newPartQuantity = ocrItem.newPartQuantity
            filledItemCount++
          }
        }
        if (filledItemCount > 0) {
          filledMessages.push(`部位(${filledItemCount})`)
        }
      }

      if (filledMessages.length > 0) {
        showNotify({ type: 'success', message: `已填充 ${filledMessages.join('、')}` })
      }

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
      if (form.plateNumber && form.plateNumber.trim()) {
        // 重置匹配状态，强制重新查询（OCR 可能更新了车牌）
        vehicleFound.value = null
        vehicleMatchedFields.value = []
        await lookupVehicle(form.plateNumber)
      }

      if (filledMessages.length === 0 && !orderNoCorrected) {
        showNotify({ type: 'warning', message: '未识别到有效信息或所有字段已填写' })
      }
    }
    catch {
      showNotify({ type: 'danger', message: 'OCR识别失败' })
    }
    finally {
      ocrLoading.value = false
    }
  }
  input.click()
}

onMounted(() => {
  isManual.value = (route.query.mode as string) === 'manual'
  const today = formatLocalDate(new Date())
  // 工单日期默认不填，可通过OCR识别填充
  form.settlementMonth = today.slice(0, 7)
  loadSpecialPaints()
  // 仅绑定 1 个门店时自动选中并加载其标准/工单号规则（沿用原 loadShops 副作用）
  ensureShops().then(async (list) => {
    if (list.length === 1 && !form.shopId) {
      form.shopId = list[0].id
      await loadStandards(form.shopId)
      loadOrderNoRules(form.shopId)
    }
  })
})
</script>

<template>
  <div class="create-page">
    <!-- 批量上传前的必要信息 -->
    <div v-if="!isManual" class="pre-fields">
      <van-cell title="门店" :value="shopName || '请选择门店'" is-link @click="showShopPicker = true" />
      <van-cell title="结算月份" :value="form.settlementMonth || '请选择结算月份'" is-link @click="showMonthPicker = true" />
    </div>

    <!-- 拍照建单入口 -->
    <div v-if="!isManual" class="photo-entry">
      <div class="photo-icon-wrap" @click="handleTakePhoto">
        <van-icon name="photograph" size="48" color="#fff" />
      </div>
      <div class="photo-text" @click="handleTakePhoto">
        批量上传工单图片
      </div>
      <div class="photo-hint" @click="handleTakePhoto">
        上传前请选择「直接创建工单」或「OCR 创建工单」
      </div>
      <!-- 上传模式选择 -->
      <div class="upload-mode" @click="handleTakePhoto">
        <span class="mode-label">上传模式</span>
        <span class="mode-value">{{ uploadMode === 'create' ? '直接创建工单' : 'OCR 创建工单' }}</span>
        <van-icon name="arrow" class="mode-arrow" />
      </div>
      <div v-if="uploadMode === 'create'" class="mode-tip">
        每张图片上传成功后会自动创建一个独立工单（一图一单），图片作为该工单的施工前照片；需先选择门店和结算月份
      </div>
      <div v-else class="mode-tip">
        图片存入图片池，系统后台 OCR 识别后按门店/月份自动补建工单
      </div>
    </div>

    <div class="divider-text" @click="isManual = true">
      <div class="divider-line" />
      <span class="divider-label">或手动填写</span>
      <div class="divider-line" />
    </div>

    <!-- 表单 -->
    <div class="form-section">
      <div class="ocr-btn-wrap">
        <van-button type="primary" size="small" plain icon="scan" :loading="ocrLoading" loading-text="识别中..." @click="handleOcrRecognize">
          OCR识别填充
        </van-button>
      </div>
      <van-cell title="门店" :value="shopName || '请选择门店'" is-link @click="showShopPicker = true" />
      <van-field v-model="form.orderNo" label="工单号" placeholder="请输入工单号" :error-message="orderNoError" @update:model-value="orderNoError = ''" />
      <van-cell title="工单日期" :value="form.orderDate || '请选择日期（可选）'" is-link @click="showDatePicker = true" />
      <van-cell title="结算月份" :value="form.settlementMonth || '请选择结算月份'" is-link @click="showMonthPicker = true" />
      <van-field
        v-model="form.plateNumber"
        label="车牌号"
        placeholder="请输入车牌号"
        :error-message="plateNumberError"
        :loading="vehicleLookingUp"
        @blur="onPlateNumberBlur"
        @update:model-value="() => { plateNumberError = ''; onPlateNumberInput(); }"
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
      <van-field v-model="form.carModel" label="车型" placeholder="请输入车型" />
      <van-field
        v-model="form.vin"
        label="车架号"
        placeholder="请输入车架号(VIN)"
        :error-message="vinError || ocrVinCorrectionMsg"
        @update:model-value="ocrVinCorrectionMsg = ''"
      />
      <van-notice-bar v-if="ocrVinCorrectionMsg" left-icon="warning-o" :text="ocrVinCorrectionMsg" background="var(--color-warning-bg)" color="var(--color-warning)" style="margin: 0 16px 8px;" />
      <van-field v-model="form.brand" label="品牌" placeholder="请输入品牌" />
      <van-field v-model="form.customerName" label="客户名称" placeholder="请输入客户名称" />
      <van-field v-model="form.phone" label="联系电话" placeholder="请输入电话" type="tel" :error-message="phoneError" @update:model-value="phoneError = ''" />
      <van-field v-model="form.remark" label="备注" type="textarea" placeholder="请输入备注" rows="2" />
    </div>

    <!-- 喷漆项目 -->
    <div v-if="standards.length" class="items-section">
      <div class="section-title">
        喷漆项目
        <span class="total-count">总幅数: {{ formatAutoPaintCount(totalPaintCount, form.items.some(i => i.specialPaintId)) }}</span>
      </div>
      <div v-if="isAdjustmentOrder" class="adjust-hint">
        <van-icon name="warning-o" size="12" />
        含负幅数，将作为「调整单」提交：只冲抵统计幅数，不计入工单数
      </div>

      <div v-for="(item, index) in form.items" :key="index" class="item-row">
        <div class="item-name">
          {{ standards[index]?.category?.name || standards[index]?.alias || `项目${index + 1}` }}
        </div>
        <div class="item-controls">
          <div class="control-group">
            <span class="control-label">数量</span>
            <van-stepper v-model="item.quantity" min="0" @change="clampNewPart(index)" />
          </div>
          <div v-if="Number(standards[index]?.newPartAddition) > 0" class="control-group">
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
              <span v-else class="paint-count-value" @click="item.overridePaintCount = Number(formatAutoPaintCount(getItemAutoPaintCount(index), Boolean(item.specialPaintId)))">
                {{ formatAutoPaintCount(getItemAutoPaintCount(index), Boolean(item.specialPaintId)) }}
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
    </div>

    <!-- 提交按钮 -->
    <div class="submit-bar">
      <van-button type="primary" round block :loading="submitting" loading-text="提交中..." @click="handleSubmit">
        提交工单
      </van-button>
    </div>

    <!-- 选择器 -->
    <ShopPicker
      v-model:show="showShopPicker"
      :model-value="form.shopId"
      :include-all="false"
      @confirm="onShopConfirm"
    />

    <PopupPicker
      v-model:show="showMonthPicker"
      :columns="monthColumns"
      :model-value="form.settlementMonth"
      title="选择结算月份"
      @confirm="(v: string) => { form.settlementMonth = v }"
    />

    <PopupPicker
      v-model:show="showDatePicker"
      :columns="dateColumns"
      :model-value="form.orderDate"
      title="选择工单日期"
      @confirm="onDateConfirm"
    />

    <!-- 特殊车漆选择器 -->
    <PopupPicker
      v-model:show="showSpecialPaintPicker"
      :columns="specialPaintOptions"
      title="特殊车漆"
      @confirm="onSpecialPaintConfirm"
    />

    <!-- 上传模式选择 -->
    <van-action-sheet
      v-model:show="showUploadModePicker"
      :actions="uploadModeActions"
      cancel-text="取消"
      description="选择上传方式"
      @select="onUploadModeSelect"
    />

    <!-- 批量上传结果弹窗 -->
    <van-dialog
      v-model:show="showBatchResult"
      :title="batchProgress.success > 0 ? (uploadMode === 'create' ? '已创建工单' : '已加入图片池') : '上传完成'"
      confirm-button-text="完成"
      :show-cancel-button="batchProgress.failed > 0"
      cancel-button-text="返回"
      @confirm="onBatchResultConfirm"
      @cancel="onBatchResultConfirm"
    >
      <div style="padding: 12px 16px; max-height: 400px; overflow-y: auto;">
        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
          <van-tag type="success" size="large">
            成功 {{ batchProgress.success }}
          </van-tag>
          <van-tag type="danger" size="large">
            失败 {{ batchProgress.failed }}
          </van-tag>
          <van-tag type="primary" size="large">
            共 {{ batchProgress.total }}
          </van-tag>
        </div>
        <div
          v-for="(item, index) in batchResults"
          :key="index"
          style="display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--neutral-100);"
        >
          <van-icon :name="item.success ? 'success' : 'cross'" :color="item.success ? 'var(--color-success)' : 'var(--color-error)'" />
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; color: var(--text-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              {{ item.fileName }}
            </div>
            <div style="font-size: 12px; color: var(--text-tertiary);">
              {{ item.message }}
            </div>
          </div>
        </div>
      </div>
    </van-dialog>
  </div>
</template>

<route lang="json5">
{
  name: 'WorkOrderCreate'
}
</route>

<style lang="less" scoped>
.create-page {
  min-height: 100vh;
  background: var(--color-bg);
  padding-bottom: 80px;
}

.pre-fields {
  margin: 12px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-surface);
}

.photo-entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 30px 0;
  background: var(--color-surface);
  margin: 12px 16px;
  border-radius: 10px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.photo-icon-wrap {
  width: 70px;
  height: 70px;
  background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #fff));
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  box-shadow: 0 4px 12px rgba(22, 119, 255, 0.3);
}

.photo-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-regular);
  margin-bottom: 4px;
}

.photo-hint {
  font-size: 13px;
  color: var(--text-tertiary);
}

.divider-text {
  display: flex;
  align-items: center;
  padding: 16px 30px;
  gap: 12px;
}

.divider-line {
  flex: 1;
  height: 1px;
  background: var(--neutral-200);
}

.divider-label {
  font-size: 13px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.form-section {
  margin: 0 16px;
  background: var(--color-surface);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.ocr-btn-wrap {
  padding: 10px 14px;
  border-bottom: 1px solid var(--neutral-100);
  display: flex;
  justify-content: flex-end;
}

.items-section {
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
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.total-count {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-primary);
}

.adjust-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-warning);
  background: var(--color-warning-bg);
}

.item-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--neutral-100);

  &:last-child {
    border-bottom: none;
  }
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-regular);
  margin-bottom: 8px;
}

.item-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  margin-top: 4px;

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

.control-group {
  display: flex;
  align-items: center;
  gap: 6px;
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

.special-paint-row {
  margin-top: 8px;

  :deep(.van-cell) {
    padding: 6px 0;
    font-size: 13px;
  }
}

.submit-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 16px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
  background: var(--color-surface);
  box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.06);

  :deep(.van-button) {
    height: 44px;
    font-size: 16px;
    font-weight: 600;
    background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #fff));
    border: none;
  }
}

// 上传模式选择入口
.upload-mode {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 24px 0;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 12px;

  .mode-label {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.85);
  }
  .mode-value {
    flex: 1;
    text-align: right;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }
  .mode-arrow {
    color: rgba(255, 255, 255, 0.85);
  }
}

.mode-tip {
  margin: 8px 24px 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.8);
}
</style>
