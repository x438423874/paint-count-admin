<script setup lang="ts">
import { computed, h } from 'vue';
import {
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NH3,
  NImage,
  NModal,
  NScrollbar,
  NTag
} from 'naive-ui';
import { PAINT_ORDER_STATUS_LABEL, PAINT_ORDER_STATUS_TAG_TYPE } from '@/constants/paint';
import { formatPaintCount } from '@/utils/paint-count';
import { resolveUploadUrl } from '@/utils/upload-url';

const props = defineProps<{
  show: boolean;
  order: any;
}>();

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void;
}>();

// 状态文案/颜色统一走 constants/paint（原映射 COMPLETED 与 VOID 未区分）
const statusTypeMap = PAINT_ORDER_STATUS_TAG_TYPE;
const statusLabelMap = PAINT_ORDER_STATUS_LABEL;

function getStatusType(status?: string): 'primary' | 'info' | 'success' | 'warning' | 'error' | 'default' {
  return statusTypeMap[status || ''] || 'default';
}

function getStatusLabel(status?: string): string {
  return statusLabelMap[status || ''] || status || '-';
}

function getImageUrl(url: string) {
  if (!url || url.startsWith('http') || url.startsWith('blob:')) return url;
  return resolveUploadUrl(url);
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return '-';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return String(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const items = computed(() => props.order?.items || []);
const images = computed(() => props.order?.images || []);

const columns = [
  {
    title: '部位',
    key: 'categoryName',
    render: (row: any) => row.category?.name || row.categoryId || '-'
  },
  {
    title: '数量',
    key: 'quantity',
    width: 70,
    align: 'center' as const
  },
  {
    title: '新件数量',
    key: 'newPartQuantity',
    width: 90,
    align: 'center' as const
  },
  {
    title: '幅数',
    key: 'paintCount',
    width: 90,
    align: 'center' as const,
    render: (row: any) => formatPaintCount(Number(row.paintCount))
  },
  {
    title: '特殊车漆',
    key: 'specialPaint',
    render: (row: any) =>
      row.specialPaint
        ? `${row.specialPaint.name} ×${row.specialPaint.multiplier}`
        : '-'
  },
  {
    title: '备注',
    key: 'remarks',
    render: (row: any) => row.remarks || '-'
  }
];
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    style="width: 760px; max-width: 94vw"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <template #header>
      <div class="detail-header">
        <span class="detail-title">工单详情</span>
        <NTag :type="getStatusType(order?.status)" size="small" round>
          {{ getStatusLabel(order?.status) }}
        </NTag>
      </div>
    </template>

    <NScrollbar style="max-height: 72vh" trigger="none">
      <template v-if="order">
        <NDescriptions :column="2" bordered size="small" label-placement="left">
          <NDescriptionsItem label="工单号">{{ order.orderNo || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="门店">{{ order.shop?.name || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="车牌">{{ order.plateNumber || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="车型">{{ order.carModel || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="VIN">{{ order.vin || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="客户">{{ order.customerName || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="电话">{{ order.phone || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="联系人">{{ order.contactPerson || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="工单日期">{{ formatDate(order.orderDate) }}</NDescriptionsItem>
          <NDescriptionsItem label="结算月份">{{ order.settlementMonth || '-' }}</NDescriptionsItem>
          <NDescriptionsItem label="总幅数">
            <NTag :type="Number(order.totalPaintCount) < 0 ? 'error' : 'info'" size="small" round>
              {{ formatPaintCount(Number(order.totalPaintCount)) }}
            </NTag>
          </NDescriptionsItem>
          <NDescriptionsItem label="返工">
            <NTag v-if="order.isRework" type="warning" size="small">是</NTag>
            <span v-else>-</span>
          </NDescriptionsItem>
          <NDescriptionsItem label="调整单">
            <NTag v-if="order.isAdjustment" type="error" size="small">是</NTag>
            <span v-else>-</span>
          </NDescriptionsItem>
          <NDescriptionsItem label="备注" :span="2">
            {{ order.remark || order.description || '-' }}
          </NDescriptionsItem>
        </NDescriptions>

        <NH3 class="section-title">喷漆项目（{{ items.length }}）</NH3>
        <NDataTable
          :columns="columns"
          :data="items"
          :bordered="false"
          size="small"
          :single-line="false"
        />

        <NH3 class="section-title">图片（{{ images.length }}）</NH3>
        <div v-if="images.length" class="image-grid">
          <NImage
            v-for="img in images"
            :key="img.id"
            :src="getImageUrl(img.url)"
            :width="100"
            :height="100"
            object-fit="cover"
            :preview-src="getImageUrl(img.url)"
            lazy
          />
        </div>
        <NEmpty v-else description="暂无图片" />
      </template>
      <NEmpty v-else description="未获取到工单数据" />
    </NScrollbar>
  </NModal>
</template>

<style scoped>
.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.detail-title {
  font-size: 16px;
  font-weight: 600;
}
.section-title {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
