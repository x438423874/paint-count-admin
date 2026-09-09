<script setup lang="tsx">
import { h, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NCard,
  NDataTable,
  NDatePicker,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NPopconfirm,
  NSelect,
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { getPaintOrderStatusTagType, paintOrderStatusLabel } from '@/constants/paint';
import {
  type PaintOrderStatus,
  type PaintWorkOrder,
  type SealOverviewItem,
  type SealOverviewSummary,
  fetchSealOverview,
  fetchWorkOrderPage,
  sealSettlementMonth,
  unsealSettlementMonth
} from '@/service/api/paint';
import { useShopOptions } from '@/hooks/business/use-shop-options';

const message = useMessage();
const dialog = useDialog();

// 状态文案/颜色统一走 constants/paint（原先本页自维护一份，与工单列表口径漂移）
const STATUS_LABEL: Record<PaintOrderStatus, string> = paintOrderStatusLabel;

function tagType(status: PaintOrderStatus) {
  return getPaintOrderStatusTagType(status);
}

// 门店走 paint store 共享缓存，全应用只请求一次（原为每页各自 fetchPaintShopList）
const { shopOptions, ensureShops } = useShopOptions();
async function loadShops() {
  await ensureShops();
}

const filters = reactive<{ shopId: string | null; month: number | null }>({ shopId: null, month: null });

function formatMonth(ts: number | null) {
  if (!ts) return undefined;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const loading = ref(false);
const data = ref<SealOverviewItem[]>([]);
const summary = ref<SealOverviewSummary | null>(null);
const pagination = reactive({
  page: 1,
  pageSize: 20,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  itemCount: 0
});

async function loadData() {
  loading.value = true;
  try {
    const { data: res, error } = await fetchSealOverview({
      shopId: filters.shopId || undefined,
      month: formatMonth(filters.month),
      current: pagination.page,
      size: pagination.pageSize
    });
    if (!error && res) {
      data.value = res.list;
      pagination.itemCount = res.total;
      summary.value = res.summary || null;
    }
  } finally {
    loading.value = false;
  }
}

function handlePageChange(p: number) {
  pagination.page = p;
  loadData();
}
function handlePageSizeChange(s: number) {
  pagination.pageSize = s;
  pagination.page = 1;
  loadData();
}
function handleSearch() {
  pagination.page = 1;
  loadData();
}
function handleReset() {
  filters.shopId = null;
  filters.month = null;
  pagination.page = 1;
  loadData();
}

function confirmSeal(row: SealOverviewItem) {
  if (!row.hasData) {
    message.warning(`${row.shopName} ${row.month} 当月无工单数据，无需封单`);
    return;
  }
  const stats = `\n\n该月共 ${row.orderCount} 条工单（${Number(row.totalPaintCount).toFixed(1)} 幅）${
    row.reworkCount > 0 ? `，另有返工 ${row.reworkCount} 条` : ''
  }`;

  // 防线：尚有待审核工单时，二次确认后走强制封单（后端仍会校验 force 标记）
  if (row.pendingCount > 0) {
    dialog.warning({
      title: '存在待审核工单',
      content: `「${row.shopName} - ${row.month}」尚有 ${row.pendingCount} 单（${Number(
        row.pendingPaintCount
      ).toFixed(1)} 幅）未审核。未审核单的幅数也会计入该月结算金额，封单后将无法再审核。确认要强制封单吗？`,
      positiveText: '强制封单',
      negativeText: '取消',
      onPositiveClick: () => doSeal(row, true)
    });
    return;
  }

  dialog.warning({
    title: '确认封单',
    content: `确定封单「${row.shopName} - ${row.month}」？封单后该月工单将不允许修改、删除和审核操作。${stats}`,
    positiveText: '确认封单',
    negativeText: '取消',
    onPositiveClick: () => doSeal(row)
  });
}

async function doSeal(row: SealOverviewItem, force = false) {
  try {
    await sealSettlementMonth(row.shopId, row.month, force);
    message.success('封单成功，该月工单已锁定');
    loadData();
  } catch (e: any) {
    message.error(e?.message || '封单失败');
  }
}

/** 一键封单：按当前月份封单所有「有数据且未封单」的门店；有 待审核/无数据 的门店自动跳过并提示 */
const batchSealing = ref(false);
async function handleBatchSeal() {
  const month = formatMonth(filters.month);
  if (!month) {
    message.warning('请先选择月份，再一键封单');
    return;
  }
  const targets = data.value.filter(r => !r.isSealed);
  if (targets.length === 0) {
    message.success('该月所有门店均已封单');
    return;
  }
  const skipped = targets.filter(r => !r.hasData || r.pendingCount > 0);
  const willSeal = targets.filter(r => r.hasData && r.pendingCount === 0);

  dialog.warning({
    title: '一键封单',
    content: `将封单 ${willSeal.length} 家门店${
      skipped.length > 0
        ? `；跳过 ${skipped.length} 家（${skipped
            .map(r => `${r.shopName}${r.pendingCount > 0 ? `：${r.pendingCount} 单待审核` : '：无数据'}`)
            .join('、')}）`
        : ''
    }。确认继续？`,
    positiveText: `封单 ${willSeal.length} 家`,
    negativeText: '取消',
    onPositiveClick: async () => {
      batchSealing.value = true;
      let ok = 0;
      const failed: string[] = [];
      for (const row of willSeal) {
        try {
          await sealSettlementMonth(row.shopId, row.month);
          ok += 1;
        } catch (e: any) {
          failed.push(`${row.shopName}：${e?.message || '失败'}`);
        }
      }
      batchSealing.value = false;
      if (failed.length > 0) {
        message.error(`封单完成 ${ok} 家，失败 ${failed.length} 家：${failed.join('；')}`);
      } else {
        message.success(`已封单 ${ok} 家门店`);
      }
      loadData();
    }
  });
}

async function doUnseal(row: SealOverviewItem) {
  try {
    await unsealSettlementMonth(row.shopId, row.month);
    message.success('已解封，该月工单可继续操作');
    loadData();
  } catch (e: any) {
    message.error(e?.message || '解封失败');
  }
}

// 明细抽屉
const showDetail = ref(false);
const detailRow = ref<SealOverviewItem | null>(null);
const detailLoading = ref(false);
const detailData = ref<PaintWorkOrder[]>([]);
const detailPagination = reactive({ page: 1, pageSize: 10, itemCount: 0 });

async function openDetail(row: SealOverviewItem) {
  detailRow.value = row;
  detailPagination.page = 1;
  showDetail.value = true;
  await loadDetail();
}

async function loadDetail() {
  if (!detailRow.value) return;
  detailLoading.value = true;
  try {
    const { data: res, error } = await fetchWorkOrderPage({
      shopId: detailRow.value.shopId,
      settlementMonth: detailRow.value.month,
      current: detailPagination.page,
      size: detailPagination.pageSize
    });
    if (!error && res) {
      detailData.value = res.records;
      detailPagination.itemCount = res.total;
    }
  } finally {
    detailLoading.value = false;
  }
}

function handleDetailPageChange(p: number) {
  detailPagination.page = p;
  loadDetail();
}

const columns: DataTableColumns<SealOverviewItem> = [
  { title: '门店', key: 'shopName', minWidth: 140 },
  { title: '月份', key: 'month', width: 100 },
  { title: '总幅数', key: 'totalPaintCount', width: 110, render: row => Number(row.totalPaintCount).toFixed(1) },
  { title: '工单数', key: 'orderCount', width: 90 },
  { title: '返工数', key: 'reworkCount', width: 90 },
  {
    title: '待审核',
    key: 'pendingCount',
    width: 120,
    render: row =>
      row.pendingCount > 0
        ? h(
            NTag,
            { type: 'warning', size: 'small' },
            { default: () => `${row.pendingCount} 单 / ${Number(row.pendingPaintCount).toFixed(1)} 幅` }
          )
        : h(NText, { depth: 3 }, { default: () => '0' })
  },
  {
    title: '封单状态',
    key: 'isSealed',
    width: 170,
    render: row =>
      row.isSealed
        ? h(
            NSpace,
            { vertical: true, size: 2 },
            {
              default: () => [
                h(NTag, { type: 'success' }, { default: () => '已封单' }),
                h(
                  NText,
                  { depth: 3, style: 'font-size:12px' },
                  { default: () => (row.sealedAt ? `封单于 ${row.sealedAt.slice(0, 10)}` : '') }
                )
              ]
            }
          )
        : h(NTag, { type: 'default' }, { default: () => '未封单' })
  },
  {
    title: '操作',
    key: 'actions',
    width: 210,
    fixed: 'right',
    render: row =>
      h(
        NSpace,
        { size: 4 },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', onClick: () => openDetail(row), disabled: !row.hasData },
              { default: () => '查看明细' }
            ),
            row.isSealed
              ? h(
                  NPopconfirm,
                  { onPositiveClick: () => doUnseal(row) },
                  {
                    default: () => '确定解封该月？解封后可继续操作工单',
                    trigger: () => h(NButton, { size: 'small', type: 'warning' }, { default: () => '解封' })
                  }
                )
              : h(
                  NButton,
                  { size: 'small', type: 'primary', onClick: () => confirmSeal(row) },
                  { default: () => '封单' }
                )
          ]
        }
      )
  }
];

