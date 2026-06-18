<script setup lang="tsx">
import { NButton, NPopconfirm, NTag, NSpace, NImage, NCard, NStatistic, NProgress, NAlert, NDivider, NModal, NEmpty, NInputGroup, NGridItem, NText } from 'naive-ui';
import { ref, computed } from 'vue';
import {
  fetchWorkOrderPage,
  deleteWorkOrder,
  fetchPaintShopList,
  fetchWorkOrderById,
  quickCreateWorkOrder,
  auditWorkOrder,
  unauditWorkOrder,
  findDuplicateOrders,
  mergeWorkOrders,
  getSettlementHistory,
  importWorkOrderExcel,
  exportWorkOrderExcel,
  downloadWorkOrderTemplate,
  detectExcelTemplate,
  saveExcelTemplate,
  getExcelTemplateConfig
} from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import { $t } from '@/locales';
import { compressDualImage } from '@/utils/image-compress';
import WorkOrderOperateDrawer from './modules/work-order-operate-drawer.vue';

const shops = ref<{ id: string; name: string; code: string; brand?: string; standardTemplateId?: string; standardTemplate?: { id: string; name: string } }[]>([]);
const showDetail = ref(false);
const currentOrder = ref<any>(null);
const selectedShopId = ref<string | null>(null);

// 当前选中门店是否未关联模板
const selectedShopHasNoTemplate = computed(() => {
  if (!selectedShopId.value) return false;
  const shop = shops.value.find(s => s.id === selectedShopId.value);
  return !shop?.standardTemplateId;
});

// 默认当月结算月份
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 合并工单相关
const showMergeModal = ref(false);
const mergeTargetId = ref('');
const mergeOrderNo = ref('');
const duplicateOrders = ref<any[]>([]);
const mergeLoading = ref(false);
const mergeSelectedIds = ref<string[]>([]);

function toggleMergeSelect(orderId: string, checked: boolean) {
  if (checked) {
    if (!mergeSelectedIds.value.includes(orderId)) {
      mergeSelectedIds.value.push(orderId);
    }
  } else {
    mergeSelectedIds.value = mergeSelectedIds.value.filter(id => id !== orderId);
  }
}

// 结算历史相关
const showSettlementModal = ref(false);
const settlementOrderId = ref('');
const settlementOrderNo = ref('');
const settlementHistory = ref<any[]>([]);

async function openMergeModal(orderNo: string, currentId: string) {
  mergeTargetId.value = currentId;
  mergeOrderNo.value = orderNo;
  mergeSelectedIds.value = [];
  const { data, error } = await findDuplicateOrders(orderNo, currentId);
  if (!error && data) {
    duplicateOrders.value = data;
    // 默认全选
    mergeSelectedIds.value = data.map((o: any) => o.id);
  }
  showMergeModal.value = true;
}

async function handleMerge(sourceIds: string[]) {
  mergeLoading.value = true;
  const { error } = await mergeWorkOrders(mergeTargetId.value, sourceIds);
  mergeLoading.value = false;
  if (error) return;
  window.$message?.success('工单合并成功');
  showMergeModal.value = false;
  mergeSelectedIds.value = [];
  await getDataByPage();
}

async function openSettlementHistory(orderId: string, orderNo: string) {
  settlementOrderId.value = orderId;
  settlementOrderNo.value = orderNo;
  const { data, error } = await getSettlementHistory(orderId);
  if (!error && data) {
    settlementHistory.value = data;
  }
  showSettlementModal.value = true;
}

// 导入导出相关
const fileInputRef = ref<HTMLInputElement | null>(null);
const importLoading = ref(false);
const showImportResult = ref(false);
const importResult = ref<{ success: number; failed: number; errors: string[] } | null>(null);

function triggerImport() {
  fileInputRef.value?.click();
}

