<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import { NModal, NCard, NForm, NFormItem, NInput, NButton, NSpace, NImage, NAlert, NGrid, NGridItem } from 'naive-ui';
import { saveOcrAnnotation, updateWorkOrder } from '@/service/api';

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
  date: ''
});

const image = computed(() => {
  if (!props.order?.images?.length) return null;
  return props.order.images[0];
});

watch(
  () => props.visible,
  (visible) => {
    if (visible && props.order) {
      form.orderNo = props.order.orderNo || '';
      form.plateNumber = props.order.plateNumber || '';
      form.customerName = props.order.customerName || '';
      form.phone = props.order.phone || '';
      form.carModel = props.order.carModel || '';
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
  if (!props.order || !image.value) return;

  loading.value = true;
  try {
    // 1. 保存 OCR 标注（ground truth）用于后续学习
    const { error: annotationError } = await saveOcrAnnotation({
      shopId: props.order.shopId,
      orderId: props.order.id,
      imageUrl: image.value.url,
      imageWidth: image.value.width || 0,
      imageHeight: image.value.height || 0,
      regions: {},
      groundTruth: {
        orderNo: form.orderNo,
        plateNumber: form.plateNumber,
        customerName: form.customerName,
        phone: form.phone,
        carModel: form.carModel,
        date: form.date
      },
      isVerified: true // 用户手动修正后视为已验证
    });

    if (annotationError) {
      window.$message?.error('保存标注失败：' + annotationError.message);
      return;
    }

    // 2. 同步更新工单字段
    const { error: updateError } = await updateWorkOrder({
      ...props.order,
      orderNo: form.orderNo,
      plateNumber: form.plateNumber,
      customerName: form.customerName,
      phone: form.phone,
      carModel: form.carModel,
      orderDate: form.date ? new Date(form.date).toISOString() : props.order.orderDate
    });

    if (updateError) {
      window.$message?.warning('标注已保存，但工单更新失败：' + updateError.message);
      return;
    }

    window.$message?.success('OCR 修正已保存，将用于后续识别学习');
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
    style="width: 720px; max-width: 95vw;"
    :segmented="{ content: true }"
    @update:show="(v: boolean) => emit('update:visible', v)"
  >
    <NSpace vertical size="large">
      <NAlert type="info" :show-icon="false">
        修正后的结果会保存为“正确样本”，系统后续会用这些样本自动纠正同门店的 OCR 识别错误。
      </NAlert>

      <div v-if="image" class="flex justify-center">
        <NImage
          :src="image.url"
          :alt="'工单图片'"
          width="320"
          object-fit="contain"
          class="rounded border"
        />
      </div>
      <NAlert v-else type="warning" :show-icon="false">
        该工单没有图片，无法保存标注。
      </NAlert>

      <NForm label-placement="left" label-width="80">
        <NGrid :cols="2" :x-gap="16">
          <NGridItem>
            <NFormItem label="工单号">
              <NInput v-model:value="form.orderNo" placeholder="请输入工单号" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="车牌号">
              <NInput v-model:value="form.plateNumber" placeholder="请输入车牌号" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="客户名称">
              <NInput v-model:value="form.customerName" placeholder="请输入客户名称" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="电话">
              <NInput v-model:value="form.phone" placeholder="请输入电话" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="车型">
              <NInput v-model:value="form.carModel" placeholder="请输入车型" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="日期">
              <NInput v-model:value="form.date" placeholder="YYYY-MM-DD" />
            </NFormItem>
          </NGridItem>
        </NGrid>
      </NForm>

      <div class="flex justify-end gap-12px">
        <NButton @click="emit('update:visible', false)">取消</NButton>
        <NButton type="primary" :loading="loading" :disabled="!image" @click="handleSave">
          保存修正
        </NButton>
      </div>
    </NSpace>
  </NModal>
</template>
