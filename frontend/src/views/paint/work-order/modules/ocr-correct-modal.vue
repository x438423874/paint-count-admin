<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import { NModal, NCard, NForm, NFormItem, NInput, NButton, NSpace, NImage, NAlert, NGrid, NGridItem } from 'naive-ui';
import { updateWorkOrder } from '@/service/api';

interface Props {
  visible: boolean;
  order?: any | null;
}

const props = defineProps<Props>();

interface Emits {
  (e: 'update:visible', visible: boolean): void;
  (e: 'saved'): void;
}

const emit = defineEmits<Emits>();

const loading = ref(false);
const zoomLevel = ref(1);
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

function zoomIn() {
  zoomLevel.value = Math.min(zoomLevel.value + 0.25, MAX_ZOOM);
}

function zoomOut() {
  zoomLevel.value = Math.max(zoomLevel.value - 0.25, MIN_ZOOM);
}

function resetZoom() {
  zoomLevel.value = 1;
}

const form = reactive({
  orderNo: '',
  plateNumber: '',
  customerName: '',
  phone: '',
  carModel: '',
  vin: '',
  brand: '',
  date: ''
});

const image = computed(() => {
  if (!props.order?.images?.length) return null;
  return props.order.images[0];
});

/** 获取图片URL，处理代理前缀 */
const getImageUrl = (url: string) => {
  if (!url) return '';
  // 已经是完整URL则直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // 相对路径则添加代理前缀
  return `/proxy-demo${url}`;
};

const imageSrc = computed(() => {
  if (!image.value?.url) return '';
  return getImageUrl(image.value.url);
});

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      zoomLevel.value = 1;
      return;
    }
    if (props.order) {
      form.orderNo = props.order.orderNo || '';
      form.plateNumber = props.order.plateNumber || '';
      form.customerName = props.order.customerName || '';
      form.phone = props.order.phone || '';
      form.carModel = props.order.carModel || '';
      form.vin = props.order.vin || '';
      form.brand = props.order.brand || '';
      if (props.order.orderDate) {
        const d = new Date(props.order.orderDate);
        if (!isNaN(d.getTime())) {
          form.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } else {
          form.date = '';
        }
      } else {
        form.date = '';
      }
    }
  }
);

async function handleSave() {
  if (!props.order) return;

  loading.value = true;
  try {
    // 同步更新工单字段（修正结果会同步到工单）
    const { error: updateError } = await updateWorkOrder({
      id: props.order.id,
      orderNo: form.orderNo,
      plateNumber: form.plateNumber,
      customerName: form.customerName,
      phone: form.phone,
      carModel: form.carModel,
      vin: form.vin,
      brand: form.brand,
      orderDate: form.date || undefined
    });

    if (updateError) {
      window.$message?.error('工单更新失败：' + updateError.message);
      return;
    }

    window.$message?.success('OCR 修正已保存');
    emit('saved');
    emit('update:visible', false);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <NModal
    :show="visible"
    preset="card"
    title="修正 OCR 识别结果"
    style="width: 960px; max-width: 95vw;"
    :segmented="{ content: true }"
    @update:show="(v: boolean) => emit('update:visible', v)"
  >
    <NAlert type="info" :show-icon="false" class="mb-16px">
      修正后的结果会同步更新到工单。
    </NAlert>

    <div class="ocr-layout">
      <!-- 左侧：图片 -->
      <div class="ocr-image-section">
        <div class="section-title">工单图片</div>
        <div v-if="imageSrc" class="image-section">
          <div class="image-toolbar">
            <NButton size="small" @click="zoomOut">- 缩小</NButton>
            <span class="zoom-text">{{ Math.round(zoomLevel * 100) }}%</span>
            <NButton size="small" @click="zoomIn">+ 放大</NButton>
            <NButton size="small" @click="resetZoom">还原</NButton>
          </div>
          <div class="image-wrap">
            <img
              :src="imageSrc"
              :alt="'工单图片'"
              class="zoomable-image"
              :style="{ transform: `scale(${zoomLevel})` }"
            />
          </div>
        </div>
        <NAlert v-else type="warning" :show-icon="false">
          该工单没有图片，无法保存标注。
        </NAlert>
      </div>

      <!-- 右侧：基础信息 -->
      <div class="ocr-form-section">
        <div class="section-title">基础信息</div>
        <NForm label-placement="left" label-width="80">
          <NFormItem label="工单号">
            <NInput v-model:value="form.orderNo" placeholder="请输入工单号" />
          </NFormItem>
          <NFormItem label="车牌号">
            <NInput v-model:value="form.plateNumber" placeholder="请输入车牌号" />
          </NFormItem>
          <NFormItem label="客户名称">
            <NInput v-model:value="form.customerName" placeholder="请输入客户名称" />
          </NFormItem>
          <NFormItem label="电话">
            <NInput v-model:value="form.phone" placeholder="请输入电话" />
          </NFormItem>
          <NFormItem label="车型">
            <NInput v-model:value="form.carModel" placeholder="请输入车型" />
          </NFormItem>
          <NFormItem label="车架号">
            <NInput v-model:value="form.vin" placeholder="请输入车架号(VIN)" />
          </NFormItem>
          <NFormItem label="品牌">
            <NInput v-model:value="form.brand" placeholder="请输入品牌" />
          </NFormItem>
          <NFormItem label="日期">
            <NInput v-model:value="form.date" placeholder="YYYY-MM-DD" />
          </NFormItem>
        </NForm>
      </div>
    </div>

    <div class="flex justify-end gap-12px mt-16px">
      <NButton @click="emit('update:visible', false)">取消</NButton>
      <NButton type="primary" :loading="loading" @click="handleSave">
        保存修正
      </NButton>
    </div>
  </NModal>
</template>

<style scoped>
.mb-16px {
  margin-bottom: 16px;
}
.mt-16px {
  margin-top: 16px;
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin-bottom: 12px;
}
.ocr-layout {
  display: flex;
  gap: 24px;
  min-height: 400px;
}
.ocr-image-section {
  flex: 1.2;
  min-width: 0;
}
.image-section {
  border: 1px solid var(--neutral-200);
  border-radius: 8px;
  background: var(--neutral-50);
  overflow: hidden;
}
.image-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--neutral-200);
  background: #fff;
}
.zoom-text {
  font-size: 13px;
  color: #666;
  min-width: 48px;
  text-align: center;
}
.image-wrap {
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
  max-height: 520px;
  overflow: auto;
}
.zoomable-image {
  max-width: 100%;
  max-height: 460px;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.2s ease;
  cursor: grab;
}
.ocr-form-section {
  flex: 1;
  min-width: 320px;
}
@media (max-width: 768px) {
  .ocr-layout {
    flex-direction: column;
  }
  .ocr-form-section {
    min-width: auto;
  }
}
</style>
