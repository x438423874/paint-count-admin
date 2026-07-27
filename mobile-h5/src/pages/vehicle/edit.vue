<script setup lang="ts">
import {
  createPaintVehicle,
  updatePaintVehicle,
  deletePaintVehicle,
  fetchVehicleById,
  fetchVehicleByPlate,
} from '@/api/paint'
import type { PaintVehicle } from '@/api/types/paint'
import { canEdit } from '@/utils/permission'
import { showDialog, showNotify } from 'vant'

const route = useRoute()
const router = useRouter()

const allowEdit = canEdit()
const mode = computed(() => route.query.mode === 'edit' ? 'edit' : 'add')
const vehicleId = computed(() => (route.query.id as string) || '')
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const vehicleData = ref<PaintVehicle | null>(null)

// 校验正则
const PLATE_PROVINCE = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领军警海空北沈兰济南广成武翼'
const plateNumberRegex = new RegExp(`^([${PLATE_PROVINCE}][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]|[A-Z][A-HJ-NP-Z0-9]{5})$`)
const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/
const phoneRegex = /^1[3-9]\d{9}$/

const form = reactive({
  plateNumber: '',
  vin: '',
  carModel: '',
  brand: '',
  customerName: '',
  phone: '',
  contactPerson: '',
  remark: '',
})

const plateError = ref('')
const vinError = ref('')
const phoneError = ref('')
const plateConflict = ref('')

// 加载车辆数据（编辑模式）
async function loadVehicle() {
  if (mode.value !== 'edit' || !vehicleId.value) return
  loading.value = true
  try {
    const data = await fetchVehicleById(vehicleId.value)
    vehicleData.value = data as any as PaintVehicle
    if (vehicleData.value) {
      form.plateNumber = vehicleData.value.plateNumber || ''
      form.vin = vehicleData.value.vin || ''
      form.carModel = vehicleData.value.carModel || ''
      form.brand = vehicleData.value.brand || ''
      form.customerName = vehicleData.value.customerName || ''
      form.phone = vehicleData.value.phone || ''
      form.contactPerson = vehicleData.value.contactPerson || ''
      form.remark = vehicleData.value.remark || ''
    }
  }
  catch {
    showNotify({ type: 'danger', message: '加载车辆信息失败' })
  }
  finally {
    loading.value = false
  }
}

// 车牌号校验
function validatePlateNumber(): boolean {
  plateError.value = ''
  const plate = form.plateNumber.trim().toUpperCase()
  if (!plate) {
    plateError.value = '请输入车牌号'
    return false
  }
  if (!plateNumberRegex.test(plate)) {
    plateError.value = '车牌号格式不正确（普通7位/新能源8位/旧6位）'
    return false
  }
  return true
}

// VIN 校验
function validateVin(): boolean {
  vinError.value = ''
  if (!form.vin.trim()) return true
  if (!vinRegex.test(form.vin.trim().toUpperCase())) {
    vinError.value = 'VIN应为17位字母数字（不含I/O/Q）'
    return false
  }
  return true
}

// 手机号校验
function validatePhone(): boolean {
  phoneError.value = ''
  if (!form.phone.trim()) return true
  if (!phoneRegex.test(form.phone.trim())) {
    phoneError.value = '手机号格式不正确'
    return false
  }
  return true
}

// 新增模式下：车牌号失焦查询是否已存在
async function onPlateNumberBlur() {
  plateConflict.value = ''
  if (mode.value !== 'add') return
  const plate = form.plateNumber.trim().toUpperCase()
  if (!plate || !plateNumberRegex.test(plate)) return
  try {
    const data = await fetchVehicleByPlate(plate)
    if (data) {
      const v = data as any as PaintVehicle
      plateConflict.value = `该车牌已存在（累计 ${v.totalOrderCount} 单），如需修改请前往列表编辑`
    }
  }
  catch { /* ignore */ }
}

// 保存
async function handleSave() {
  const plateValid = validatePlateNumber()
  const vinValid = validateVin()
  const phoneValid = validatePhone()
  if (!plateValid || !vinValid || !phoneValid) return
  if (plateConflict.value) {
    showNotify({ type: 'warning', message: plateConflict.value })
    return
  }

  const payload = {
    plateNumber: form.plateNumber.trim().toUpperCase(),
    vin: form.vin.trim() || undefined,
    carModel: form.carModel.trim() || undefined,
    brand: form.brand.trim() || undefined,
    customerName: form.customerName.trim() || undefined,
    phone: form.phone.trim() || undefined,
    contactPerson: form.contactPerson.trim() || undefined,
    remark: form.remark.trim() || undefined,
  }

  saving.value = true
  try {
    if (mode.value === 'add') {
      await createPaintVehicle(payload)
      showNotify({ type: 'success', message: '新增成功' })
    }
    else {
      await updatePaintVehicle({ id: vehicleId.value, ...payload })
      showNotify({ type: 'success', message: '保存成功' })
    }
    sessionStorage.setItem('vehicle-list-need-refresh', '1')
    router.back()
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '保存失败' })
  }
  finally {
    saving.value = false
  }
}

