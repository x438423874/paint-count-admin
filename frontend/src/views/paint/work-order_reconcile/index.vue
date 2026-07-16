<script setup lang="tsx">
import { ref, computed, reactive, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  NCard,
  NForm,
  NFormItem,
  NSelect,
  NButton,
  NUpload,
  NDataTable,
  NTag,
  NStatistic,
  NSpace,
  NTabs,
  NTabPane,
  NEmpty,
  NSpin,
  NModal,
  NInput,
  NDatePicker,
  NPopconfirm,
  NAlert,
  useMessage
} from 'naive-ui';
import {
  fetchPaintShopList,
  reconcileWorkOrderExcel,
  fetchWorkOrderById,
  settleWorkOrder,
  sealSettlementMonth,
  unsealSettlementMonth,
  getSealStatus,
  type ReconcileResult,
  type ReconcileItem,
  type PaintShopListItem
} from '@/service/api/paint';
import { canSettle } from '@/utils/permission';
import WorkOrderDetailModal from '../work-order/modules/work-order-detail-modal.vue';

const router = useRouter();
const message = useMessage();
const allowSettle = canSettle();

// 封单状态
const isSealed = ref(false);
const sealLoading = ref(false);

async function checkSealStatus() {
  if (!form.shopId || !form.settlementMonth) {
    isSealed.value = false;
    return;
  }
  try {
    const { data } = await getSealStatus(form.shopId, form.settlementMonth);
    isSealed.value = data?.isSealed || false;
  } catch {
    isSealed.value = false;
  }
}

async function handleSeal() {
  if (!form.shopId || !form.settlementMonth) return;
  sealLoading.value = true;
  try {
    await sealSettlementMonth(form.shopId, form.settlementMonth);
    isSealed.value = true;
    message.success('封单成功，该月工单已锁定');
  } catch (e: any) {
    message.error(e?.message || '封单失败');
  } finally {
    sealLoading.value = false;
  }
}

async function handleUnseal() {
  if (!form.shopId || !form.settlementMonth) return;
  sealLoading.value = true;
  try {
    await unsealSettlementMonth(form.shopId, form.settlementMonth);
    isSealed.value = false;
    message.success('解封成功');
  } catch (e: any) {
    message.error(e?.message || '解封失败');
  } finally {
    sealLoading.value = false;
  }
}

const shops = ref<PaintShopListItem[]>([]);
const loading = ref(false);
const result = ref<ReconcileResult | null>(null);
const form = reactive({
  shopId: '',
  settlementMonth: ''
});
const fileList = ref<any[]>([]);
const searchKeyword = ref('');
const statusFilter = ref('');

async function loadShops() {
  try {
    const res = await fetchPaintShopList();
    shops.value = res.data || [];
  } catch {
    shops.value = [];
  }
}

const shopOptions = computed(() => shops.value.map(s => ({ label: s.name, value: s.id })));

const monthOptions = computed(() => {
  const list = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    list.push({ label: value, value });
  }
  return list;
});

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '已审核', value: 'AUDITED' },
  { label: '已结算', value: 'SETTLED' },
  { label: '异常', value: 'ABNORMAL' },
  { label: '已完成', value: 'COMPLETED' }
];

async function handleReconcile() {
  if (!form.shopId) {
    message.warning('请选择门店');
    return;
  }
  if (!form.settlementMonth) {
    message.warning('请选择结算月份');
    return;
  }
  if (!fileList.value.length || !fileList.value[0].file) {
    message.warning('请上传 Excel 对账表');
    return;
  }

  loading.value = true;
  searchKeyword.value = '';
  statusFilter.value = '';
  try {
    const file = fileList.value[0].file;
    const res = await reconcileWorkOrderExcel(file, form.shopId, form.settlementMonth);
    result.value = res.data;
    message.success('对账完成');
  } catch (e: any) {
    message.error(e?.message || '对账失败');
  } finally {
    loading.value = false;
  }
}

