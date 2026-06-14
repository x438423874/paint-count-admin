<script setup lang="tsx">
import { NButton, NPopconfirm, NTag, NSpace } from 'naive-ui';
import { ref } from 'vue';
import { fetchPaintCategoryList, deletePaintCategory } from '@/service/api';

const loading = ref(false);
const data = ref<any[]>([]);

async function getData() {
  loading.value = true;
  try {
    const { data: resData, error } = await fetchPaintCategoryList();
    if (!error && resData) {
      data.value = (resData as any[]).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    }
  } finally {
    loading.value = false;
  }
}
getData();

const drawerVisible = ref(false);
const operateType = ref<'add' | 'edit'>('add');
const editingData = ref<any>(null);

function handleAdd() {
  operateType.value = 'add';
  editingData.value = null;
  drawerVisible.value = true;
}

function handleEdit(row: any) {
  operateType.value = 'edit';
  editingData.value = { ...row };
  drawerVisible.value = true;
}

async function handleDelete(id: string) {
  const { error } = await deletePaintCategory(id);
  if (error) return;
  window.$message?.success('删除成功');
  await getData();
}

const columns = [
  {
    key: 'name',
    title: '部位名称',
    minWidth: 160
  },
  {
    key: 'code',
    title: '编码',
    width: 120,
    align: 'center' as const
  },
  {
    key: 'sortOrder',
    title: '排序',
    width: 80,
    align: 'center' as const
  },
  {
    key: 'isSpecial',
    title: '类型',
    width: 80,
    align: 'center' as const,
    render: (row: any) => row.isSpecial
      ? <NTag type="warning" size="small">特殊</NTag>
      : <NTag type="info" size="small">普通</NTag>
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
            default: () => '确认删除此部位？如果被模板或工单引用则无法删除。',
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
    <NCard title="部位管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <NSpace :size="12">
          <NButton type="primary" @click="handleAdd">
            <template #icon><icon-ic-round-plus /></template>
            新增部位
          </NButton>
          <NButton @click="getData">
            <template #icon><icon-ic-outline-refresh /></template>
            刷新
          </NButton>
        </NSpace>
      </template>

      <NAlert type="info" class="mb-12px">
        管理喷漆部位的基础数据，如前杠、后杠、机盖等。这些部位在标准模板中可多选组合，相同系数的部位会自动合并显示（如：前杠/后杠/侧裙）。
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

      <CategoryOperateDrawer
        v-model:visible="drawerVisible"
        :operate-type="operateType"
        :row-data="editingData"
        @submitted="getData"
      />
    </NCard>
  </div>
</template>

<style scoped></style>