const detailColumns: DataTableColumns<PaintWorkOrder> = [
  { title: '工单号', key: 'orderNo', minWidth: 140 },
  { title: '车牌', key: 'plateNumber', width: 120 },
  { title: '客户', key: 'customerName', width: 120 },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: row => h(NTag, { type: tagType(row.status) }, { default: () => STATUS_LABEL[row.status] })
  },
  { title: '幅数', key: 'totalPaintCount', width: 90, render: row => Number(row.totalPaintCount).toFixed(1) },
  { title: '日期', key: 'orderDate', width: 120 }
];

onMounted(() => {
  loadShops();
  loadData();
});
</script>

<template>
  <div>
    <NCard title="封单管理" :bordered="false">
      <NSpace vertical :size="16">
        <NAlert v-if="summary" :type="summary.shopsWithoutData > 0 || summary.pendingOrderTotal > 0 ? 'warning' : 'success'" :bordered="false">
          结算就绪度：本月有数据的门店 {{ summary.shopsWithData }} 家
          <template v-if="summary.shopsWithoutData > 0">、无数据门店 {{ summary.shopsWithoutData }} 家（注意漏导入）</template>
          、待审核 {{ summary.pendingOrderTotal }} 单 / {{ Number(summary.pendingPaintTotal).toFixed(1) }} 幅
          、已封单 {{ summary.sealedCount }} 家。待审核单的幅数也会计入该月结算金额，建议审核完毕后再封单。
        </NAlert>
        <NAlert v-else type="default" :bordered="false">
          提示：选择「月份」可查看该月全部启用门店的结算就绪度（含无数据门店提醒），并可一键封单。
        </NAlert>

        <NForm inline :model="filters" @submit.prevent="handleSearch">
          <NFormItem label="门店">
            <NSelect
              v-model:value="filters.shopId"
              :options="shopOptions"
              placeholder="全部门店"
              clearable
              style="width: 200px"
            />
          </NFormItem>
          <NFormItem label="月份">
            <NDatePicker
              v-model:value="filters.month"
              type="month"
              placeholder="全部月份"
              clearable
              style="width: 180px"
            />
          </NFormItem>
          <NFormItem>
            <NSpace>
              <NButton type="primary" @click="handleSearch">查询</NButton>
              <NButton @click="handleReset">重置</NButton>
              <NPopconfirm @positive-click="handleBatchSeal">
                <template #trigger>
                  <NButton type="error" ghost :loading="batchSealing" :disabled="!filters.month">
                    一键封单（按所选月份）
                  </NButton>
                </template>
                将按所选月份封单所有「有数据且无待审核」的门店，有 待审核/无数据 的门店会跳过并列出。确认继续？
              </NPopconfirm>
            </NSpace>
          </NFormItem>
        </NForm>

        <NDataTable
          :columns="columns"
          :data="data"
          :loading="loading"
          :pagination="pagination"
          :remote="true"
          :bordered="true"
          :single-line="false"
          :scroll-x="1000"
          :row-class-name="row => (row.hasData ? '' : 'seal-row-nodata')"
          @update:page="handlePageChange"
          @update:page-size="handlePageSizeChange"
        />
      </NSpace>
    </NCard>

    <NDrawer v-model:show="showDetail" :width="920">
      <NDrawerContent :title="detailRow ? `封单明细 - ${detailRow.shopName} - ${detailRow.month}` : '封单明细'">
        <NSpace vertical :size="12">
          <NDataTable
            :columns="detailColumns"
            :data="detailData"
            :loading="detailLoading"
            :pagination="detailPagination"
            :remote="true"
            :bordered="true"
            :single-line="false"
            :scroll-x="700"
            @update:page="handleDetailPageChange"
          />
        </NSpace>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>


<style scoped>
:deep(.seal-row-nodata td) {
  color: #b0b0b0;
  background-color: #fafafa;
}
</style>