function handleReset() {
  result.value = null;
  fileList.value = [];
  searchKeyword.value = '';
  statusFilter.value = '';
}

function goToDetailPage(orderNo: string) {
  router.push({ name: 'paint_work-order', query: { orderNo } });
}

const showDetail = ref(false);
const currentOrder = ref<any>(null);

async function viewOrderDetail(id: string) {
  const { data, error } = await fetchWorkOrderById(id);
  if (!error && data) {
    currentOrder.value = data;
    showDetail.value = true;
  }
}

function getStatusLabel(status?: string) {
  const map: Record<string, string> = {
    DRAFT: '草稿',
    PENDING: '待审核',
    AUDITED: '已审核',
    SETTLED: '已结算',
    ABNORMAL: '异常',
    COMPLETED: '已完成'
  };
  return map[status || ''] || status || '-';
}

const settleLoading = ref(false);

async function openSettle(row: ReconcileItem) {
  if (!row.id) {
    message.warning('Excel-only 行无法在系统内结算');
    return;
  }
  if (isSealed.value) {
    message.warning('已封单月份不允许结算');
    return;
  }
  if (row.status === 'SETTLED' || row.status === 'COMPLETED') {
    message.warning('该工单已结算，无需重复结算');
    return;
  }
  if (row.status !== 'AUDITED' && row.status !== 'ABNORMAL') {
    message.warning('只有已审核或异常工单才能结算');
    return;
  }
  settleLoading.value = true;
  try {
    await settleWorkOrder(row.id);
    message.success('结算成功');
    await refreshReconcileItem(row.id);
  } catch {
    message.error('结算失败');
  } finally {
    settleLoading.value = false;
  }
}

async function refreshReconcileItem(orderId: string) {
  try {
    const res = await fetchWorkOrderById(orderId);
    const order = res.data;
    if (!order || !result.value) return;
    const item = result.value.items.find(i => i.id === orderId);
    if (item) {
      item.status = order.status;
      item.systemPaintCount = order.totalPaintCount;
      item.systemRemark = order.remark || '';
    }
  } catch {
    // ignore
  }
}

const columns = [
  { title: '工单号', key: 'orderNo', width: 200 },
  { title: '车牌号', key: 'plateNumber', width: 120 },
  {
    title: 'Excel 幅数',
    key: 'excelPaintCount',
    width: 110,
    render: (row: ReconcileItem) => (row.excelPaintCount !== undefined ? row.excelPaintCount.toFixed(2) : '-')
  },
  {
    title: '系统幅数',
    key: 'systemPaintCount',
    width: 110,
    render: (row: ReconcileItem) => (row.systemPaintCount !== undefined ? row.systemPaintCount.toFixed(2) : '-')
  },
  {
    title: '差额',
    key: 'diff',
    width: 100,
    render: (row: ReconcileItem) => {
      if (row.diff === undefined) return '-';
      return <span style={{ color: Math.abs(row.diff) < 0.001 ? '#18a058' : '#d03050' }}>{row.diff > 0 ? `+${row.diff.toFixed(2)}` : row.diff.toFixed(2)}</span>;
    }
  },
  {
    title: '系统状态',
    key: 'status',
    width: 100,
    render: (row: ReconcileItem) => {
      if (!row.status) return '-';
      const typeMap: Record<string, 'default' | 'warning' | 'success' | 'info' | 'error'> = {
        DRAFT: 'default',
        PENDING: 'warning',
        AUDITED: 'success',
        SETTLED: 'info',
        ABNORMAL: 'error',
        COMPLETED: 'success'
      };
      return <NTag size="small" type={typeMap[row.status] || 'default'}>{getStatusLabel(row.status)}</NTag>;
    }
  },
  {
    title: '备注',
    key: 'remark',
    ellipsis: { tooltip: true }
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    fixed: 'right' as const,
    render: (row: ReconcileItem) => {
      if (row.type === 'missing_in_system') {
        return (
          <NSpace size={6}>
            <NButton size="small" type="primary" onClick={() => goToDetailPage(row.orderNo)} disabled={isSealed.value}>
              去创建
            </NButton>
          </NSpace>
        );
      }
      const isSettled = row.status === 'SETTLED' || row.status === 'COMPLETED';
      return (
        <NSpace size={6}>
          <NButton size="small" type="primary" onClick={() => viewOrderDetail(row.id!)}>
            查看
          </NButton>
          {allowSettle && !isSettled && !isSealed.value && (
            <NButton size="small" type="info" onClick={() => openSettle(row)}>
              结算
            </NButton>
          )}
        </NSpace>
      );
    }
  }
];

