<script setup lang="tsx">
import { NButton, NPopconfirm, NTag, NInput, NSpace } from 'naive-ui';
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { fetchPaintVehiclePage, deletePaintVehicle } from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import VehicleOperateDrawer from './modules/vehicle-operate-drawer.vue';
import VehicleHistoryDrawer from './modules/vehicle-history-drawer.vue';
import { canEdit } from '@/utils/permission';
import { useAppStore } from '@/store/modules/app';

const allowEdit = canEdit();
const route = useRoute();
const appStore = useAppStore();

const {
  columns,
  columnChecks,
  data,
  getData,
  getDataByPage,
  loading,
  mobilePagination,
  searchParams,
  resetSearchParams
} = useTable({
  apiFn: fetchPaintVehiclePage,
  showTotal: true,
  apiParams: {
    current: 1,
    size: 10,
    plateNumber: undefined as string | undefined,
    customerName: undefined as string | undefined,
    phone: undefined as string | undefined,
    vin: undefined as string | undefined
  },
  columns: () => [
    {
      type: 'selection',
      align: 'center',
      width: 48
    },
    {
      key: 'index',
      title: '序号',
      align: 'center',
      width: 64
    },
    {
      key: 'plateNumber',
      title: '车牌号',
      align: 'center',
      width: 120,
      render: (row: any) => <NTag type="primary" size="small">{row.plateNumber}</NTag>
    },
    {
      key: 'carModel',
      title: '车型',
      align: 'center',
      minWidth: 120,
      ellipsis: { tooltip: true }
    },
    {
      key: 'brand',
      title: '品牌',
      align: 'center',
      width: 100,
      ellipsis: { tooltip: true }
    },
    {
      key: 'customerName',
      title: '客户名称',
      align: 'center',
      minWidth: 100,
      ellipsis: { tooltip: true }
    },
    {
      key: 'phone',
      title: '电话',
      align: 'center',
      width: 130
    },
    {
      key: 'totalOrderCount',
      title: '累计工单',
      align: 'center',
      width: 100,
      render: (row: any) => (
        <NTag type={row.totalOrderCount > 0 ? 'success' : 'default'} size="small">
          {row.totalOrderCount} 单
        </NTag>
      )
    },
    {
      key: 'totalPaintCount',
      title: '累计幅数',
      align: 'center',
      width: 100,
      render: (row: any) => <span class="font-bold text-primary">{Number(row.totalPaintCount).toFixed(1)}</span>
    },
    {
      key: 'lastOrderAt',
      title: '最近进店',
      align: 'center',
      width: 120,
      render: (row: any) => (row.lastOrderAt ? row.lastOrderAt.slice(0, 10) : '-')
    },
    {
      key: 'lastShopName',
      title: '最近门店',
      align: 'center',
      minWidth: 120,
      ellipsis: { tooltip: true },
      render: (row: any) => row.lastShopName || '-'
    },
    {
      key: 'operate',
      title: '操作',
      align: 'center',
      width: 240,
      fixed: 'right',
      render: (row: any) => (
        <div class="flex-center gap-8px">
          <NButton type="info" ghost size="small" onClick={() => openHistory(row)}>
            历史
          </NButton>
          {allowEdit && (
            <NButton type="primary" ghost size="small" onClick={() => edit(row.id)}>
              编辑
            </NButton>
          )}
          {allowEdit && (
            <NPopconfirm onPositiveClick={() => handleDelete(row.id)}>
              {{
                default: () => '删除车辆不会删除关联工单，仅解除关联。确认删除？',
                trigger: () => (
                  <NButton type="error" ghost size="small">
                    删除
                  </NButton>
                )
              }}
            </NPopconfirm>
          )}
        </div>
      )
    }
  ]
});

const {
  drawerVisible,
  operateType,
  editingData,
  handleAdd,
  handleEdit,
  checkedRowKeys,
  onDeleted
} = useTableOperate(data as any, getData);

function edit(id: string) {
  handleEdit(id);
}

// 历史工单抽屉
const historyVisible = ref(false);
const historyVehicle = ref<any>(null);

function openHistory(row: any) {
  historyVehicle.value = row;
  historyVisible.value = true;
}

async function handleDelete(id: string) {
  const { error } = await deletePaintVehicle(id);
  if (error) return;
  window.$message?.success('删除成功');
  await onDeleted();
}

// 支持 URL query 预填搜索条件（从工单列表页点击车牌号跳转时）
onMounted(() => {
  const queryPlate = route.query.plateNumber as string;
  if (queryPlate) {
    searchParams.plateNumber = queryPlate;
  }
});
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <NCard :bordered="false" size="small">
      <NSpace align="center" :wrap="true" :size="[16, 12]">
        <NSpace align="center" :size="6">
          <NInput
            v-model:value="searchParams.plateNumber"
            placeholder="搜索车牌号"
            clearable
            size="small"
            style="width: 160px"
            @clear="getData"
            @keyup.enter="getData"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NInput
            v-model:value="searchParams.customerName"
            placeholder="搜索客户名称"
            clearable
            size="small"
            style="width: 140px"
            @clear="getData"
            @keyup.enter="getData"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NInput
            v-model:value="searchParams.phone"
            placeholder="搜索电话"
            clearable
            size="small"
            style="width: 130px"
            @clear="getData"
            @keyup.enter="getData"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NInput
            v-model:value="searchParams.vin"
            placeholder="搜索车架号"
            clearable
            size="small"
            style="width: 160px"
            @clear="getData"
            @keyup.enter="getData"
          />
        </NSpace>
        <NButton size="small" type="primary" @click="getData">查询</NButton>
        <NButton size="small" @click="resetSearchParams">重置</NButton>
      </NSpace>
    </NCard>

    <NCard title="车辆管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <TableHeaderOperation
          v-model:columns="columnChecks"
          :disabled-delete="checkedRowKeys.length === 0"
          :loading="loading"
          @add="handleAdd"
          @refresh="getData"
        >
          <template v-if="allowEdit" #default>
            <NButton size="small" ghost type="primary" @click="handleAdd">
              <template #icon>
                <icon-ic-round-plus class="text-icon" />
              </template>
              新增
            </NButton>
          </template>
        </TableHeaderOperation>
      </template>

      <NDataTable
        v-model:checked-row-keys="checkedRowKeys"
        :columns="columns"
        :data="data"
        size="small"
        :flex-height="!appStore.isMobile"
        :scroll-x="1400"
        :loading="loading"
        remote
        :row-key="(row: any) => row.id"
        :pagination="mobilePagination"
        class="sm:h-full"
      />
    </NCard>

    <VehicleOperateDrawer
      v-model:visible="drawerVisible"
      :operate-type="operateType"
      :row-data="editingData"
      @submitted="getDataByPage"
    />

    <VehicleHistoryDrawer
      v-model:visible="historyVisible"
      :vehicle="historyVehicle"
    />
  </div>
</template>

<style scoped></style>
