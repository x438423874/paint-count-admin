<script setup lang="tsx">
import { ref, computed } from 'vue';
import {
  NModal, NSpace, NButton, NUpload, NDataTable, NInput,
  NAlert, NTag, NSpin, NFormItem, NSelect, NImage, NEmpty, NText, NRadioGroup, NRadioButton
} from 'naive-ui';
import { batchOcrPreview, batchCreateWorkOrder, type BatchOcrPreviewItem, type BatchCreateItem, type OcrMode } from '@/service/api';

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const props = defineProps<{
  show: boolean;
  shopId: string;
  shopName?: string;
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'success'): void;
}>();

const fileList = ref<any[]>([]);
const previewItems = ref<BatchOcrPreviewItem[]>([]);
const fileMap = new Map<string, File>();
const loading = ref(false);
const creating = ref(false);
const step = ref<1 | 2>(1);
// OCR 识别模式：basic 仅基础资料（省 token）/ items 仅部位 / all 全部
const ocrMode = ref<OcrMode>('all');

const hasInvalid = computed(() => previewItems.value.some(i => !i.valid));
const validCount = computed(() => previewItems.value.filter(i => i.valid).length);

function handleFileChange(data: { fileList: any[] }) {
  fileList.value = data.fileList;
  fileList.value.forEach((f: any) => {
    if (f.file && !f.id) {
      f.id = generateId();
    }
    if (f.file) {
      fileMap.set(f.id, f.file);
    }
  });
}

async function handlePreview() {
  if (!props.shopId) {
    window.$message?.warning('请先选择门店');
    return;
  }
  const validFiles = fileList.value.filter((f: any) => f.file).map((f: any) => ({ id: f.id, file: f.file }));
  if (validFiles.length === 0) {
    window.$message?.warning('请至少选择一张图片');
    return;
  }

  loading.value = true;
  const formData = new FormData();
  formData.append('shopId', props.shopId);
  formData.append('ocrMode', ocrMode.value);
  validFiles.forEach(({ id, file }) => {
    formData.append(id, file);
  });

  const { data, error } = await batchOcrPreview(formData);
  loading.value = false;
  if (error) return;
  previewItems.value = data?.items || [];
  step.value = 2;
}

function handleBack() {
  step.value = 1;
  previewItems.value = [];
}

async function handleCreate() {
  if (previewItems.value.length === 0) return;
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const items: BatchCreateItem[] = previewItems.value.map(i => ({
    id: i.id,
    plateNumber: i.result.plateNumber || undefined,
    orderNo: i.result.orderNo || undefined,
    customerName: i.result.customerName || undefined,
    phone: i.result.phone || undefined,
    carModel: i.result.carModel || undefined,
    vin: i.result.vin || undefined,
    brand: i.result.brand || undefined,
    orderDate: i.result.date || undefined,
    settlementMonth: month,
    items: (i.result.items || [])
      .filter(it => it.matched && it.categoryId)
      .map(it => ({ categoryId: it.categoryId as string, quantity: it.quantity, newPartQuantity: it.newPartQuantity })),
  }));

  const files = new Map<string, File>();
  items.forEach(item => {
    const file = fileMap.get(item.id);
    if (file) files.set(item.id, file);
  });

  creating.value = true;
  const { data, error } = await batchCreateWorkOrder(props.shopId, items, files);
  creating.value = false;
  if (error) return;

  const created = data?.created?.length || 0;
  const failed = data?.errors?.length || 0;
  if (failed > 0) {
    window.$message?.warning(`成功创建 ${created} 条，失败 ${failed} 条`);
    console.warn('[batchCreate] errors', data?.errors);
  } else {
    window.$message?.success(`成功创建 ${created} 条工单`);
  }
  emit('success');
  handleClose();
}

function handleClose() {
  fileList.value = [];
  previewItems.value = [];
  fileMap.clear();
  step.value = 1;
  ocrMode.value = 'all';
  emit('update:show', false);
}