const filterType = ref<'all' | 'diff' | 'missing_in_system' | 'extra_in_system' | 'duplicate' | 'matched'>('all');

const filteredItems = computed(() => {
  if (!result.value) return [];

  let items = result.value.items;

  if (filterType.value !== 'all') {
    items = items.filter(i => i.type === filterType.value);
  }

  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    items = items.filter(i =>
      i.orderNo.toLowerCase().includes(keyword) ||
      i.plateNumber.toLowerCase().includes(keyword)
    );
  }

  if (statusFilter.value) {
    items = items.filter(i => i.status === statusFilter.value);
  }

  return items;
});

function getTypeLabel(type: string) {
  const map: Record<string, string> = {
    matched: '一致',
    diff: '金额不一致',
    missing_in_system: 'Excel 有系统无',
    extra_in_system: '系统有 Excel 无',
    duplicate: '重复工单号'
  };
  return map[type] || type;
}

function exportResult() {
  if (!result.value) return;
  const headers = ['类型', '工单号', '车牌号', 'Excel幅数', '系统幅数', '差额', '系统状态', '备注'];
  const summaryRow = ['汇总', '', '', result.value.summary.excelTotal, result.value.summary.systemTotal, result.value.summary.diff, '', ''];
  const rows = result.value.items.map(item => [
    getTypeLabel(item.type),
    item.orderNo,
    item.plateNumber,
    item.excelPaintCount !== undefined ? item.excelPaintCount : '',
    item.systemPaintCount !== undefined ? item.systemPaintCount : '',
    item.diff !== undefined ? item.diff : '',
    item.status ? getStatusLabel(item.status) : '',
    item.remark || item.systemRemark || ''
  ]);

  const csvContent = [headers, summaryRow, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `工单对账_${form.settlementMonth}_${form.shopId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// 门店或月份变化时自动检查封单状态
watch([() => form.shopId, () => form.settlementMonth], () => {
  checkSealStatus();
});

loadShops();
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-auto p-16px">
    <NCard title="工单对账" :bordered="false" size="small">
      <NForm inline :model="form" label-width="auto">
        <NFormItem label="门店" path="shopId">
          <NSelect v-model:value="form.shopId" :options="shopOptions" placeholder="请选择门店" clearable style="width: 220px" />
        </NFormItem>
        <NFormItem label="结算月份" path="settlementMonth">
          <NSelect v-model:value="form.settlementMonth" :options="monthOptions" placeholder="请选择月份" clearable style="width: 160px" />
        </NFormItem>
        <NFormItem label="对账表">
          <NUpload v-model:file-list="fileList" :max="1" accept=".xlsx,.xls" :show-file-list="true">
            <NButton>选择 Excel 文件</NButton>
          </NUpload>
        </NFormItem>
        <NFormItem>
          <NButton type="primary" :loading="loading" @click="handleReconcile">
            开始对账
          </NButton>
          <NButton v-if="result" @click="handleReset" class="ml-8px">
            重新对账
          </NButton>
        </NFormItem>
      </NForm>

      <NAlert v-if="isSealed && form.shopId && form.settlementMonth" type="warning" :bordered="false" class="mb-12px">
        <NSpace align="center" justify="space-between">
          <span>该门店 {{ form.settlementMonth }} 已封单，工单不允许修改、删除、审核/取消审核</span>
          <NPopconfirm @positive-click="handleUnseal">
            <template #trigger>
              <NButton size="small" type="warning" :loading="sealLoading">解封</NButton>
            </template>
            确定解封 {{ form.settlementMonth }} 月份？解封后该月工单可被修改。
          </NPopconfirm>
        </NSpace>
      </NAlert>
      <NSpace v-else-if="form.shopId && form.settlementMonth" class="mb-12px" align="center">
        <NPopconfirm @positive-click="handleSeal">
          <template #trigger>
            <NButton size="small" type="error" :loading="sealLoading">封单</NButton>
          </template>
          确定封单 {{ form.settlementMonth }} 月份？封单后该月工单将不允许修改、删除和审核操作。
        </NPopconfirm>
        <span style="color: #999; font-size: 13px">对账完成后封单，锁定该月数据</span>
      </NSpace>

      <NSpin :show="loading">
        <template v-if="result">
          <NSpace class="mb-16px" :size="16" wrap>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="Excel 总幅数" :value="result.summary.excelTotal" :precision="2" />
            </NCard>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="系统总幅数" :value="result.summary.systemTotal" :precision="2" />
            </NCard>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="差额" :value="result.summary.diff" :precision="2">
                <template #suffix>幅</template>
              </NStatistic>
            </NCard>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="一致" :value="result.summary.matchedCount" />
            </NCard>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="金额不一致" :value="result.summary.diffCount" />
            </NCard>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="Excel 有系统无" :value="result.summary.missingInSystemCount" />
            </NCard>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="系统有 Excel 无" :value="result.summary.extraInSystemCount" />
            </NCard>
            <NCard size="small" style="min-width: 140px">
              <NStatistic label="重复" :value="result.summary.duplicateCount" />
            </NCard>
          </NSpace>

          <NSpace class="mb-16px" :size="16" align="center">
            <NButton type="primary" @click="exportResult">
              导出对账结果
            </NButton>
            <NInput
              v-model:value="searchKeyword"
              placeholder="搜索工单号或车牌号"
              style="width: 220px"
              clearable
              @keyup.enter="() => {}"
            />
            <NSelect
              v-model:value="statusFilter"
              :options="statusOptions"
              style="width: 140px"
              placeholder="状态筛选"
            />
          </NSpace>

          <NTabs v-model:value="filterType" type="line">
            <NTabPane name="all" :tab="`全部 (${result.items.length})`" />
            <NTabPane name="diff" :tab="`金额不一致 (${result.summary.diffCount})`" />
            <NTabPane name="missing_in_system" :tab="`Excel 有系统无 (${result.summary.missingInSystemCount})`" />
            <NTabPane name="extra_in_system" :tab="`系统有 Excel 无 (${result.summary.extraInSystemCount})`" />
            <NTabPane name="duplicate" :tab="`重复 (${result.summary.duplicateCount})`" />
            <NTabPane name="matched" :tab="`一致 (${result.summary.matchedCount})`" />
          </NTabs>

          <NDataTable
            :columns="columns"
            :data="filteredItems"
            :bordered="true"
            :single-line="false"
            size="small"
            :scroll-x="980"
            :row-class-name="(row: ReconcileItem) => row.type"
          />
        </template>
        <NEmpty v-else description="请选择门店、月份并上传 Excel 对账表" class="py-60px" />
      </NSpin>
    </NCard>

    <WorkOrderDetailModal v-model:show="showDetail" :order="currentOrder" />
  </div>
</template>

<style scoped>
:deep(.diff) {
  background-color: #fff0f0;
}
:deep(.missing_in_system) {
  background-color: #fff7e6;
}
:deep(.extra_in_system) {
  background-color: #e6f7ff;
}
:deep(.duplicate) {
  background-color: #f6ffed;
}
:deep(.matched) {
  background-color: #f9fff9;
}
</style>
