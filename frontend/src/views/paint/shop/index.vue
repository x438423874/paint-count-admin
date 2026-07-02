<script setup lang="tsx">
import { NButton, NPopconfirm, NTag, NSpace, NSelect } from 'naive-ui';
import { ref } from 'vue';
import { fetchPaintShopPage, deletePaintShop, fetchStandardTemplateList, applyTemplateToShop } from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import ShopOperateDrawer from './modules/shop-operate-drawer.vue';
import OcrTemplateEditor from './modules/ocr-template-editor.vue';
import OcrFieldLabelsEditor from './modules/ocr-field-labels-editor.vue';
import { canManageShop, canEdit } from '@/utils/permission';

// 权限控制：门店的创建/编辑/删除仅超管可操作
const allowManageShop = canManageShop();
// OCR 模板/字段别名配置：除只读/财务外都可
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
      width: 200,
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
      width: 300,
      render: (row: any) => (
        <div class="flex-center gap-8px">
          {allowManageShop && (
            <NButton type="primary" ghost size="small" onClick={() => edit(row.id)}>
              编辑
            </NButton>
          )}
          {allowEditShop && (
            <NButton type="warning" ghost size="small" onClick={() => openOcrTemplateEditor(row)}>
              OCR模板
            </NButton>
          )}
          {allowEditShop && (
            <NButton type="info" ghost size="small" onClick={() => openFieldLabelsEditor(row)}>
              字段别名
            </NButton>
          )}
          {allowManageShop && (
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

// OCR 模板编辑器
const ocrTemplateVisible = ref(false);
const ocrTemplateShopId = ref('');
const ocrTemplateShopName = ref('');

function openOcrTemplateEditor(row: any) {
  ocrTemplateShopId.value = row.id;
  ocrTemplateShopName.value = row.name;
  ocrTemplateVisible.value = true;
}

// OCR 字段别名编辑器
const fieldLabelsVisible = ref(false);
const fieldLabelsShopId = ref('');
const fieldLabelsShopName = ref('');

function openFieldLabelsEditor(row: any) {
  fieldLabelsShopId.value = row.id;
  fieldLabelsShopName.value = row.name;
  fieldLabelsVisible.value = true;
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

      <NAlert type="info" class="mb-12px">
        未关联模板的门店可直接点击"关联"按钮一键选择模板，无需进入编辑页面。
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

      <OcrTemplateEditor
        v-model:visible="ocrTemplateVisible"
        :shop-id="ocrTemplateShopId"
        :shop-name="ocrTemplateShopName"
      />

      <OcrFieldLabelsEditor
        v-model:visible="fieldLabelsVisible"
        :shop-id="fieldLabelsShopId"
        :shop-name="fieldLabelsShopName"
      />
    </NCard>
  </div>
</template>

<style scoped></style>