const columns = [
  { key: 'thumbnail', title: '图片', width: 120, render: (row: BatchOcrPreviewItem) => (
    row.thumbnail ? <NImage src={row.thumbnail} width={100} height={80} style="object-fit:cover" /> : <NEmpty description="无图" size="small" />
  )},
  { key: 'fileName', title: '文件名', width: 150, ellipsis: { tooltip: true } },
  { key: 'plateNumber', title: '车牌', width: 120, render: (row: BatchOcrPreviewItem, index: number) => (
    <NInput v-model:value={previewItems.value[index].result.plateNumber} size="small" placeholder="车牌" />
  )},
  { key: 'orderNo', title: '工单号', width: 160, render: (row: BatchOcrPreviewItem, index: number) => (
    <NInput v-model:value={previewItems.value[index].result.orderNo} size="small" placeholder="工单号" />
  )},
  { key: 'carModel', title: '车型', width: 140, render: (row: BatchOcrPreviewItem, index: number) => (
    <NInput v-model:value={previewItems.value[index].result.carModel} size="small" placeholder="车型" />
  )},
  { key: 'date', title: '日期', width: 120, render: (row: BatchOcrPreviewItem, index: number) => (
    <NInput v-model:value={previewItems.value[index].result.date} size="small" placeholder="日期" />
  )},
  { key: 'customerName', title: '客户', width: 100, render: (row: BatchOcrPreviewItem, index: number) => (
    <NInput v-model:value={previewItems.value[index].result.customerName} size="small" placeholder="客户" />
  )},
  { key: 'items', title: '部位', width: 220, render: (row: BatchOcrPreviewItem) => {
    const items = row.result.items || [];
    if (items.length === 0) {
      return <NText depth="3" style="font-size:12px">无</NText>;
    }
    return (
      <NSpace vertical size={2} style="padding:2px 0">
        {items.map((it, idx) => {
          const label = `${it.matchedName}×${it.quantity}${it.newPartQuantity > 0 ? `(+新${it.newPartQuantity})` : ''}`;
          return (
            <span key={idx} title={it.matched ? it.matchedName : `未匹配：${it.rawText}`}>
              <NTag
                size="tiny"
                type={it.matched ? 'success' : 'warning'}
                style={it.matched ? '' : 'color:#ee0a24'}
              >
                {it.matched ? label : `${it.rawText}→${label}`}
              </NTag>
            </span>
          );
        })}
      </NSpace>
    );
  }},
  { key: 'warnings', title: '校验', width: 200, render: (row: BatchOcrPreviewItem) => (
    <NSpace vertical size={2}>
      {row.warnings.map(w => <NTag type={row.valid ? 'warning' : 'error'} size="tiny">{w}</NTag>)}
      {row.warnings.length === 0 && <NTag type="success" size="tiny">通过</NTag>}
    </NSpace>
  )},
];
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`${shopName || '批量'} · OCR录入`"
    style="width: 1100px; max-height: 90vh"
    :mask-closable="false"
    @update:show="handleClose"
  >
    <NSpace vertical :size="16">
      <NAlert v-if="step === 1" type="info" :bordered="false">
        选择多张工单图片，系统自动识别工单号、车牌、车型等信息。识别完成后，有问题的行会标红提醒，确认无误后一键导入。
      </NAlert>

      <template v-if="step === 1">
        <NUpload
          multiple
          :default-upload="false"
          accept="image/*"
          list-type="image"
          :max="50"
          @change="handleFileChange"
        >
          <NButton>选择图片</NButton>
        </NUpload>

        <NFormItem label="识别模式">
          <NRadioGroup v-model:value="ocrMode">
            <NSpace>
              <NRadioButton value="all">全部识别</NRadioButton>
              <NRadioButton value="basic">仅基础资料</NRadioButton>
              <NRadioButton value="items">仅部位</NRadioButton>
            </NSpace>
          </NRadioGroup>
          <NText depth="3" style="margin-left:12px; font-size:12px">
            选择"仅基础资料"或"仅部位"可减少 token 消耗
          </NText>
        </NFormItem>

        <NSpace justify="end">
          <NButton @click="handleClose">取消</NButton>
          <NButton type="primary" :loading="loading" :disabled="fileList.length === 0" @click="handlePreview">
            开始识别（{{ fileList.length }}张）
          </NButton>
        </NSpace>
      </template>

      <template v-if="step === 2">
        <NAlert :type="hasInvalid ? 'warning' : 'success'" :bordered="false">
          共识别 {{ previewItems.length }} 条，{{ validCount }} 条通过校验，{{ previewItems.length - validCount }} 条需要复核。
        </NAlert>

        <NSpin :show="loading">
          <NDataTable
            :columns="columns"
            :data="previewItems"
            :max-height="500"
            size="small"
            bordered
          />
        </NSpin>

        <NSpace justify="end">
          <NButton @click="handleBack">返回重选</NButton>
          <NButton type="primary" :loading="creating" @click="handleCreate">
            确认导入
          </NButton>
        </NSpace>
      </template>
    </NSpace>
  </NModal>
</template>
