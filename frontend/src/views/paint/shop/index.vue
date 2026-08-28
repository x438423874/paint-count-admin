<script setup lang="tsx">
import { NButton, NTag, NSpace, NSelect, NInput, NText, NDropdown } from 'naive-ui';
import { ref } from 'vue';
import { fetchPaintShopPage, deletePaintShop, fetchStandardTemplateList, applyTemplateToShop } from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import ShopOperateDrawer from './modules/shop-operate-drawer.vue';
import OrderNoRulesModal from '../components/order-no-rules-modal.vue';
import ExcelConfigModal from '../components/excel-config-modal.vue';
import { canManageShop, canEdit } from '@/utils/permission';

// 权限控制：门店的创建/编辑/删除仅超管可操作
const allowManageShop = canManageShop();
// Excel配置/工单号规则等：除只读/财务外都可
const allowEditShop = canEdit();

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
      align: 'left',
      minWidth: 160,
      ellipsis: { tooltip: true }
    },
    {
      key: 'code',
      title: '门店编码',
      align: 'left',
      width: 120
    },
    {
      key: 'brand',
      title: '品牌',
      align: 'left',
      width: 100
    },
    {
      key: 'address',
      title: '地址',
      align: 'left',
      minWidth: 160,
      ellipsis: { tooltip: true }
    },
    {
      key: 'phone',
      title: '电话',
      align: 'left',
      width: 120
    },
    {
      key: 'standardTemplate',
      title: '标准模板',
      align: 'left',
      width: 180,
      render: (row: any) => {
        if (row.standardTemplate?.name) {
          return <NTag type="success" size="small">{row.standardTemplate.name}</NTag>;
        }
        return (
          <NSpace align="center" size={4}>
            <NTag size="small" type="warning">未关联</NTag>
            {allowManageShop && showTemplateSelect.value === row.id ? (
              <NSelect
                size="small"
                style="width: 140px"
                placeholder="选择模板"
                options={templates.value.map(t => ({ label: t.version ? `${t.name}(v${t.version})` : t.name, value: t.id }))}
                loading={associating.value === row.id}
                onUpdateValue={(val: string) => handleAssociateTemplate(row.id, val)}
                onBlur={() => { showTemplateSelect.value = ''; }}
              />
            ) : allowManageShop ? (
              <NButton type="primary" text size="tiny" onClick={() => { showTemplateSelect.value = row.id; }}>
                关联
              </NButton>
            ) : null}
          </NSpace>
        );
      }
    },
    {
      key: 'status',
      title: '状态',
      align: 'center',
      width: 90,
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
      width: 130,
      fixed: 'right',
      render: (row: any) => {
        const moreOptions = buildActionOptions(row);
        return (
          <div class="flex-center gap-8px">
            {allowManageShop && (
              <NButton type="primary" ghost size="small" onClick={() => edit(row.id)}>
                编辑
              </NButton>
            )}
            {moreOptions.length > 0 && (
              <NDropdown
                trigger="click"
                options={moreOptions}
                onSelect={(key: string) => handleActionSelect(key, row)}
              >
                <NButton size="small">更多</NButton>
              </NDropdown>
            )}
          </div>
        );
      }
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

// 工单号规则弹窗
const orderNoRulesVisible = ref(false);
const orderNoRulesShopId = ref('');
const orderNoRulesShopName = ref('');

function openOrderNoRulesEditor(row: any) {
  orderNoRulesShopId.value = row.id;
  orderNoRulesShopName.value = row.name;
  orderNoRulesVisible.value = true;
}

// Excel 配置弹窗
const excelConfigVisible = ref(false);
const excelConfigShopId = ref('');
const excelConfigShopName = ref('');

function openExcelConfigEditor(row: any) {
  excelConfigShopId.value = row.id;
  excelConfigShopName.value = row.name;
  excelConfigVisible.value = true;
}

// 一键关联模板
const templates = ref<{ id: string; name: string; version: string }[]>([]);
const associating = ref<string>(''); // 正在关联的门店ID

async function loadTemplates() {
  const { data, error } = await fetchStandardTemplateList();
  if (!error && data) {
    templates.value = data.map((t: any) => ({ id: t.id, name: t.name, version: t.version || '' }));
  }
}
loadTemplates();

const showTemplateSelect = ref<string>(''); // 弹出模板选择器的门店ID

async function handleAssociateTemplate(shopId: string, templateId: string) {
  if (!templateId) return;
  associating.value = shopId;
  const { error } = await applyTemplateToShop(templateId, shopId);
  associating.value = '';
  if (error) return;
  window.$message?.success('模板关联成功');
  showTemplateSelect.value = '';
  await getDataByPage();
}

async function handleDelete(id: string) {
  const { error } = await deletePaintShop(id);
  if (error) return;
  window.$message?.success('删除成功');
  await onDeleted();
}

// 操作列“更多”下拉项（仅在有权限时展示）
function buildActionOptions(row: any) {
  const opts: { label: string; key: string }[] = [];
  if (allowEditShop) {
    opts.push({ label: 'Excel 配置', key: 'excel' });
    opts.push({ label: '工单号规则', key: 'orderNo' });
  }
  if (allowManageShop) {
    opts.push({ label: '删除', key: 'delete' });
  }
  return opts;
}

function handleActionSelect(key: string, row: any) {
  if (key === 'excel') {
    openExcelConfigEditor(row);
  } else if (key === 'orderNo') {
    openOrderNoRulesEditor(row);
  } else if (key === 'delete') {
    (window as any).$dialog?.warning({
      title: '删除门店',
      content: `确认删除门店「${row.name}」？该操作不可恢复。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => handleDelete(row.id)
    });
  }
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
        >
          <template v-if="allowManageShop" #default>
            <NButton size="small" ghost type="primary" @click="handleAdd">
              <template #icon>
                <icon-ic-round-plus class="text-icon" />
              </template>
              新增
            </NButton>
          </template>
        </TableHeaderOperation>
      </template>

      <NSpace align="center" :wrap="true" :size="[16, 12]" class="mb-12px">
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap;">门店名称</NText>
          <NInput
            :value="searchParams.name || ''"
            placeholder="搜索门店名称"
            clearable
            style="width: 180px"
            @update:value="(val: string) => { searchParams.name = val || undefined; }"
            @keyup.enter="getDataByPage()"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap;">品牌</NText>
          <NInput
            :value="searchParams.brand || ''"
            placeholder="搜索品牌"
            clearable
            style="width: 140px"
            @update:value="(val: string) => { searchParams.brand = val || undefined; }"
            @keyup.enter="getDataByPage()"
          />
        </NSpace>
        <NButton type="primary" @click="getDataByPage()">搜索</NButton>
        <NButton @click="resetSearchParams(); getDataByPage()">重置</NButton>
      </NSpace>

      <NAlert type="info" class="mb-12px">
        未关联模板的门店可直接点击"关联"按钮一键选择模板，无需进入编辑页面。
      </NAlert>

      <NDataTable
        v-model:checked-row-keys="checkedRowKeys"
        :columns="columns"
        :data="data"
        size="small"
        striped
        :flex-height="true"
        :scroll-x="1180"
        :loading="loading"
        remote
        :row-key="(row: any) => row.id"
        :pagination="mobilePagination"
        class="sm:h-full paint-table"
      >
        <template #empty>
          <EmptyState description="暂无门店数据">
            <template #action>
              <NButton v-if="allowManageShop" text type="primary" size="small" @click="handleAdd">
                点击新增门店
              </NButton>
            </template>
          </EmptyState>
        </template>
      </NDataTable>

      <ShopOperateDrawer
        v-model:visible="drawerVisible"
        :operate-type="operateType"
        :row-data="editingData"
        @submitted="getDataByPage"
      />

      <OrderNoRulesModal
        v-model:show="orderNoRulesVisible"
        :shop-id="orderNoRulesShopId"
        :shop-name="orderNoRulesShopName"
      />

      <ExcelConfigModal
        v-model:show="excelConfigVisible"
        :shop-id="excelConfigShopId"
        :shop-name="excelConfigShopName"
      />
    </NCard>
  </div>
</template>

<style scoped>
.paint-table :deep(.n-data-table-tr:hover .n-data-table-td) {
  background-color: color-mix(in srgb, rgb(var(--primary-color)) 8%, transparent);
}
</style>
