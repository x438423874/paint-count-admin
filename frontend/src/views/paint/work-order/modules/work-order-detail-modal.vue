<script setup lang="ts">
import {
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NGi,
  NGrid,
  NH3,
  NImage,
  NModal,
  NScrollbar,
  NTag
} from 'naive-ui';
import { PAINT_ORDER_STATUS_LABEL, PAINT_ORDER_STATUS_TAG_TYPE } from '@/constants/paint';
import { formatPaintCount } from '@/utils/paint-count';

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
</script>
