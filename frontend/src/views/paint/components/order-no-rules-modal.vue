<script setup lang="ts">
import { ref, watch } from 'vue';
import { NAlert, NButton, NEmpty, NFormItem, NInput, NInputNumber, NModal, NSpace } from 'naive-ui';
import { type OrderNoRule, analyzeOrderNoRules, fetchOrderNoRules, saveOrderNoRules } from '@/service/api';

const props = defineProps<{
  show: boolean;
  shopId: string;
  shopName?: string;
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
}>();

const rules = ref<OrderNoRule[]>([]);
const editingRules = ref<OrderNoRule[]>([]);
const loading = ref(false);
const saving = ref(false);

watch(
  () => props.show,
  visible => {
    if (visible && props.shopId) loadRules();
  }
);

async function loadRules() {
  loading.value = true;
  const { data } = await fetchOrderNoRules(props.shopId);
  rules.value = data || [];
  editingRules.value = (data || []).map(r => ({ ...r }));
  loading.value = false;
}

async function handleAnalyze() {
  loading.value = true;
  const { data, error } = await analyzeOrderNoRules(props.shopId);
  loading.value = false;
  if (error) return;
  rules.value = data || [];
  editingRules.value = (data || []).map(r => ({ ...r }));
  window.$message?.success(`已根据已结算工单生成 ${data?.length || 0} 条工单号规则，请确认后保存`);
}

function addRule() {
  editingRules.value.push({ pattern: '', length: 0, description: '' });
}

function removeRule(index: number) {
  editingRules.value.splice(index, 1);
}

async function handleSave() {
  saving.value = true;
  const { error } = await saveOrderNoRules(
    props.shopId,
    editingRules.value.filter(r => r.pattern.trim())
  );
  saving.value = false;
  if (error) return;
  await loadRules();
  emit('update:show', false);
  window.$message?.success('工单号规则已保存');
}

function handleClose() {
  emit('update:show', false);
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`${shopName || '门店'} · 工单号规则`"
    style="width: 720px"
    :mask-closable="false"
    :segmented="{ content: true, footer: true }"
    @update:show="handleClose"
  >
    <NSpace vertical :size="12">
      <NAlert type="info" :bordered="false">
        规则用于校验和纠正 OCR 识别出的工单号。点击“自动更新”可基于已结算工单重新生成。
      </NAlert>
      <NSpin :show="loading">
        <NEmpty v-if="editingRules.length === 0" description="暂无规则，点击自动更新按钮生成" />
        <div v-for="(rule, index) in editingRules" :key="index" class="flex items-start gap-12px">
          <NFormItem label="正则" class="flex-1" :show-feedback="false">
            <NInput v-model:value="rule.pattern" placeholder="如 [A-Z0-9]{15}" />
          </NFormItem>
          <NFormItem label="长度" style="width: 90px" :show-feedback="false">
            <NInputNumber v-model:value="rule.length" :min="0" placeholder="长度" />
          </NFormItem>
          <NFormItem label="说明" class="flex-1" :show-feedback="false">
            <NInput v-model:value="rule.description" placeholder="规则说明" />
          </NFormItem>
          <NButton type="error" text style="margin-top: 28px" @click="removeRule(index)">删除</NButton>
        </div>
      </NSpin>
    </NSpace>
    <template #header-extra>
      <NButton size="small" :loading="loading" @click="handleAnalyze">自动更新</NButton>
    </template>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="handleClose">取消</NButton>
        <NButton @click="addRule">新增规则</NButton>
        <NButton type="primary" :loading="saving" @click="handleSave">保存</NButton>
      </NSpace>
    </template>
  </NModal>
</template>
