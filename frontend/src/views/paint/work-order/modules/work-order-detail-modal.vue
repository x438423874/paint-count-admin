<script setup lang="ts">
import { NModal, NScrollbar, NGrid, NGi, NDescriptions, NDescriptionsItem, NTag, NH3, NDataTable, NImage, NEmpty } from 'naive-ui';

const props = defineProps<{
  show: boolean;
  order: any;
}>();

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void;
}>();

const statusTypeMap: Record<string, string> = {
  DRAFT: 'default',
  PENDING: 'warning',
  AUDITED: 'success',
  SETTLED: 'info',
  ABNORMAL: 'error',
  COMPLETED: 'success'
};

const statusLabelMap: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  AUDITED: '已审核',
  SETTLED: '已结算',
  ABNORMAL: '异常',
  COMPLETED: '已完成'
};

function getStatusType(status?: string): string {
  return statusTypeMap[status || ''] || 'default';
}

function getStatusLabel(status?: string): string {
  return statusLabelMap[status || ''] || status || '-';
}

function getImageUrl(url: string) {
  if (!url || url.startsWith('http') || url.startsWith('blob:')) return url;
  return `/proxy-demo${url}`;
}

// 幅数显示格式：默认1位小数，实际值有2位小数时显示2位（与编辑页幅数规则一致）
function formatPaintCount(val?: number | string | null): string {
  const n = Number(val ?? 0);
  const decimals = String(n).split('.')[1]?.length ?? 0;
  return n.toFixed(Math.min(Math.max(decimals, 1), 2));
}
</script>

<template>
  <NModal :show="props.show" preset="card" :title="'工单详情 - ' + (props.order?.orderNo || '')" style="width: 90vw; max-width: 1200px; max-height: 90vh;" :mask-closable="false" @update:show="emit('update:show', $event)">
    <div v-if="props.order" class="detail-modal-body">
      <NScrollbar class="detail-info-panel">
        <NGrid :cols="2" :x-gap="16" class="mb-16px">
          <NGi>
            <NDescriptions label-placement="left" :column="1" bordered size="small">
              <NDescriptionsItem label="工单号">{{ props.order.orderNo }}</NDescriptionsItem>
              <NDescriptionsItem label="门店">{{ props.order.shop?.name }}</NDescriptionsItem>
              <NDescriptionsItem label="车牌号">{{ props.order.plateNumber }}</NDescriptionsItem>
              <NDescriptionsItem label="车型">{{ props.order.carModel }}</NDescriptionsItem>
            </NDescriptions>
          </NGi>
          <NGi>
            <NDescriptions label-placement="left" :column="1" bordered size="small">
              <NDescriptionsItem label="客户">{{ props.order.customerName }}</NDescriptionsItem>
              <NDescriptionsItem label="电话">{{ props.order.phone || '-' }}</NDescriptionsItem>
              <NDescriptionsItem label="日期">{{ props.order.orderDate ? new Date(props.order.orderDate).toLocaleDateString() : '-' }}</NDescriptionsItem>
              <NDescriptionsItem label="总幅数">
                <NTag type="success" size="large">{{ formatPaintCount(props.order.totalPaintCount) }} 幅</NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="状态">
                <NTag :type="getStatusType(props.order.status) as any">{{ getStatusLabel(props.order.status) }}</NTag>
              </NDescriptionsItem>
            </NDescriptions>
          </NGi>
        </NGrid>

        <NH3 prefix="bar" class="mb-8px">喷漆项目</NH3>
        <NDataTable
          :columns="[
            { key: 'categoryName', title: '项目名称', render: (row: any) => row.alias || row.category?.name || '-' },
            { key: 'quantity', title: '数量', width: 80, align: 'center' },
            { key: 'paintCount', title: '幅数', width: 100, align: 'center', render: (row: any) => formatPaintCount(row.paintCount) + ' 幅' },
            { key: 'specialPaint', title: '特殊车漆', width: 120, align: 'center', render: (row: any) => row.specialPaint ? row.specialPaint.name + ' x' + Number(row.specialPaintMultiplier).toFixed(1) : '-' },
            { key: 'isNewPart', title: '新件', width: 70, align: 'center', render: (row: any) => row.isNewPart ? '是' : '否' }
          ]"
          :data="props.order.items || []"
          size="small"
          :bordered="true"
          class="mb-16px"
        />
      </NScrollbar>

      <NScrollbar class="detail-image-panel">
        <div class="detail-image-panel-title">工单图片</div>
        <div v-if="props.order.images?.length" class="detail-image-list">
          <div v-for="img in props.order.images" :key="img.id" class="detail-image-card">
            <NImage
              :src="getImageUrl(img.url)"
              object-fit="cover"
              class="detail-image-card-img"
              show-toolbar
            />
            <NTag
              :type="img.imageType === 'BEFORE' ? 'warning' : img.imageType === 'DURING' ? 'info' : 'success'"
              size="small"
              round
              class="detail-image-type-tag"
            >
              {{ img.imageType === 'BEFORE' ? '施工前' : img.imageType === 'DURING' ? '施工中' : '完工后' }}
            </NTag>
          </div>
        </div>
        <NEmpty v-else description="暂无图片" />
      </NScrollbar>
    </div>
  </NModal>
</template>

<style scoped>
.detail-modal-body {
  display: flex;
  height: calc(90vh - 100px);
  gap: 16px;
  overflow: hidden;
}

.detail-info-panel {
  flex: 1;
  min-width: 0;
  padding-right: 8px;
}

.detail-image-panel {
  width: 480px;
  flex-shrink: 0;
  border-left: 1px solid var(--neutral-150);
  padding-left: 16px;
  padding-right: 8px;
}

.detail-image-panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 12px;
}

.detail-image-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-image-card {
  position: relative;
  border: 1px solid var(--neutral-150);
  border-radius: 6px;
  overflow: hidden;
  background: var(--neutral-50);
}

.detail-image-card-img {
  width: 100%;
  height: auto;
  min-height: 120px;
  display: block;
  object-fit: contain;
  background: var(--neutral-100);
}

.detail-image-type-tag {
  position: absolute;
  top: 6px;
  left: 6px;
}

@media (max-width: 992px) {
  .detail-modal-body {
    flex-direction: column;
    height: auto;
    max-height: calc(90vh - 100px);
  }

  .detail-image-panel {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--neutral-150);
    padding-left: 0;
    padding-top: 16px;
    max-height: 40vh;
  }

  .detail-info-panel {
    max-height: none;
  }
}
</style>
