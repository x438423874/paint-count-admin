<script setup lang="ts">
import { useNaiveForm } from '@/hooks/common/form';
import { $t } from '@/locales';

defineOptions({
  name: 'OperationSearch'
});

interface Emits {
  (e: 'reset'): void;
  (e: 'search'): void;
}

const emit = defineEmits<Emits>();

const { formRef, validate, restoreValidation } = useNaiveForm();

const model = defineModel<Log.OperationLogSearchParams>('model', { required: true });

async function reset() {
  await restoreValidation();
  emit('reset');
}

async function search() {
  await validate();
  emit('search');
}
</script>

<template>
  <NCard :title="$t('common.search')" :bordered="false" size="small" class="card-wrapper">
    <NForm ref="formRef" :model="model" label-placement="left" :label-width="80">
      <NGrid responsive="screen" item-responsive>
        <NFormItemGi span="24 s:12 m:6" label="操作人" path="username" class="pr-24px">
          <NInput v-model:value="model.username" />
        </NFormItemGi>
        <NFormItemGi span="24 s:12 m:6" label="域" path="domain" class="pr-24px">
          <NInput v-model:value="model.domain" />
        </NFormItemGi>
        <NFormItemGi span="24 s:12 m:6" label="模块" path="moduleName" class="pr-24px">
          <NInput v-model:value="model.moduleName" />
        </NFormItemGi>
        <NFormItemGi span="24 s:12 m:6" label="请求方法" path="method" class="pr-24px">
          <NInput v-model:value="model.method" placeholder="POST / PUT / DELETE" />
        </NFormItemGi>
        <NFormItemGi span="24 m:12" class="pr-24px">
          <NSpace class="w-full" justify="end">
            <NButton @click="reset">
              <template #icon>
                <icon-ic-round-refresh class="text-icon" />
              </template>
              {{ $t('common.reset') }}
            </NButton>
            <NButton type="primary" ghost @click="search">
              <template #icon>
                <icon-ic-round-search class="text-icon" />
              </template>
              {{ $t('common.search') }}
            </NButton>
          </NSpace>
        </NFormItemGi>
      </NGrid>
    </NForm>
  </NCard>
</template>

<style scoped></style>
