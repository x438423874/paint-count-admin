<script setup lang="tsx">
import { h, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NCard,
  NDataTable,
  NDatePicker,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NTag,
  useMessage
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { PAINT_ORDER_STATUS_LABEL } from '@/constants/paint';
import {
  type PaintItemCategory,
  type PaintWorkOrder,
  createWorkOrder,
  deleteWorkOrder,
  fetchPaintCategoryList,
  fetchWorkOrderPage
} from '@/service/api/paint';
import { useShopOptions } from '@/hooks/business/use-shop-options';

const message = useMessage();

// 门店走 paint store 共享缓存，全应用只请求一次（原为每页各自 fetchPaintShopList）
const { shopOptions, ensureShops } = useShopOptions();
const categoryOptions = ref<{ label: string; value: string }[]>([]);

async function loadShops() {
  await ensureShops();
}

async function loadCategories() {
  const { data, error } = await fetchPaintCategoryList();
  if (!error && data) {
    categoryOptions.value = (data as PaintItemCategory[]).map(c => ({
      label: `${c.name}（${c.code}）`,
      value: c.id
    }));
  }
}

function formatMonth(ts: number | null) {
  if (!ts) return undefined;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonthTs() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

const filters = reactive<{ shopId: string | null; settlementMonth: number | null }>({
  shopId: null,
  settlementMonth: null
});

const loading = ref(false);
const data = ref<PaintWorkOrder[]>([]);

async function loadData() {
  loading.value = true;
  try {
    const { data: res, error } = await fetchWorkOrderPage({
      isAdjustment: true,
      shopId: filters.shopId || undefined,
      settlementMonth: formatMonth(filters.settlementMonth),
      size: 200
    });
    if (!error && res) {
      data.value = (res as any).records ?? [];
    }
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  loadData();
}
function handleReset() {
  filters.shopId = null;
  filters.settlementMonth = null;
  loadData();
}

// 新建幅数调整工单（负幅数工单）
const showCreate = ref(false);
const creating = ref(false);
const form = reactive<{
  shopId: string | null;
  settlementMonth: number | null;
  categoryId: string | null;
  paintCount: number | null;
  newPartQuantity: number;
  reason: string;
}>({
  shopId: null,
  settlementMonth: null,
  categoryId: null,
  paintCount: null,
  newPartQuantity: 0,
  reason: ''
});

function openCreate() {
  form.shopId = filters.shopId;
  form.settlementMonth = currentMonthTs();
  form.categoryId = null;
  form.paintCount = null;
  form.newPartQuantity = 0;
  form.reason = '';
  showCreate.value = true;
}

async function submitCreate() {
  if (!form.shopId) return message.error('请选择门店');
  if (!form.settlementMonth) return message.error('请选择调整月份');
  if (form.paintCount === null || form.paintCount === 0) {
    return message.error('请输入幅数调整量（正数追加、负数扣减，不能为 0）');
  }
  if (!form.reason.trim()) return message.error('请填写调整原因（便于审计追溯）');

  const month = formatMonth(form.settlementMonth)!;
  const items = form.categoryId
    ? [
        {
          categoryId: form.categoryId,
          overridePaintCount: form.paintCount as number,
          newPartQuantity: form.newPartQuantity || 0
        }
      ]
    : [];

  creating.value = true;
  try {
    const { error } = await createWorkOrder({
      shopId: form.shopId,
      settlementMonth: month,
      orderDate: `${month}-01`,
      isAdjustment: true,
      remark: form.reason,
      items,
      ...(form.categoryId ? {} : { importTotalPaintCount: form.paintCount as number })
    } as any);
    if (!error) {
      message.success('调整工单已创建（负幅数），统计已自动纠偏');
      showCreate.value = false;
      loadData();
    } else {
      message.error('创建失败');
    }
  } finally {
    creating.value = false;
  }
}

async function doDelete(row: PaintWorkOrder) {
  try {
    await deleteWorkOrder(row.id);
    message.success('已删除调整工单（撤销本次纠偏）');
    loadData();
  } catch (e: any) {
    message.error(e?.message || '删除失败');
  }
}

// 状态文案统一走 constants/paint（原映射把 DRAFT 写成了「待审核」、PENDING 写成「待审」）
const statusText: Record<string, string> = PAINT_ORDER_STATUS_LABEL;

const columns: DataTableColumns<PaintWorkOrder> = [
  {
    title: '门店',
    key: 'shopName',
    minWidth: 140,
    render: row => row.shop?.name || row.shopId
  },
  { title: '调整月份', key: 'settlementMonth', width: 120 },
  {
    title: '部位',
    key: 'categoryName',
    width: 150,
    render: row => {
      const cat = row.items?.[0]?.category?.name;
      return cat || h(NTag, { type: 'default' }, { default: () => '整体调整' });
    }
  },
  {
    title: '幅数调整',
    key: 'totalPaintCount',
    width: 130,
    render: row => {
      const v = Number(row.totalPaintCount);
      return h(NTag, { type: v < 0 ? 'error' : 'success' }, { default: () => `${v > 0 ? '+' : ''}${v.toFixed(1)}` });
    }
  },
  {
    title: '新件',
    key: 'newPartQuantity',
    width: 90,
    render: row => String(row.items?.[0]?.newPartQuantity ?? '-')
  },
  { title: '原因', key: 'remark', minWidth: 160, ellipsis: { tooltip: true } },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: row => h(NTag, { type: 'info' }, { default: () => statusText[row.status] || row.status })
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 170,
    render: row => (row.createdAt ? row.createdAt.slice(0, 19).replace('T', ' ') : '')
  },
  {
    title: '操作',
    key: 'actions',
    width: 90,
    fixed: 'right',
    render: row =>
      h(
        NPopconfirm,
        { onPositiveClick: () => doDelete(row) },
        {
          default: () => '确定删除该调整工单（撤销本次纠偏）？',
          trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' })
        }
      )
  }
];

onMounted(() => {
  loadShops();
  loadCategories();
  loadData();
});
</script>

<template>
  <div>
    <NCard title="幅数调整（调整工单）" :bordered="false">
      <template #header-extra>
        <NTag type="warning">负幅数工单，用于直接抵消/订正月报</NTag>
      </template>
      <NSpace vertical :size="16">
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
          <NFormItem label="调整月份">
            <NDatePicker
              v-model:value="filters.settlementMonth"
              type="month"
              placeholder="全部"
              clearable
              style="width: 160px"
            />
          </NFormItem>
          <NFormItem>
            <NSpace>
              <NButton type="primary" @click="handleSearch">查询</NButton>
              <NButton @click="handleReset">重置</NButton>
              <NButton type="primary" dashed @click="openCreate">新建调整工单</NButton>
            </NSpace>
          </NFormItem>
        </NForm>

        <NDataTable
          :columns="columns"
          :data="data"
          :loading="loading"
          :bordered="true"
          :single-line="false"
          :scroll-x="1200"
        />
      </NSpace>
    </NCard>

    <NModal
      v-model:show="showCreate"
      title="新建幅数调整工单"
      preset="card"
      style="width: 560px"
      :mask-closable="false"
    >
      <NForm :model="form" label-placement="left" :label-width="100">
        <NFormItem label="门店" required>
          <NSelect v-model:value="form.shopId" :options="shopOptions" placeholder="请选择门店" style="width: 100%" />
        </NFormItem>
        <NFormItem label="调整月份" required>
          <NDatePicker
            v-model:value="form.settlementMonth"
            type="month"
            placeholder="出错/需纠偏的那个月（如 2026-07）"
            style="width: 100%"
          />
        </NFormItem>
        <NFormItem label="部位">
          <NSelect
            v-model:value="form.categoryId"
            :options="categoryOptions"
            placeholder="不填=整体幅数调整"
            clearable
            style="width: 100%"
          />
        </NFormItem>
        <NFormItem label="幅数调整" required>
          <NInputNumber v-model:value="form.paintCount" placeholder="正数追加、负数扣减（如 -5）" style="width: 100%" />
        </NFormItem>
        <NFormItem label="新件调整">
          <NInputNumber v-model:value="form.newPartQuantity" placeholder="可负（仅选部位时生效）" style="width: 100%" />
        </NFormItem>
        <NFormItem label="原因" required>
          <NInput
            v-model:value="form.reason"
            type="textarea"
            placeholder="请说明纠错原因，便于审计追溯"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :loading="creating" @click="submitCreate">确认创建</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