async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !selectedShopId.value) return;
  input.value = '';

  importLoading.value = true;
  const { data, error } = await importWorkOrderExcel(file, selectedShopId.value, searchParams.settlementMonth);
  importLoading.value = false;
  if (error) return;
  if (data) {
    importResult.value = data;
    showImportResult.value = true;
    const msg = `导入完成：成功 ${data.success} 条，失败 ${data.failed} 条`;
    if (data.failed > 0) {
      window.$message?.warning(msg);
    } else {
      window.$message?.success(msg);
    }
    await getDataByPage();
  }
}

async function handleExport() {
  if (!selectedShopId.value) return;
  const { data, error } = await exportWorkOrderExcel(selectedShopId.value, searchParams.settlementMonth);
  if (error) return;
  if (data) {
    const url = window.URL.createObjectURL(data as any);
    const a = document.createElement('a');
    a.href = url;
    const shopName = shops.value.find(s => s.id === selectedShopId.value)?.name || '喷漆';
    a.download = `${shopName}_台账_${searchParams.settlementMonth || '全部'}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}

async function handleDownloadTemplate() {
  if (!selectedShopId.value) return;
  const { data, error } = await downloadWorkOrderTemplate(selectedShopId.value);
  if (error) return;
  if (data) {
    const url = window.URL.createObjectURL(data as any);
    const a = document.createElement('a');
    a.href = url;
    const shopName = shops.value.find(s => s.id === selectedShopId.value)?.name || '喷漆';
    a.download = `${shopName}_导入模板.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}

// 模板配置相关
const showTemplateConfigModal = ref(false);
const templateConfig = ref<any>(null);
const templateDetectLoading = ref(false);
const templateSaveLoading = ref(false);
const templateFileInputRef = ref<HTMLInputElement | null>(null);

async function openTemplateConfig() {
  if (!selectedShopId.value) return;
  const { data, error } = await getExcelTemplateConfig(selectedShopId.value);
  if (!error && data) {
    templateConfig.value = data;
  } else {
    templateConfig.value = null;
  }
  showTemplateConfigModal.value = true;
}

function triggerTemplateDetect() {
  templateFileInputRef.value?.click();
}

async function handleTemplateDetectFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !selectedShopId.value) return;
  input.value = '';

  templateDetectLoading.value = true;
  const { data, error } = await detectExcelTemplate(file, selectedShopId.value);
  templateDetectLoading.value = false;
  if (error) return;
  if (data) {
    templateConfig.value = data;
    window.$message?.success(`自动识别成功，检测到 ${data.items?.length || 0} 个项目列`);
  }
}

async function handleSaveTemplateConfig() {
  if (!selectedShopId.value || !templateConfig.value) return;
  templateSaveLoading.value = true;
  const { error } = await saveExcelTemplate(selectedShopId.value, templateConfig.value);
  templateSaveLoading.value = false;
  if (error) return;
  window.$message?.success('模板配置保存成功');
  showTemplateConfigModal.value = false;
}

// 快速录入
const showQuickCreate = ref(false);
const quickShopId = ref<string>('');
const quickSettlementMonth = ref<string>(getCurrentMonth());

// 快速录入门店模板状态
const quickShopHasTemplate = computed(() => {
  if (!quickShopId.value) return null;
  const shop = shops.value.find(s => s.id === quickShopId.value);
  return shop?.standardTemplateId ? shop.standardTemplate?.name || '已关联' : false;
});

// 批量上传进度
const batchUploading = ref(false);
const batchTotal = ref(0);
const batchDone = ref(0);
const createdOrderIds = ref<string[]>([]);

// 图片URL拼接：通过Vite代理访问，避免跨域
function getImageUrl(url: string) {
  if (!url || url.startsWith('http') || url.startsWith('blob:')) return url;
  return `/proxy-demo${url}`;
}