// 删除
async function handleDelete() {
  try {
    await showDialog({
      title: '确认删除',
      message: '删除车辆不会删除关联工单，仅解除关联。确认删除？',
    })
    deleting.value = true
    await deletePaintVehicle(vehicleId.value)
    showNotify({ type: 'success', message: '删除成功' })
    sessionStorage.setItem('vehicle-list-need-refresh', '1')
    router.back()
  }
  catch {
    // 用户取消或删除失败
  }
  finally {
    deleting.value = false
  }
}

// 跳转历史工单
function goHistory() {
  if (!vehicleId.value) return
  router.push({
    name: '/work-order/vehicle-history',
    query: { id: vehicleId.value, plate: form.plateNumber },
  })
}

onMounted(() => {
  loadVehicle()
})
</script>

<template>
  <div class="vehicle-edit-page">
    <van-nav-bar
      :title="mode === 'add' ? '新增车辆' : '编辑车辆'"
      left-arrow
      @click-left="router.back()"
    >
      <template v-if="mode === 'edit' && vehicleId" #right>
        <van-icon name="orders-o" size="20" color="#1677ff" @click="goHistory" />
      </template>
    </van-nav-bar>

    <div v-if="loading" class="loading-wrap">
      <van-loading size="24px">加载中...</van-loading>
    </div>

    <template v-else>
      <div class="form-section">
        <van-cell-group inset>
          <van-field
            v-model="form.plateNumber"
            label="车牌号"
            placeholder="如：粤B12345"
            required
            :error-message="plateError"
            @blur="onPlateNumberBlur"
          />
          <van-field
            v-model="form.vin"
            label="车架号"
            placeholder="17位VIN（选填）"
            :error-message="vinError"
          />
          <van-field
            v-model="form.carModel"
            label="车型"
            placeholder="如：别克英朗"
          />
          <van-field
            v-model="form.brand"
            label="品牌"
            placeholder="如：别克"
          />
          <van-field
            v-model="form.customerName"
            label="客户名称"
            placeholder="客户名称"
          />
          <van-field
            v-model="form.phone"
            label="电话"
            placeholder="联系电话"
            type="tel"
            :error-message="phoneError"
          />
          <van-field
            v-model="form.contactPerson"
            label="联系人"
            placeholder="联系人"
          />
          <van-field
            v-model="form.remark"
            label="备注"
            placeholder="备注"
            type="textarea"
            rows="2"
            autosize
          />
        </van-cell-group>
      </div>

      <!-- 车牌查重提示 -->
      <div v-if="plateConflict" class="conflict-tip">
        <van-notice-bar left-icon="warning-o" :text="plateConflict" wrapable />
      </div>

      <!-- 统计信息（编辑模式） -->
      <div v-if="mode === 'edit' && vehicleData" class="stats-section">
        <van-cell-group inset>
          <van-cell title="累计工单" :value="`${vehicleData.totalOrderCount} 单`" />
          <van-cell title="累计幅数" :value="`${Number(vehicleData.totalPaintCount).toFixed(1)} 幅`" />
          <van-cell title="最近进店" :value="vehicleData.lastOrderAt ? vehicleData.lastOrderAt.slice(0, 10) : '-'" />
          <van-cell title="最近门店" :value="vehicleData.lastShopName || '-'" />
        </van-cell-group>
      </div>
    </template>

    <!-- 底部操作栏 -->
    <div v-if="!loading" class="action-bar">
      <van-button
        v-if="mode === 'edit' && allowEdit"
        type="danger"
        round
        block
        :loading="deleting"
        @click="handleDelete"
      >
        删除车辆
      </van-button>
      <van-button
        type="primary"
        round
        block
        :loading="saving"
        @click="handleSave"
      >
        保存
      </van-button>
    </div>
  </div>
</template>

<route lang="json5">
{
  name: 'VehicleEdit',
  meta: {
    hideNavBar: true
  }
}
</route>

<style lang="less" scoped>
.vehicle-edit-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 100px;
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.form-section {
  margin-top: 12px;
}

.conflict-tip {
  margin: 0 16px;

  :deep(.van-notice-bar) {
    border-radius: 8px;
  }
}

.stats-section {
  margin-top: 12px;
}

.action-bar {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 100;
}
</style>
