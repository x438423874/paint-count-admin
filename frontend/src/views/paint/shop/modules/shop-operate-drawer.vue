<script setup lang="ts">
import { computed, reactive, watch, ref } from 'vue';
import { createPaintShop, updatePaintShop, fetchStandardTemplateList } from '@/service/api';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';
import { $t } from '@/locales';

defineOptions({
  name: 'ShopOperateDrawer'
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
    add: '新增门店',
    edit: '编辑门店'
  };
  return titles[props.operateType];
});

interface FormModel {
  name: string;
  code: string;
  brand: string;
  address: string;
  phone: string;
  standardTemplateId: string;
}

const model: FormModel = reactive(createDefaultModel());

const templates = ref<{ id: string; name: string; version: string }[]>([]);

async function loadTemplates() {
  const { data, error } = await fetchStandardTemplateList();
  if (!error && data) {
    templates.value = data.map((t: any) => ({ id: t.id, name: t.name, version: t.version || '' }));
  }
}
loadTemplates();

function createDefaultModel(): FormModel {
  return {
    name: '',
    code: '',
    brand: '',
    address: '',
    phone: '',
    standardTemplateId: ''
  };
}

type RuleKey = Extract<keyof FormModel, 'name' | 'code' | 'brand'>;

const rules: Record<RuleKey, App.Global.FormRule> = {
  name: defaultRequiredRule,
  code: defaultRequiredRule,
  brand: defaultRequiredRule
};

function handleInitModel() {
  Object.assign(model, createDefaultModel());
  if (props.operateType === 'edit' && props.rowData) {
    Object.assign(model, {
      name: props.rowData.name || '',
      code: props.rowData.code || '',
      brand: props.rowData.brand || '',
      address: props.rowData.address || '',
      phone: props.rowData.phone || '',
      standardTemplateId: props.rowData.standardTemplateId || ''
    });
  }
}

function closeDrawer() {
  visible.value = false;
}

async function handleSubmit() {
  await validate();
  if (props.operateType === 'add') {
    const { error } = await createPaintShop(model);
    if (error) return;
    window.$message?.success($t('common.addSuccess'));
  } else {
    const { error } = await updatePaintShop({ id: props.rowData.id, ...model });
    if (error) return;
    window.$message?.success($t('common.updateSuccess'));
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
  <NDrawer v-model:show="visible" display-directive="show" :width="400">
    <NDrawerContent :title="title" :native-scrollbar="false" closable>
      <NForm ref="formRef" :model="model" :rules="rules" label-placement="left" :label-width="80">
        <NFormItem label="门店名称" path="name">
          <NInput v-model:value="model.name" placeholder="如：佛山瑞华别克雪佛兰" />
        </NFormItem>
        <NFormItem label="门店编码" path="code">
          <NInput v-model:value="model.code" placeholder="如：fs-ruihua" :disabled="operateType === 'edit'" />
        </NFormItem>
        <NFormItem label="品牌" path="brand">
          <NInput v-model:value="model.brand" placeholder="如：别克/雪佛兰" />
        </NFormItem>
        <NFormItem label="地址">
          <NInput v-model:value="model.address" placeholder="门店地址" />
        </NFormItem>
        <NFormItem label="电话">
          <NInput v-model:value="model.phone" placeholder="联系电话" />
        </NFormItem>
        <NFormItem label="标准模板">
          <NSelect
            v-model:value="model.standardTemplateId"
            :options="templates.map(t => ({ label: t.version ? `${t.name} (v${t.version})` : t.name, value: t.id }))"
            placeholder="选择关联的标准模板"
            clearable
          />
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
