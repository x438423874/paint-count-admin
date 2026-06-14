<script setup lang="tsx">
import { NButton, NPopconfirm, NTag, NSpace } from 'naive-ui';
import { ref } from 'vue';
import { fetchStandardTemplateList, fetchStandardTemplateById, deleteStandardTemplate } from '@/service/api';
import TemplateOperateDrawer from './modules/template-operate-drawer.vue';

const loading = ref(false);
const data = ref<any[]>([]);

async function getData() {
  loading.value = true;
  try {
    const { data: resData, error } = await fetchStandardTemplateList();
    if (!error && resData) {
      data.value = resData;
    }
  } finally {
    loading.value = false;
  }
}
getData();

const drawerVisible = ref(false);
const operateType = ref<NaiveUI.TableOperateType>('add');
const editingData = ref<any>(null);

function handleAdd() {
  operateType.value = 'add';
  editingData.value = null;
  drawerVisible.value = true;
}

async function handleEdit(row: any) {
  operateType.value = 'edit';
  // 列表数据不含 items，需要请求详情
  const { data: detail, error } = await fetchStandardTemplateById(row.id);
  editingData.value = error ? row : detail;
  drawerVisible.value = true;
}

async function handleDelete(id: string) {
  const { error } = await deleteStandardTemplate(id);
  if (error) return;
  window.$message?.success('删除成功');
  await getData();
}

const columns = [
  {
    key: 'name',
    title: '标准名称',
    minWidth: 180
  },
  {
    key: 'version',
    title: '版本号',
    width: 100,
    align: 'center' as const,
    render: (row: any) => row.version || '-'
  },
  {
    key: 'description',
    title: '描述',
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: (row: any) => row.description || '-'
  },
  {
    key: 'itemCount',
    title: '项目数',
    width: 90,
    align: 'center' as const,
    render: (row: any) => row._count?.items ?? row.items?.length ?? 0
  },
  {
    key: 'shopCount',
    title: '关联门店',
    width: 100,
    align: 'center' as const,
    render: (row: any) => {
      const count = row._count?.shops ?? 0;
      return count > 0 ? <NTag type="success" size="small">{count} 家门店</NTag> : <NTag size="small">未关联</NTag>;
    }
  },
  {
    key: 'isActive',
    title: '状态',
    width: 80,
    align: 'center' as const,
    render: (row: any) => row.isActive
      ? <NTag type="success" size="small">启用</NTag>
      : <NTag type="error" size="small">禁用</NTag>
  },
  {
    key: 'operate',
    title: '操作',
    align: 'center' as const,
    width: 160,
    render: (row: any) => (
      <div class="flex-center gap-8px">
        <NButton type="primary" ghost size="small" onClick={() => handleEdit(row)}>
          编辑
        </NButton>
        <NPopconfirm onPositiveClick={() => handleDelete(row.id)}>
          {{
            default: () => '确认删除此标准模板？',
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
];
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <NCard title="标准模板管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <NSpace :size="12">
          <NButton type="primary" @click="handleAdd">
            <template #icon><icon-ic-round-plus /></template>
            新增标准模板
          </NButton>
          <NButton @click="getData">
            <template #icon><icon-ic-outline-refresh /></template>
            刷新
          </NButton>
        </NSpace>
      </template>

      <NAlert type="info" class="mb-12px">
        标准模板是独立管理的幅数标准实体，可命名、有版本号。每个项目可设置系数、新件加幅和特殊车漆倍数。一个标准模板可以应用到多个门店，应用后会覆盖门店原有的幅数标准。
      </NAlert>

      <NDataTable
        :columns="columns"
        :data="data"
        size="small"
        :bordered="true"
        :loading="loading"
        :flex-height="true"
        :row-key="(row: any) => row.id"
        class="sm:h-full"
      />

      <TemplateOperateDrawer
        v-model:visible="drawerVisible"
        :operate-type="operateType"
        :row-data="editingData"
        @submitted="getData"
      />
    </NCard>
  </div>
</template>

<style scoped></style>