async function loadShops() {
  const { data, error } = await fetchPaintShopList();
  if (!error && data) {
    shops.value = data;
  }
}
loadShops();

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
  apiFn: fetchWorkOrderPage,
  showTotal: true,
  apiParams: {
    current: 1,
    size: 10,
    shopId: undefined as string | undefined,
    plateNumber: undefined as string | undefined,
    customerName: undefined as string | undefined,
    settlementMonth: getCurrentMonth() as string | undefined
  },
  columns: () => [
    {
      type: 'selection',
      align: 'center',
      width: 40
    },
    {
      key: 'index',
      title: '序号',
      align: 'center',
      width: 50
    },
    {
      key: 'orderNo',
      title: '工单号',
      align: 'center',
      minWidth: 140,
      ellipsis: { tooltip: true },
      render: (row: any) => (
        <NSpace align="center" size={4}>
          <span>{row.orderNo}</span>
          {row._isDuplicate && (
            <NTag type="warning" size="small" round>{row._duplicateCount}条重复</NTag>
          )}
        </NSpace>
      )
    },
    {
      key: 'shopName',
      title: '门店',
      align: 'center',
      minWidth: 100,
      ellipsis: { tooltip: true },
      render: (row: any) => row.shop?.name || '-'
    },
    {
      key: 'plateNumber',
      title: '车牌号',
      align: 'center',
      width: 100
    },
    {
      key: 'carModel',
      title: '车型',
      align: 'center',
      minWidth: 80,
      ellipsis: { tooltip: true }
    },
    {
      key: 'customerName',
      title: '客户',
      align: 'center',
      width: 70
    },
    {
      key: 'orderDate',
      title: '日期',
      align: 'center',
      width: 90,
      render: (row: any) => new Date(row.orderDate).toLocaleDateString()
    },
    {
      key: 'settlementMonth',
      title: '结算月份',
      align: 'center',
      width: 110,
      render: (row: any) => (
        <NSpace align="center" size={4}>
          {row.settlementMonth ? <span>{row.settlementMonth}</span> : <NTag size="small" type="warning">未结算</NTag>}
          {row.settlements?.length > 1 && (
            <NButton type="info" text size="tiny" onClick={() => openSettlementHistory(row.id, row.orderNo)}>
              {row.settlements.length}次
            </NButton>
          )}
        </NSpace>
      )
    },
    {
      key: 'totalPaintCount',
      title: '幅数',
      align: 'center',
      width: 60,
      render: (row: any) => <NTag type="info" size="small" round>{Number(row.totalPaintCount).toFixed(1)}</NTag>
    },
    {
      key: 'status',
      title: '状态',
      align: 'center',
      width: 70,
      render: (row: any) => {
        const statusMap: Record<string, NaiveUI.ThemeColor> = {
          PENDING: 'warning',
          IN_PROGRESS: 'info',
          COMPLETED: 'success',
          CANCELLED: 'error'
        };
        const labelMap: Record<string, string> = {
          PENDING: '待处理',
          IN_PROGRESS: '进行中',
          COMPLETED: '已完成',
          CANCELLED: '已取消'
        };
        return <NTag type={statusMap[row.status] || 'default'} size="small">{labelMap[row.status] || row.status}</NTag>;
      }
    },
    {
      key: 'isAudited',
      title: '审核',
      align: 'center',
      width: 60,
      render: (row: any) => row.isAudited
        ? <NTag type="success" size="small">已审</NTag>
        : <NTag size="small">未审</NTag>
    },
    {
      key: 'operate',
      title: '操作',
      align: 'center',
      width: 220,
      render: (row: any) => (
        <div class="flex-center gap-4px flex-wrap">
          {!row.isAudited && (
            <NButton type="primary" text size="small" onClick={() => edit(row.id)}>
              编辑
            </NButton>
          )}
          <NButton type="info" text size="small" onClick={() => viewDetail(row.id)}>
            查看
          </NButton>
          {row._isDuplicate && !row.isAudited && (
            <NButton type="warning" text size="small" onClick={() => openMergeModal(row.orderNo, row.id)}>
              合并
            </NButton>
          )}
          {row.isAudited ? (
            <NPopconfirm onPositiveClick={() => handleUnaudit(row.id)}>
              {{
                default: () => '确认取消审核？',
                trigger: () => (
                  <NButton type="warning" text size="small">
                    取审
                  </NButton>
                )
              }}
            </NPopconfirm>
          ) : (
            <NPopconfirm onPositiveClick={() => handleAudit(row.id)}>
              {{
                default: () => '确认审核？',
                trigger: () => (
                  <NButton type="success" text size="small">
                    审核
                  </NButton>
                )
              }}
            </NPopconfirm>
          )}
          {!row.isAudited && (
            <NPopconfirm onPositiveClick={() => handleDelete(row.id)}>
              {{
                default: () => '确认删除此工单？',
                trigger: () => (
                  <NButton type="error" text size="small">
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
  onBatchDeleted,
  onDeleted
} = useTableOperate(data, getData);

function edit(id: string) {
  handleEdit(id);
}

async function handleDelete(id: string) {
  const { error } = await deleteWorkOrder(id);
  if (error) return;
  window.$message?.success('删除成功');
  await onDeleted();
}

async function handleAudit(id: string) {
  const { error } = await auditWorkOrder(id);
  if (error) return;
  window.$message?.success('审核成功');
  await getDataByPage();
}

async function handleUnaudit(id: string) {
  const { error } = await unauditWorkOrder(id);
  if (error) return;
  window.$message?.success('已取消审核');
  await getDataByPage();
}

async function viewDetail(id: string) {
  const { data: resData, error } = await fetchWorkOrderById(id);
  if (!error && resData) {
    currentOrder.value = resData;
    showDetail.value = true;
  }
}

const totalPaintCount = computed(() => {
  return data.value.reduce((sum: number, item: any) => sum + Number(item.totalPaintCount || 0), 0).toFixed(1);
});

// 批量快速上传
async function handleBatchQuickUpload({ file }: { file: File }) {
  if (!quickShopId.value) {
    window.$message?.warning('请先选择门店');
    return;
  }

  // 首次上传时初始化进度
  if (!batchUploading.value) {
    batchUploading.value = true;
    batchTotal.value = 0;
    batchDone.value = 0;
  }
  batchTotal.value++;

  try {
    const { hd, thumbnail } = await compressDualImage(file);

    const formData = new FormData();
    formData.append('shopId', quickShopId.value);
    if (quickSettlementMonth.value) {
      formData.append('settlementMonth', quickSettlementMonth.value);
    }
    formData.append('file', hd);
    formData.append('thumbnail', thumbnail);

    const { data: resData, error } = await quickCreateWorkOrder(quickShopId.value, formData);
    batchDone.value++;

    if (!error && resData) {
      // 记录新创建的工单ID，用于完成后引导编辑
      createdOrderIds.value.push(resData.id);
      if (batchDone.value === batchTotal.value) {
        const count = batchTotal.value;
        window.$message?.success(`${count}个工单创建成功！请确认OCR识别结果`);
        batchUploading.value = false;
        batchTotal.value = 0;
        batchDone.value = 0;
        showQuickCreate.value = false;
        await getDataByPage();
        // 自动打开第一个新工单的编辑界面
        if (createdOrderIds.value.length > 0) {
          edit(createdOrderIds.value[0]);
          createdOrderIds.value = [];
        }
      }
    } else {
      window.$message?.error('创建工单失败');
      if (batchDone.value === batchTotal.value) {
        batchUploading.value = false;
        batchTotal.value = 0;
        batchDone.value = 0;
        await getDataByPage();
      }
    }
  } catch {
    batchDone.value++;
    window.$message?.error('图片处理失败');
    if (batchDone.value === batchTotal.value) {
      batchUploading.value = false;
      batchTotal.value = 0;
      batchDone.value = 0;
      await getDataByPage();
    }
  }
}
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <NCard :bordered="false" size="small">
      <NSpace align="center" :wrap="true" :size="[16, 12]">
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap;">门店</NText>
          <NSelect
            v-model:value="selectedShopId"
            placeholder="全部门店"
            :options="shops.map(s => ({ label: s.name, value: s.id }))"
            clearable
            style="width: 180px"
            @update:value="(val: string | null) => { searchParams.shopId = val ?? undefined; getDataByPage(); }"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap;">结算月份</NText>
          <NDatePicker
            :formatted-value="searchParams.settlementMonth || undefined"
            @update:formatted-value="(val: string | undefined) => { searchParams.settlementMonth = val || undefined; getDataByPage(); }"
            type="month"
            value-format="yyyy-MM"
            clearable
            style="width: 150px"
            placeholder="选择月份"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap;">车牌号</NText>
          <NInput
            :value="searchParams.plateNumber || ''"
            @update:value="(val: string) => { searchParams.plateNumber = val || undefined; }"
            placeholder="搜索车牌号"
            clearable
            style="width: 130px"
            @keyup.enter="getDataByPage()"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap;">客户</NText>
          <NInput
            :value="searchParams.customerName || ''"
            @update:value="(val: string) => { searchParams.customerName = val || undefined; }"
            placeholder="搜索客户名"
            clearable
            style="width: 120px"
            @keyup.enter="getDataByPage()"
          />
        </NSpace>
        <NButton type="primary" @click="getDataByPage()">搜索</NButton>
        <NButton @click="resetSearchParams(); selectedShopId = null; getDataByPage();">重置</NButton>
        <NDivider vertical />
        <NButton type="warning" @click="showQuickCreate = true">快速录入</NButton>
        <NButton type="info" @click="handleDownloadTemplate" :disabled="!selectedShopId">下载模板</NButton>
        <NButton type="success" @click="triggerImport" :disabled="!selectedShopId">导入</NButton>
        <NButton @click="handleExport" :disabled="!selectedShopId">导出</NButton>
        <NButton type="default" @click="openTemplateConfig" :disabled="!selectedShopId">模板配置</NButton>
        <input ref="fileInputRef" type="file" accept=".xlsx,.xls" style="display:none" @change="handleImportFile" />
      </NSpace>
    </NCard>

    <NAlert v-if="selectedShopHasNoTemplate" type="warning" :bordered="false" class="mb-0">
      当前门店未关联标准模板，无法正常导入和快速录入。请先到「门店管理」页面为该门店关联标准模板。
    </NAlert>

    <NCard title="喷漆工单管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header>
        <NSpace align="center" :size="8">
          <span>喷漆工单管理</span>
          <NTag size="tiny" type="info" round>已审核工单不可编辑/删除</NTag>
        </NSpace>
      </template>
      <template #header-extra>
        <NSpace align="center" :size="16">
          <NStatistic label="当前页总幅数" :value="totalPaintCount" style="min-width: 120px" />
          <TableHeaderOperation
            v-model:columns="columnChecks"
            :disabled-delete="checkedRowKeys.length === 0"
            :loading="loading"
            @add="handleAdd"
            @refresh="getData"
          />
        </NSpace>
      </template>

      <NDataTable
        v-model:checked-row-keys="checkedRowKeys"
        :columns="columns"
        :data="data"
        size="small"
        :flex-height="true"
        :scroll-x="1200"
        :loading="loading"
        remote
        :row-key="(row: any) => row.id"
        :pagination="mobilePagination"
        class="sm:h-full"
      />

      <WorkOrderOperateDrawer
        v-model:visible="drawerVisible"
        :operate-type="operateType"
        :row-data="editingData"
        @submitted="getDataByPage"
      />
    </NCard>

    <NDrawer v-model:show="showDetail" :width="720" placement="right">
      <NDrawerContent :title="'工单详情 - ' + (currentOrder?.orderNo || '')" closable>
        <template v-if="currentOrder">
          <NGrid :cols="2" :x-gap="16" class="mb-16px">
            <NGi>
              <NDescriptions label-placement="left" :column="1" bordered size="small">
                <NDescriptionsItem label="工单号">{{ currentOrder.orderNo }}</NDescriptionsItem>
                <NDescriptionsItem label="门店">{{ currentOrder.shop?.name }}</NDescriptionsItem>
                <NDescriptionsItem label="车牌号">{{ currentOrder.plateNumber }}</NDescriptionsItem>
                <NDescriptionsItem label="车型">{{ currentOrder.carModel }}</NDescriptionsItem>
              </NDescriptions>
            </NGi>
            <NGi>
              <NDescriptions label-placement="left" :column="1" bordered size="small">
                <NDescriptionsItem label="客户">{{ currentOrder.customerName }}</NDescriptionsItem>
                <NDescriptionsItem label="电话">{{ currentOrder.phone || '-' }}</NDescriptionsItem>
                <NDescriptionsItem label="日期">{{ new Date(currentOrder.orderDate).toLocaleDateString() }}</NDescriptionsItem>
                <NDescriptionsItem label="总幅数">
                  <NTag type="success" size="large">{{ Number(currentOrder.totalPaintCount).toFixed(1) }} 幅</NTag>
                </NDescriptionsItem>
                <NDescriptionsItem label="审核状态">
                  {currentOrder.isAudited
                    ? <NTag type="success">已审核 {{ currentOrder.auditedBy ? `(${currentOrder.auditedBy})` : '' }}</NTag>
                    : <NTag>未审核</NTag>
                  }
                </NDescriptionsItem>
              </NDescriptions>
            </NGi>
          </NGrid>

          <NH3 prefix="bar" class="mb-8px">喷漆项目</NH3>
          <NDataTable
            :columns="[
              { key: 'categoryName', title: '项目名称', render: (row: any) => row.alias || row.category?.name || '-' },
              { key: 'quantity', title: '数量', width: 80, align: 'center' },
              { key: 'paintCount', title: '幅数', width: 100, align: 'center', render: (row: any) => Number(row.paintCount).toFixed(2) + ' 幅' },
              { key: 'specialPaint', title: '特殊车漆', width: 120, align: 'center', render: (row: any) => row.specialPaint ? row.specialPaint.name + ' x' + Number(row.specialPaintMultiplier).toFixed(1) : '-' },
              { key: 'isNewPart', title: '新件', width: 70, align: 'center', render: (row: any) => row.isNewPart ? '是' : '否' }
            ]"
            :data="currentOrder.items || []"
            size="small"
            :bordered="true"
            class="mb-16px"
          />

          <NH3 prefix="bar" class="mb-8px">工单图片</NH3>
          <NSpace v-if="currentOrder.images?.length" :wrap="true">
            <div v-for="img in currentOrder.images" :key="img.id" class="relative group">
              <NImage
                :src="getImageUrl(img.url)"
                :width="150"
                :height="110"
                object-fit="cover"
                style="border-radius: 6px; border: 1px solid #e0e0e0;"
              />
              <NTag
                :type="img.imageType === 'BEFORE' ? 'warning' : img.imageType === 'DURING' ? 'info' : 'success'"
                size="small"
                round
                style="position: absolute; top: 4px; left: 4px;"
              >
                {{ img.imageType === 'BEFORE' ? '施工前' : img.imageType === 'DURING' ? '施工中' : '完工后' }}
              </NTag>
            </div>
          </NSpace>
          <NEmpty v-else description="暂无图片" />
        </template>
      </NDrawerContent>
    </NDrawer>

    <!-- 快速录入弹窗 -->
    <NModal v-model:show="showQuickCreate" preset="card" title="快速录入工单" style="width: 480px" :mask-closable="false">
      <NSpace vertical :size="16">
        <NFormItem label="选择门店" :show-feedback="false">
          <NSelect
            v-model:value="quickShopId"
            :options="shops.map(s => ({ label: `${s.name} (${s.brand || ''})`, value: s.id }))"
            placeholder="请选择门店"
          />
        </NFormItem>

        <NAlert v-if="quickShopHasTemplate === false" type="warning" :bordered="false">
          该门店尚未关联标准模板，工单幅数将默认为0。请先到门店管理关联模板。
        </NAlert>
        <NAlert v-else-if="quickShopHasTemplate" type="success" :bordered="false">
          已关联模板：{{ quickShopHasTemplate }}
        </NAlert>

        <NFormItem label="结算月份" :show-feedback="false">
          <NDatePicker
            :formatted-value="quickSettlementMonth || undefined"
            @update:formatted-value="(val: string | undefined) => quickSettlementMonth = val || ''"
            type="month"
            value-format="yyyy-MM"
            style="width: 100%"
            clearable
            placeholder="选择结算月份"
          />
        </NFormItem>

        <NUpload
          :max="99"
          accept="image/*"
          :show-file-list="false"
          :disabled="!quickShopId"
          :custom-request="({ file }) => handleBatchQuickUpload({ file: file.file as File })"
          multiple
        >
          <NButton type="primary" :loading="batchUploading" :disabled="!quickShopId" block>
            <template #icon><icon-ic-round-add-photo-alternate /></template>
            选择图片上传（一张图片=一个工单）
          </NButton>
        </NUpload>

        <NAlert type="info" :bordered="false">
          上传图片后直接创建工单，OCR在后端自动识别。编辑工单时可确认OCR识别结果。
        </NAlert>

        <NProgress
          v-if="batchUploading && batchTotal > 0"
          type="line"
          :percentage="Math.round((batchDone / batchTotal) * 100)"
          :indicator-placement="'inside'"
          processing
        />
      </NSpace>
    </NModal>

    <!-- 合并工单弹窗 -->
    <NModal v-model:show="showMergeModal" preset="card" :title="`合并重复工单 - ${mergeOrderNo}`" style="width: 600px" :mask-closable="false">
      <NAlert type="warning" :bordered="false" class="mb-12px">
        检测到工单号 {{ mergeOrderNo }} 存在多条记录，请勾选要合并到当前工单的记录。合并后，被合并工单的项目和图片将转移到当前工单，源工单将被删除。
      </NAlert>
      <NEmpty v-if="duplicateOrders.length === 0" description="没有其他重复工单" />
      <template v-else>
        <NSpace vertical :size="8">
          <NCard v-for="order in duplicateOrders" :key="order.id" size="small" :bordered="true">
            <NSpace justify="space-between" align="center">
              <NCheckbox :checked="mergeSelectedIds.includes(order.id)" @update:checked="(val: boolean) => toggleMergeSelect(order.id, val)">
                <NSpace vertical :size="4">
                  <NText strong>{{ order.orderNo }}</NText>
                  <NText depth="3">{{ order.shop?.name }} | {{ order.plateNumber || '无车牌' }} | 幅数: {{ Number(order.totalPaintCount).toFixed(1) }}</NText>
                  <NText depth="3">项目数: {{ order.items?.length || 0 }} | 图片数: {{ order.images?.length || 0 }}</NText>
                </NSpace>
              </NCheckbox>
            </NSpace>
          </NCard>
        </NSpace>
      </template>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showMergeModal = false">关闭</NButton>
          <NButton
            type="warning"
            :loading="mergeLoading"
            :disabled="mergeSelectedIds.length === 0"
            @click="handleMerge(mergeSelectedIds)"
          >
            合并选中的 {{ mergeSelectedIds.length }} 条工单
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 结算历史弹窗 -->
    <NModal v-model:show="showSettlementModal" preset="card" :title="`结算历史 - ${settlementOrderNo}`" style="width: 500px">
      <NEmpty v-if="settlementHistory.length === 0" description="暂无结算记录" />
      <NSpace v-else vertical :size="8">
        <NAlert type="info" :bordered="false" class="mb-8px">
          此工单已结算 {{ settlementHistory.length }} 次，一个工单可能分多个月份结算（如当月做完，下月追加部位）。
        </NAlert>
        <NCard v-for="(record, index) in settlementHistory" :key="record.id" size="small" :bordered="true">
          <NSpace justify="space-between" align="center">
            <NSpace vertical :size="4">
              <NText strong>第{{ settlementHistory.length - index }}次结算</NText>
              <NText depth="3">结算月份: {{ record.settlementMonth }} | 幅数: {{ Number(record.paintCount).toFixed(1) }} | 项目数: {{ record.itemCount }}</NText>
              <NText v-if="record.remark" depth="3">备注: {{ record.remark }}</NText>
              <NText depth="3">{{ new Date(record.createdAt).toLocaleString() }}</NText>
            </NSpace>
          </NSpace>
        </NCard>
      </NSpace>
      <template #footer>
        <NButton @click="showSettlementModal = false">关闭</NButton>
      </template>
    </NModal>

    <!-- 模板配置弹窗 -->
    <NModal v-model:show="showTemplateConfigModal" preset="card" title="Excel模板配置" style="width: 700px" :mask-closable="false">
      <NAlert type="info" :bordered="false" class="mb-12px">
        每家门店的台账格式可能不同。上传该门店的Excel文件，系统会自动识别列映射关系。也可以手动调整后保存。
      </NAlert>
      <NSpace class="mb-12px">
        <NButton type="primary" :loading="templateDetectLoading" @click="triggerTemplateDetect">
          上传Excel自动识别
        </NButton>
        <input ref="templateFileInputRef" type="file" accept=".xlsx,.xls" style="display:none" @change="handleTemplateDetectFile" />
      </NSpace>

      <template v-if="templateConfig">
        <NText strong class="mb-8px" style="display:block">基本字段列映射</NText>
        <NGrid :cols="3" :x-gap="8" :y-gap="8" class="mb-12px">
          <NGridItem v-for="(label, key) in { date: '日期', carModel: '车型', plateNumber: '车牌', orderNo: '工单号', paintCount: '副数', remark: '备注' }" :key="key">
            <NInput v-model:value="templateConfig.fields[key]" size="small">
              <template #prefix><NText depth="3" style="font-size:12px">{{ label }}</NText></template>
            </NInput>
          </NGridItem>
        </NGrid>

        <NText strong class="mb-8px" style="display:block">喷漆项目列映射 ({{ templateConfig.items?.length || 0 }}项)</NText>
        <NGrid :cols="4" :x-gap="8" :y-gap="8" class="mb-12px">
          <NGridItem v-for="(item, idx) in templateConfig.items" :key="idx">
            <NInputGroup>
              <NInput v-model:value="item.col" size="small" style="width:50px" placeholder="列" />
              <NInput v-model:value="item.categoryName" size="small" placeholder="项目名" />
            </NInputGroup>
          </NGridItem>
        </NGrid>

        <NText depth="3" style="font-size:12px">数据起始行: {{ templateConfig.dataStartRow }} | 表头行: {{ templateConfig.headerRow }}</NText>
      </template>
      <NEmpty v-else description="暂无配置，请上传Excel文件自动识别" />

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showTemplateConfigModal = false">取消</NButton>
          <NButton type="primary" :loading="templateSaveLoading" :disabled="!templateConfig" @click="handleSaveTemplateConfig">保存配置</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 导入结果弹窗 -->
    <NModal v-model:show="showImportResult" preset="card" title="导入结果" style="width: 600px">
      <template v-if="importResult">
        <NAlert :type="importResult.failed > 0 ? 'warning' : 'success'" :bordered="false" class="mb-12px">
          成功导入 {{ importResult.success }} 条，失败 {{ importResult.failed }} 条
        </NAlert>
        <template v-if="importResult.errors?.length > 0">
          <NText strong class="mb-8px" style="display:block">错误详情：</NText>
          <div style="max-height: 300px; overflow-y: auto; background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 13px;">
            <div v-for="(err, idx) in importResult.errors" :key="idx" style="padding: 2px 0;">
              <NTag type="error" size="small" style="margin-right: 6px">{{ idx + 1 }}</NTag>
              {{ err }}
            </div>
          </div>
        </template>
      </template>
      <template #footer>
        <NButton type="primary" @click="showImportResult = false">知道了</NButton>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>
