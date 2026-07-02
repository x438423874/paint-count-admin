<script setup lang="ts">
import { ref, watch, reactive } from 'vue';
import { getDefaultFieldLabels, getShopFieldLabels, saveShopFieldLabels } from '@/service/api';

defineOptions({
  name: 'OcrFieldLabelsEditor'
});

interface Props {
  shopId: string;
  shopName: string;
}

const props = defineProps<Props>();

const visible = defineModel<boolean>('visible', {
  default: false
});

const loading = ref(false);
const saving = ref(false);

// 字段中文名映射
const fieldLabels: Record<string, string> = {
  orderNo: '工单号',
  plateNumber: '车牌号',
  customerName: '客户名称',
  phone: '联系电话',
  carModel: '车型',
  date: '日期'
};

// 字段顺序
const fieldOrder = ['orderNo', 'plateNumber', 'customerName', 'phone', 'carModel', 'date'];

// 各字段的标签列表（响应式）
const labelsMap = reactive<Record<string, string[]>>({});

// 新标签输入
const newLabels = reactive<Record<string, string>>({});

function createEmptyLabels() {
  const empty: Record<string, string[]> = {};
  for (const key of fieldOrder) {
    empty[key] = [];
  }
  return empty;
}

async function loadConfig() {
  if (!props.shopId) return;
  loading.value = true;
  try {
    const { data, error } = await getShopFieldLabels(props.shopId);
    if (!error && data) {
      for (const key of fieldOrder) {
        labelsMap[key] = data[key] ? [...data[key]] : [];
        newLabels[key] = '';
      }
    }
  } finally {
    loading.value = false;
  }
}

// 重置为默认配置
async function resetToDefault() {
  const { data, error } = await getDefaultFieldLabels();
  if (!error && data) {
    for (const key of fieldOrder) {
      labelsMap[key] = data[key] ? [...data[key]] : [];
      newLabels[key] = '';
    }
    window.$message?.success('已重置为默认配置（需点击保存生效）');
  }
}

// 添加标签
function addLabel(key: string) {
  const value = (newLabels[key] || '').trim();
  if (!value) return;
  if (!labelsMap[key]) labelsMap[key] = [];
  if (labelsMap[key].includes(value)) {
    window.$message?.warning('该标签已存在');
    return;
  }
  labelsMap[key].push(value);
  newLabels[key] = '';
}

// 删除标签
function removeLabel(key: string, index: number) {
  labelsMap[key].splice(index, 1);
}

// 回车添加
function handleEnter(key: string) {
  addLabel(key);
}

// 保存配置
async function handleSave() {
  saving.value = true;
  try {
    const config: Record<string, string[]> = {};
    for (const key of fieldOrder) {
      config[key] = labelsMap[key] || [];
    }
    const { error } = await saveShopFieldLabels(props.shopId, config);
    if (!error) {
      window.$message?.success('保存成功');
      visible.value = false;
    }
  } finally {
    saving.value = false;
  }
}

watch(visible, (val) => {
  if (val) {
    Object.assign(labelsMap, createEmptyLabels());
    for (const key of fieldOrder) {
      newLabels[key] = '';
    }
    loadConfig();
  }
});
</script>

<template>
  <NModal
    v-model:show="visible"
    preset="card"
    :title="`OCR字段别名配置 - ${shopName}`"
    style="width: 640px"
    :mask-closable="false"
  >
    <NSpin :show="loading">
      <NAlert type="info" :bordered="false" class="mb-12px">
        配置工单图片中各字段对应的标签词（如日期字段可能叫"接车日期"、"送修日期"等）。OCR识别时会按这些标签词定位字段值。
      </NAlert>

      <div v-for="key in fieldOrder" :key="key" class="field-block">
        <div class="field-title">
          <span>{{ fieldLabels[key] }}</span>
          <NText depth="3" size="small">{{ labelsMap[key]?.length || 0 }} 个标签</NText>
        </div>
        <div class="tags-wrap">
          <NTag
            v-for="(label, index) in labelsMap[key]"
            :key="`${key}-${index}`"
            closable
            size="small"
            @close="removeLabel(key, index)"
          >
            {{ label }}
          </NTag>
          <NInput
            v-model:value="newLabels[key]"
            size="small"
            placeholder="输入标签词，回车添加"
            style="width: 160px"
            @keyup.enter="handleEnter(key)"
          />
          <NButton size="tiny" type="primary" ghost @click="addLabel(key)">添加</NButton>
        </div>
      </div>
    </NSpin>

    <template #footer>
      <NSpace justify="space-between">
        <NButton @click="resetToDefault" :disabled="loading">重置为默认</NButton>
        <NSpace>
          <NButton @click="visible = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="handleSave">保存</NButton>
        </NSpace>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.field-block {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid #e0e0e6;
  border-radius: 4px;
}

.field-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
  margin-bottom: 8px;
  font-size: 14px;
}

.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
</style>
