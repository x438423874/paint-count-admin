<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { NAlert, NButton, NCard, NForm, NFormItem, NGrid, NGridItem, NImage, NInput, NModal, NSpace } from 'naive-ui';
import { updateWorkOrder } from '@/service/api';
import { resolveUploadUrl } from '@/utils/upload-url';

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
  // 相对路径走受控下载（登录 + 门店权限）
  return resolveUploadUrl(url);
};

const imageSrc = computed(() => {
  if (!image.value?.url) return '';
  return getImageUrl(image.value.url);
});

watch(
  () => props.visible,
  visible => {
    if (!visible) {
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
      window.$message?.error(`工单更新失败：${updateError.message}`);
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
    style="width: 960px; max-width: 95vw"
    :segmented="{ content: true }"
    @update:show="(v: boolean) => emit('update:visible', v)"
  >
    <NAlert type="info" :show-icon="false" class="mb-16px">修正后的结果会同步更新到工单。</NAlert>

    <div class="ocr-layout">
      <!-- 左侧：图片（点击打开全屏预览，缩放在预览层完成，不撑占弹窗布局） -->
      <div class="ocr-image-section">
        <div class="section-title">工单图片</div>
        <div v-if="imageSrc" class="image-section">
          <NImage :src="imageSrc" :preview-src="imageSrc" object-fit="contain" class="ocr-image-thumb" />
          <div class="image-hint">点击图片可放大查看（预览层支持缩放/旋转）</div>
        </div>
        <NAlert v-else type="warning" :show-icon="false">该工单没有图片，无法保存标注。</NAlert>
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

    <div class="mt-16px flex justify-end gap-12px">
      <NButton @click="emit('update:visible', false)">取消</NButton>
      <NButton type="primary" :loading="loading" @click="handleSave">保存修正</NButton>
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
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ocr-image-thumb {
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
  cursor: zoom-in;
  border-radius: 4px;
}
.image-hint {
  font-size: 12px;
  color: #999;
  text-align: center;
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
