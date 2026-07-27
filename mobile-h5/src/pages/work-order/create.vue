<script setup lang="ts">
import { createWorkOrder, getShopList, getShopCategoriesWithStandard, quickCreateWorkOrder, ocrRecognizeImage, getSpecialPaintList, fetchOrderNoRules, fetchVehicleByPlate } from '@/api/paint'
import type { OrderNoRule } from '@/api/paint'
import type { PaintShop, PaintStandard, PaintSpecialPaint, PaintVehicle, CreateWorkOrderItemDto } from '@/api/types/paint'
import { compressImage } from '@/utils/image-compress'
import { analyzeOrderNoErrors } from '@/utils/order-no-rule'

const route = useRoute()
const router = useRouter()
const isManual = ref(false)
const shops = ref<PaintShop[]>([])
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

// 校验正则
// 车牌号正则：支持普通7位（省份+字母+5位）、新能源8位、旧6位（字母+5位字母数字）
// 省份含：31省市+使领+军警武警+军区(海空北沈兰济南广成武翼)
const PLATE_PROVINCE = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领军警海空北沈兰济南广成武翼'
const plateNumberRegex = new RegExp(`^([${PLATE_PROVINCE}][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]|[A-Z][A-HJ-NP-Z0-9]{5})$`)
const phoneRegex = /^1[3-9]\d{9}$/
const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/

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

const shopName = computed(() => {
  const shop = shops.value.find(s => s.id === form.shopId)
  return shop?.name || ''
})

const showShopPicker = ref(false)
const shopColumns = computed(() => shops.value.map(s => ({ text: s.name, value: s.id })))
const showDatePicker = ref(false)
const showMonthPicker = ref(false)

// 结算月份选择列：当前月份及往前12个月
const monthColumns = computed(() => {
  const list = []
  const now = new Date()
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    list.push({ text: value, value })
  }
  return list
})

function onMonthConfirm({ selectedValues }: any) {
  form.settlementMonth = selectedValues[0]
  showMonthPicker.value = false
}

const dateColumns = computed(() => {
  const list = []
  const now = new Date()
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const value = d.toISOString().slice(0, 10)
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    const label = `${value} 周${weekDay}`
    list.push({ text: label, value })
  }
  return list
})

function onShopConfirm({ selectedValues }: any) {
  form.shopId = selectedValues[0]
  showShopPicker.value = false
  if (selectedValues[0]) {
    loadStandards(selectedValues[0])
    loadOrderNoRules(selectedValues[0])
  }
}

function onDateConfirm({ selectedValues }: any) {
  form.orderDate = selectedValues[0]
  showDatePicker.value = false
  if (selectedValues[0] && selectedValues[0].length >= 7) {
    form.settlementMonth = selectedValues[0].slice(0, 7)
  }
}

