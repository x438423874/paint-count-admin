<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { createPaintCategory, updatePaintCategory } from '@/service/api';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';

defineOptions({
  name: 'CategoryOperateDrawer'
});

interface Props {
  operateType: 'add' | 'edit';
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

const title = computed(() => {
  return props.operateType === 'add' ? '新增部位' : '编辑部位';
});

interface FormModel {
  name: string;
  code: string;
  sortOrder: number;
  isSpecial: boolean;
}

const model: FormModel = reactive(createDefaultModel());

function createDefaultModel(): FormModel {
  return {
    name: '',
    code: '',
    sortOrder: 0,
    isSpecial: false
  };
}

function handleInitModel() {
  Object.assign(model, createDefaultModel());

  if (props.operateType === 'edit' && props.rowData) {
    Object.assign(model, {
      name: props.rowData.name || '',
      code: props.rowData.code || '',
      sortOrder: props.rowData.sortOrder ?? 0,
      isSpecial: props.rowData.isSpecial ?? false
    });
  }
}

function closeDrawer() {
  visible.value = false;
}

async function handleSubmit() {
  await validate();

  const submitData = {
    name: model.name,
    code: model.code,
    sortOrder: model.sortOrder,
    isSpecial: model.isSpecial
  };

  if (props.operateType === 'add') {
    const { error } = await createPaintCategory(submitData);
    if (error) return;
    window.$message?.success('创建成功');
  } else {
    const { error } = await updatePaintCategory(props.rowData.id, submitData);
    if (error) return;
    window.$message?.success('更新成功');
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
  <NDrawer v-model:show="visible" display-directive="show" :width="460">
    <NDrawerContent :title="title" :native-scrollbar="false" closable>
      <NForm ref="formRef" :model="model" label-placement="left" :label-width="80">
        <NFormItem label="部位名称" path="name" :rule="{ required: true, message: '请输入部位名称' }">
          <NInput v-model:value="model.name" placeholder="如：前杠、后杠、机盖" />
        </NFormItem>
        <NFormItem label="编码" path="code" :rule="{ required: true, message: '请输入编码' }">
          <NInput v-model:value="model.code" placeholder="如：front-bumper" :disabled="operateType === 'edit'" />
        </NFormItem>
        <NFormItem label="排序">
          <NInputNumber v-model:value="model.sortOrder" :min="0" :step="1" style="width: 100%;" />
        </NFormItem>
        <NFormItem label="特殊部位">
          <NSwitch v-model:value="model.isSpecial" />
          <span class="ml-8px" style="color: var(--n-text-color-3); font-size: 12px;">标记为特殊部位（如特殊工艺项）</span>
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace :size="16">
          <NButton @click="closeDrawer">取消</NButton>
          <NButton type="primary" @click="handleSubmit">确认</NButton>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
