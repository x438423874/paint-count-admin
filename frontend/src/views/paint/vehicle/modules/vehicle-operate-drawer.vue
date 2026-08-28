<script setup lang="ts">
import { computed, reactive, watch, ref } from 'vue';
import { createPaintVehicle, updatePaintVehicle, fetchVehicleByPlate } from '@/service/api';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';
import { $t } from '@/locales';

defineOptions({
  name: 'VehicleOperateDrawer'
});

interface Props {
  operateType: NaiveUI.TableOperateType;
  rowData?: any | null;
}

const props = defineProps<Props>();

interface Emits {
  (e: 'submitted'): void;
}

const emit = defineEmits<Emits>();

const visible = defineModel<boolean>('visible', {
  default: false
});

const { formRef, validate, restoreValidation } = useNaiveForm();
const { defaultRequiredRule } = useFormRules();

const title = computed(() => {
  const titles: Record<NaiveUI.TableOperateType, string> = {
    add: '新增车辆',
    edit: '编辑车辆'
  };
  return titles[props.operateType];
});

interface FormModel {
  plateNumber: string;
  vin: string;
  carModel: string;
  brand: string;
  customerName: string;
  phone: string;
  contactPerson: string;
  remark: string;
  syncToOrders: boolean;
}

const model: FormModel = reactive(createDefaultModel());

// 复用工单表单的车牌正则：支持7位/8位/6位旧车牌
const PLATE_PROVINCE = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领军警海空北沈兰济南广成武翼';
const plateNumberRegex = new RegExp(`^([${PLATE_PROVINCE}][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]|[A-Z][A-HJ-NP-Z0-9]{5})$`);
const phoneRegex = /^1[3-9]\d{9}$/;
const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/;

type RuleKey = Extract<keyof FormModel, 'plateNumber'>;

const rules: Record<RuleKey, App.Global.FormRule> = {
  plateNumber: {
    required: true,
    validator: (_rule, value) => {
      if (!value || !value.trim()) return new Error('请输入车牌号');
      if (!plateNumberRegex.test(value.trim().toUpperCase())) {
        return new Error('车牌号格式不正确（普通7位/新能源8位/旧6位）');
      }
      return true;
    }
  }
};

const plateConflict = ref('');

function createDefaultModel(): FormModel {
  return {
    plateNumber: '',
    vin: '',
    carModel: '',
    brand: '',
    customerName: '',
    phone: '',
    contactPerson: '',
    remark: '',
    syncToOrders: false
  };
}

function handleInitModel() {
  Object.assign(model, createDefaultModel());
  plateConflict.value = '';
  if (props.operateType === 'edit' && props.rowData) {
    Object.assign(model, {
      plateNumber: props.rowData.plateNumber || '',
      vin: props.rowData.vin || '',
      carModel: props.rowData.carModel || '',
      brand: props.rowData.brand || '',
      customerName: props.rowData.customerName || '',
      phone: props.rowData.phone || '',
      contactPerson: props.rowData.contactPerson || '',
      remark: props.rowData.remark || ''
    });
  }
}

// 新增模式下：车牌号失焦查询是否已存在
async function onPlateNumberBlur() {
  plateConflict.value = '';
  if (props.operateType !== 'add') return;
  const plate = model.plateNumber.trim().toUpperCase();
  if (!plate || !plateNumberRegex.test(plate)) return;
  const { data, error } = await fetchVehicleByPlate(plate);
  if (!error && data) {
    plateConflict.value = `该车牌已存在（累计 ${data.totalOrderCount} 单），如需修改请前往列表编辑`;
  }
}

function closeDrawer() {
  visible.value = false;
}

async function handleSubmit() {
  await validate();
  if (plateConflict.value) {
    window.$message?.warning(plateConflict.value);
    return;
  }
  const payload = {
    plateNumber: model.plateNumber.trim().toUpperCase(),
    vin: model.vin.trim() || undefined,
    carModel: model.carModel.trim() || undefined,
    brand: model.brand.trim() || undefined,
    customerName: model.customerName.trim() || undefined,
    phone: model.phone.trim() || undefined,
    contactPerson: model.contactPerson.trim() || undefined,
    remark: model.remark.trim() || undefined,
    ...(props.operateType === 'edit' ? { syncToOrders: model.syncToOrders } : {})
  };
  if (props.operateType === 'add') {
    const { error } = await createPaintVehicle(payload);
    if (error) return;
    window.$message?.success($t('common.addSuccess'));
  } else {
    const { data, error } = await updatePaintVehicle({ id: props.rowData.id, ...payload });
    if (error) return;
    const synced = data?.syncedOrderCount;
    window.$message?.success(synced && synced > 0 ? `更新成功，已同步 ${synced} 张历史工单` : $t('common.updateSuccess'));
  }
  closeDrawer();
  emit('submitted');
}

watch(visible, () => {
  if (visible.value) {
    handleInitModel();
    restoreValidation();
  }
});
</script>

<template>
  <NDrawer v-model:show="visible" display-directive="show" :width="420">
    <NDrawerContent :title="title" :native-scrollbar="false" closable>
      <NForm ref="formRef" :model="model" :rules="rules" label-placement="left" :label-width="80">
        <NFormItem label="车牌号" path="plateNumber">
          <NInput
            v-model:value="model.plateNumber"
            placeholder="如：粤B12345"
            :status="plateConflict ? 'warning' : undefined"
            @blur="onPlateNumberBlur"
          />
        </NFormItem>
        <NAlert v-if="plateConflict" type="warning" :bordered="false" class="mb-12px">
          {{ plateConflict }}
        </NAlert>
        <NFormItem label="车架号">
          <NInput v-model:value="model.vin" placeholder="17位VIN（选填）" />
        </NFormItem>
        <NFormItem label="车型">
          <NInput v-model:value="model.carModel" placeholder="如：别克英朗" />
        </NFormItem>
        <NFormItem label="品牌">
          <NInput v-model:value="model.brand" placeholder="如：别克" />
        </NFormItem>
        <NFormItem label="客户名称">
          <NInput v-model:value="model.customerName" placeholder="客户名称" />
        </NFormItem>
        <NFormItem label="电话">
          <NInput v-model:value="model.phone" placeholder="联系电话" />
        </NFormItem>
        <NFormItem label="联系人">
          <NInput v-model:value="model.contactPerson" placeholder="联系人" />
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="model.remark" type="textarea" placeholder="备注" :rows="2" />
        </NFormItem>
        <NFormItem v-if="props.operateType === 'edit'" label=" " :show-feedback="false">
          <NCheckbox v-model:checked="model.syncToOrders">
            同步到该车所有历史工单（仅更新本次修改的车辆信息）
          </NCheckbox>
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace :size="16">
          <NButton @click="closeDrawer">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" @click="handleSubmit">{{ $t('common.confirm') }}</NButton>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