async function loadShops() {
  try {
    const res = await getShopList()
    shops.value = res as any as PaintShop[]
    // 数据权限：若用户仅绑定 1 个门店，自动选中并加载该门店标准
    if (shops.value.length === 1 && !form.shopId) {
      form.shopId = shops.value[0].id
      await loadStandards(form.shopId)
      loadOrderNoRules(form.shopId)
    }
  }
  catch {
    shops.value = []
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

// 总幅数计算
const totalPaintCount = computed(() => {
  return form.items.reduce((sum, item) => {
    if (!item.quantity || item.quantity <= 0) return sum
    // 手动覆盖幅数
    if (item.overridePaintCount !== undefined && item.overridePaintCount !== null) {
      return sum + item.overridePaintCount
    }
    const std = standards.value.find(s => s.categoryId === item.categoryId)
    if (!std) return sum
    const coefficient = Number(std.coefficient) || 0
    const newPartAddition = Number(std.newPartAddition) || 0
    let specialMultiplier = 1
    if (item.specialPaintId) {
      const sp = specialPaints.value.find(s => s.id === item.specialPaintId)
      if (sp) specialMultiplier = Number(sp.multiplier) || 1
    }
    const paintCount = (item.quantity * coefficient + item.newPartQuantity * newPartAddition) * specialMultiplier
    return sum + paintCount
  }, 0)
})

/** 获取单个 item 的自动计算幅数 */
function getItemAutoPaintCount(index: number): number {
  const item = form.items[index]
  if (!item || !item.quantity || item.quantity <= 0) return 0
  const std = standards.value.find(s => s.categoryId === item.categoryId)
  if (!std) return 0
  const coefficient = Number(std.coefficient) || 0
  const newPartAddition = Number(std.newPartAddition) || 0
  let specialMultiplier = 1
  if (item.specialPaintId) {
    const sp = specialPaints.value.find(s => s.id === item.specialPaintId)
    if (sp) specialMultiplier = Number(sp.multiplier) || 1
  }
  return (item.quantity * coefficient + (item.newPartQuantity || 0) * newPartAddition) * specialMultiplier
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

function onSpecialPaintConfirm({ selectedValues }: any) {
  const value = selectedValues[0]
  if (editingSpecialPaintIndex.value >= 0 && form.items[editingSpecialPaintIndex.value]) {
    form.items[editingSpecialPaintIndex.value].specialPaintId = value || undefined
  }
  showSpecialPaintPicker.value = false
}

function getSpecialPaintName(specialPaintId?: string) {
  if (!specialPaintId) return '无'
  const sp = specialPaints.value.find(s => s.id === specialPaintId)
  return sp ? `${sp.name} x${sp.multiplier}` : '无'
}

async function handleSubmit() {
  if (!form.shopId) {
    showNotify({ type: 'warning', message: '请选择门店' })
    return
  }

  // 校验工单号规则
  if (form.orderNo && form.orderNo.trim() && orderNoRules.value.length > 0) {
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

  // 校验车牌号
  if (!form.plateNumber || !form.plateNumber.trim()) {
    plateNumberError.value = '请输入车牌号'
    return
  }
  if (!plateNumberRegex.test(form.plateNumber.trim().toUpperCase())) {
    plateNumberError.value = '车牌号格式不正确（普通车牌7位，新能源车牌8位）'
    return
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
  if (validItems.length === 0) {
    showNotify({ type: 'warning', message: '请至少添加一个喷漆项目' })
    return
  }

  submitting.value = true
  try {
    await createWorkOrder({
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
      items: validItems.map(it => {
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
    showNotify({ type: 'success', message: '创建成功' })
    setTimeout(() => router.back(), 1000)
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
  if (vehicleFound.value?.plateNumber === normalized) return
  vehicleLookingUp.value = true
  try {
    const data = await fetchVehicleByPlate(normalized)
    if (data) {
      vehicleFound.value = data
      const fieldMap: Array<{ key: 'vin' | 'carModel' | 'brand' | 'customerName' | 'phone' | 'contactPerson'; vehicleKey: 'vin' | 'carModel' | 'brand' | 'customerName' | 'phone' | 'contactPerson'; label: string }> = [
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
  if (!vehicleFound.value) return
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
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  // 不设置 capture，允许用户选择"拍照"或"从相册选择"
  input.multiple = true
  input.onchange = async (e: Event) => {
    const files = Array.from((e.target as HTMLInputElement).files || [])
    if (files.length === 0) return
    await batchQuickCreate(files)
  }
  input.click()
}

// 批量快速创建相关状态
const batchCreating = ref(false)
const batchProgress = ref({ current: 0, total: 0, success: 0, failed: 0 })
const batchResults = ref<Array<{ fileName: string; success: boolean; message: string }>>([])
const showBatchResult = ref(false)
// 是否启用 OCR 识别（关闭时仅创建带图片的空工单，速度更快）
const enableOcr = ref(true)
// OCR 识别模式：basic 仅基础资料 / items 仅部位 / all 全部
const ocrMode = ref<'basic' | 'items' | 'all'>('basic')
const ocrModeOptions = [
  { label: '仅基础资料', value: 'basic' },
  { label: '仅部位', value: 'items' },
  { label: '全部', value: 'all' },
]

/** 智能选择OCR模式：根据已填字段决定识别范围，节省token */
const smartOcrMode = computed<'basic' | 'items' | 'all'>(() => {
  const basicFields = [form.plateNumber, form.orderNo, form.customerName, form.phone, form.carModel, form.vin, form.brand, form.orderDate]
  const basicFilled = basicFields.some(v => v && String(v).trim())
  const itemsFilled = form.items.some(it => it.quantity && it.quantity > 0)

  if (basicFilled && itemsFilled) return 'all'
  if (basicFilled && !itemsFilled) return 'items'
  if (!basicFilled && itemsFilled) return 'basic'
  return 'all'
})

async function batchQuickCreate(files: File[]) {
  batchCreating.value = true
  batchProgress.value = { current: 0, total: files.length, success: 0, failed: 0 }
  batchResults.value = []
  showLoadingToast({
    message: `上传中 0/${batchProgress.value.total}`,
    forbidClick: true,
    duration: 0,
  })

  // 串行上传 + 失败重试，避免并发压垮后端和触发限流
  const MAX_RETRY = 2
  const RETRY_DELAY = 2000

  for (const file of files) {
    batchProgress.value.current++
    let lastErr: any = null
    let success = false

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const compressed = await compressImage(file)
        await quickCreateWorkOrder(compressed, form.shopId, form.settlementMonth || undefined, enableOcr.value, ocrMode.value)
        success = true
        lastErr = null
        break
      }
      catch (err: any) {
        lastErr = err
        // 429 限流或 5xx 服务端错误：等待后重试
        const status = err?.response?.status || err?.statusCode
        if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRY) {
          await new Promise(r => setTimeout(r, RETRY_DELAY))
          continue
        }
        // 401 未登录不重试，直接提示
        if (status === 401) {
          showNotify({ type: 'danger', message: '登录已过期，请重新登录' })
          setTimeout(() => router.push({ name: 'Login' }), 1500)
        }
        // 其他错误（如 400 参数错误）不重试
        break
      }
    }

    if (success) {
      batchProgress.value.success++
      batchResults.value.push({ fileName: file.name, success: true, message: '创建成功' })
    }
    else {
      batchProgress.value.failed++
      const status = lastErr?.response?.status || lastErr?.statusCode
      const responseMsg = lastErr?.response?.data?.message || lastErr?.response?.data?.error?.message || lastErr?.response?.data?.msg
      let msg = responseMsg || lastErr?.message || '创建失败'
      if (status === 429)
        msg = '请求过于频繁，已重试仍失败'
      else if (status === 401)
        msg = '登录已过期，请重新登录'
      else if (status >= 500)
        msg = `服务器错误(${status})`
      batchResults.value.push({ fileName: file.name, success: false, message: msg })
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

// 批量创建结果确认：全部成功则返回，有失败则留在当前页
function onBatchResultConfirm() {
  if (batchProgress.value.failed === 0 && batchProgress.value.success > 0) {
    setTimeout(() => router.back(), 200)
  }
  showBatchResult.value = false
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
    if (!file) return
    ocrLoading.value = true
    try {
      const compressed = await compressImage(file)
      const result = await ocrRecognizeImage(compressed, form.shopId, ocrMode.value)

      const fieldMap = [
        { key: 'plateNumber', label: '车牌号', ocrKey: 'plateNumber' },
        { key: 'orderNo', label: '工单号', ocrKey: 'orderNo' },
        { key: 'customerName', label: '客户名称', ocrKey: 'customerName' },
        { key: 'phone', label: '联系电话', ocrKey: 'phone' },
        { key: 'carModel', label: '车型', ocrKey: 'carModel' },
        { key: 'vin', label: '车架号', ocrKey: 'vin' },
        { key: 'brand', label: '品牌', ocrKey: 'brand' },
        { key: 'orderDate', label: '工单日期', ocrKey: 'date' },
      ]

      const filledMessages: string[] = []

      for (const { key, label, ocrKey } of fieldMap) {
        const ocrValue = ((result as any)[ocrKey] || '').trim()
        if (!ocrValue) continue

        const currentValue = ((form as any)[key] || '').trim()
        if (!currentValue) {
          ;(form as any)[key] = ocrValue
          filledMessages.push(`${label}：${ocrValue}`)
        }
        // 已填字段不再覆盖，跳过
      }

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
      const candidates = (result as any).orderNoCandidates || []
      const orderNoValid = (result as any).orderNoValid
      if (candidates.length > 0 && orderNoValid === false) {
        const correctedNo = (result as any).orderNo || ''
        showNotify({ type: 'warning', message: `工单号已自动修正为 ${correctedNo}` })
      }

      // VIN 车架号修正提示：OCR 识别的 VIN 含易混淆字符（O↔0、I↔1、Q↔0），后端已自动修正
      if ((result as any).vinCorrected && (result as any).vinOriginal) {
        ocrVinCorrectionMsg.value = `OCR识别车架号含易混淆字符，已自动修正：「${(result as any).vinOriginal}」→「${(result as any).vin}」`
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

      if (filledMessages.length === 0 && (candidates.length === 0 || orderNoValid !== false)) {
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
  const today = new Date().toISOString().slice(0, 10)
  // 工单日期默认不填，可通过OCR识别填充
  form.settlementMonth = today.slice(0, 7)
  loadShops()
  loadSpecialPaints()
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
        可拍照或从相册选择，每张图片创建一个工单
      </div>
      <div class="ocr-switch-row">
        <span class="ocr-switch-label">OCR自动识别</span>
        <van-switch v-model="enableOcr" size="20px" />
        <span class="ocr-switch-tip">{{ enableOcr ? '开启：自动识别并填充基础资料' : '关闭：仅创建带图片的空工单（更快）' }}</span>
      </div>
      <div v-if="enableOcr" class="ocr-mode-row">
        <span class="ocr-mode-label">识别模式</span>
        <van-radio-group v-model="ocrMode" direction="horizontal">
          <van-radio v-for="opt in ocrModeOptions" :key="opt.value" :name="opt.value">{{ opt.label }}</van-radio>
        </van-radio-group>
        <span class="ocr-mode-smart" @click="ocrMode = smartOcrMode">智能推荐</span>
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
        :text="`已匹配历史车辆${vehicleMatchedFields.length ? '，已填充：' + vehicleMatchedFields.join('、') : ''}（累计 ${vehicleFound.totalOrderCount} 单 / ${Number(vehicleFound.totalPaintCount).toFixed(1)} 幅）`"
        background="#e6f9e6"
        color="#07c160"
        style="margin: 0 16px 8px;"
      />
      <van-field v-model="form.carModel" label="车型" placeholder="请输入车型" />
      <van-field v-model="form.vin" label="车架号" placeholder="请输入车架号(VIN)" :error-message="vinError || ocrVinCorrectionMsg" @update:model-value="vinError = ''; ocrVinCorrectionMsg = ''" />
      <van-notice-bar v-if="ocrVinCorrectionMsg" left-icon="warning-o" :text="ocrVinCorrectionMsg" background="#fffbe8" color="#ed6a0c" style="margin: 0 16px 8px;" />
      <van-field v-model="form.brand" label="品牌" placeholder="请输入品牌" />
      <van-field v-model="form.customerName" label="客户名称" placeholder="请输入客户名称" />
      <van-field v-model="form.phone" label="联系电话" placeholder="请输入电话" type="tel" :error-message="phoneError" @update:model-value="phoneError = ''" />
      <van-field v-model="form.remark" label="备注" type="textarea" placeholder="请输入备注" rows="2" />
    </div>

    <!-- 喷漆项目 -->
    <div v-if="standards.length" class="items-section">
      <div class="section-title">
        喷漆项目
        <span class="total-count">总幅数: {{ totalPaintCount.toFixed(1) }}</span>
      </div>

      <div v-for="(item, index) in form.items" :key="index" class="item-row">
        <div class="item-name">
          {{ standards[index]?.category?.name || standards[index]?.alias || `项目${index + 1}` }}
        </div>
        <div class="item-controls">
          <div class="control-group">
            <span class="control-label">数量</span>
            <van-stepper v-model="item.quantity" min="0" />
          </div>
          <div v-if="Number(standards[index]?.newPartAddition) > 0" class="control-group">
            <span class="control-label">新件</span>
            <van-stepper v-model="item.newPartQuantity" min="0" />
          </div>
          <div class="control-group">
            <span class="control-label">幅数</span>
            <div class="paint-count-control">
              <van-stepper
                v-if="item.overridePaintCount !== undefined && item.overridePaintCount !== null"
                :model-value="item.overridePaintCount"
                min="0" max="99" step="0.1" decimal-length="1"
                input-width="48px"
                @update:model-value="(val: number) => { item.overridePaintCount = val }"
              />
              <span v-else class="paint-count-value" @click="item.overridePaintCount = getItemAutoPaintCount(index)">
                {{ getItemAutoPaintCount(index).toFixed(1) }}
              </span>
              <van-icon
                v-if="item.overridePaintCount !== undefined && item.overridePaintCount !== null"
                name="close"
                size="14"
                color="#ff4d4f"
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
      <van-button type="primary" block round :loading="submitting" loading-text="提交中..." @click="handleSubmit">
        提交工单
      </van-button>
    </div>

    <!-- 选择器 -->
    <van-popup v-model:show="showShopPicker" position="bottom" round>
      <van-picker
        :columns="shopColumns"
        @confirm="onShopConfirm"
        @cancel="showShopPicker = false"
      />
    </van-popup>

    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        @confirm="onMonthConfirm"
        @cancel="showMonthPicker = false"
      />
    </van-popup>

    <van-popup v-model:show="showDatePicker" position="bottom" round>
      <van-picker
        :columns="dateColumns"
        @confirm="onDateConfirm"
        @cancel="showDatePicker = false"
      />
    </van-popup>

    <!-- 特殊车漆选择器 -->
    <van-popup v-model:show="showSpecialPaintPicker" position="bottom" round>
      <van-picker
        :columns="specialPaintOptions"
        @confirm="onSpecialPaintConfirm"
        @cancel="showSpecialPaintPicker = false"
      />
    </van-popup>

    <!-- 批量创建结果弹窗 -->
    <van-dialog
      v-model:show="showBatchResult"
      title="批量创建结果"
      confirm-button-text="完成"
      :show-cancel-button="batchProgress.failed > 0"
      cancel-button-text="返回"
      @confirm="onBatchResultConfirm"
      @cancel="onBatchResultConfirm"
    >
      <div style="padding: 12px 16px; max-height: 400px; overflow-y: auto;">
        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
          <van-tag type="success" size="large">成功 {{ batchProgress.success }}</van-tag>
          <van-tag type="danger" size="large">失败 {{ batchProgress.failed }}</van-tag>
          <van-tag type="primary" size="large">共 {{ batchProgress.total }}</van-tag>
        </div>
        <div
          v-for="(item, index) in batchResults"
          :key="index"
          style="display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f5f5f5;"
        >
          <van-icon :name="item.success ? 'success' : 'cross'" :color="item.success ? '#07c160' : '#ee0a24'" />
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ item.fileName }}</div>
            <div style="font-size: 12px; color: #969799;">{{ item.message }}</div>
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
  background: #f7f8fa;
  padding-bottom: 80px;
}

.pre-fields {
  margin: 12px;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.photo-entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 30px 0;
  background: #fff;
  margin: 12px 16px;
  border-radius: 10px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.photo-icon-wrap {
  width: 70px;
  height: 70px;
  background: linear-gradient(135deg, #1677ff, #4096ff);
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
  color: #333;
  margin-bottom: 4px;
}

.photo-hint {
  font-size: 13px;
  color: #999;
}

.ocr-switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 16px;
  background: #f7f8fa;
  border-radius: 8px;
  width: 86%;
}

.ocr-switch-label {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
}

.ocr-switch-tip {
  font-size: 12px;
  color: #969799;
  flex: 1;
  line-height: 1.4;
}

.ocr-mode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 10px 16px;
  background: #f7f8fa;
  border-radius: 8px;
  width: 86%;
}

.ocr-mode-label {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
}

.ocr-mode-smart {
  font-size: 12px;
  color: #1989fa;
  cursor: pointer;
  white-space: nowrap;
  margin-left: auto;
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
  background: #e0e0e0;
}

.divider-label {
  font-size: 13px;
  color: #999;
  white-space: nowrap;
}

.form-section {
  margin: 0 16px;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 6px rgba(0,0,0,0.04);
}

.ocr-btn-wrap {
  padding: 10px 14px;
  border-bottom: 1px solid #f5f5f5;
  display: flex;
  justify-content: flex-end;
}

.items-section {
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
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.total-count {
  font-size: 13px;
  font-weight: 500;
  color: #1677ff;
}

.item-row {
  padding: 10px 0;
  border-bottom: 1px solid #f5f5f5;

  &:last-child { border-bottom: none; }
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 8px;
}

.item-controls {
  display: flex;
  gap: 20px;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.control-label {
  font-size: 12px;
  color: #999;
}

.paint-count-control {
  display: flex;
  align-items: center;
}

.paint-count-value {
  font-size: 13px;
  color: #333;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f7f8fa;
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
  background: #fff;
  box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.06);

  :deep(.van-button) {
    height: 44px;
    font-size: 16px;
    font-weight: 600;
    background: linear-gradient(135deg, #1677ff, #4096ff);
    border: none;
  }
}
</style>
