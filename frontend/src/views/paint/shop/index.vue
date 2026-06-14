<script setup lang="tsx">
import { NButton, NPopconfirm, NTag } from 'naive-ui';
import { ref } from 'vue';
import { fetchPaintShopPage, deletePaintShop } from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import ShopOperateDrawer from './modules/shop-operate-drawer.vue';

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
  apiFn: fetchPaintShopPage,
  showTotal: true,
  apiParams: {
    current: 1,
    size: 10,
    name: undefined as string | undefined,
    brand: undefined as string | undefined
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
      key: 'name',
      title: '门店名称',
      align: 'center',
      minWidth: 180
    },
    {
      key: 'code',
      title: '门店编码',
      align: 'center',
      width: 140
    },
    {
      key: 'brand',
      title: '品牌',
      align: 'center',
      width: 120
    },
    {
      key: 'address',
      title: '地址',
      minWidth: 160,
      ellipsis: { tooltip: true }
    },
    {
      key: 'phone',
      title: '电话',
      align: 'center',
      width: 130
    },
    {
      key: 'standardTemplate',
      title: '标准模板',
      width: 140,
      render: (row: any) => row.standardTemplate?.name
        ? <NTag type="success" size="small">{row.standardTemplate.name}</NTag>
        : <NTag size="small">未关联</NTag>
    },
    {
      key: 'status',
      title: '状态',
      align: 'center',
      width: 80,
      render: (row: any) => (
        <NTag type={row.status === 'ENABLED' ? 'success' : 'warning'}>
          {row.status === 'ENABLED' ? '启用' : '禁用'}
        </NTag>
      )
    },
    {
      key: 'operate',
      title: '操作',
      align: 'center',
      width: 160,
      render: (row: any) => (
        <div class="flex-center gap-8px">
          <NButton type="primary" ghost size="small" onClick={() => edit(row.id)}>
            编辑
          </NButton>
          <NPopconfirm onPositiveClick={() => handleDelete(row.id)}>
            {{
              default: () => '确认删除此门店？',
              trigger: () => (
                <NButton type="error" ghost size="small">
                  删除
                </NButton>
              )
            }}
          </NPopconfirm>
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
} = useTableOperate(data, getData);

function edit(id: string) {
  handleEdit(id);
}

async function handleDelete(id: string) {
  const { error } = await deletePaintShop(id);
  if (error) return;
  window.$message?.success('删除成功');
  await onDeleted();
}
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <NCard title="门店管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <TableHeaderOperation
          v-model:columns="columnChecks"
          :disabled-delete="checkedRowKeys.length === 0"
          :loading="loading"
          @add="handleAdd"
          @refresh="getData"
        />
      </template>

      <NAlert type="info" class="mb-12px">
        门店通过关联标准模板来设定幅数标准，在编辑门店时选择标准模板即可绑定。
      </NAlert>

      <NDataTable
        v-model:checked-row-keys="checkedRowKeys"
        :columns="columns"
        :data="data"
        size="small"
        :flex-height="true"
        :scroll-x="1000"
        :loading="loading"
        remote
        :row-key="(row: any) => row.id"
        :pagination="mobilePagination"
        class="sm:h-full"
      />

      <ShopOperateDrawer
        v-model:visible="drawerVisible"
        :operate-type="operateType"
        :row-data="editingData"
        @submitted="getDataByPage"
      />
    </NCard>
  </div>
</template>

<style scoped></style>
