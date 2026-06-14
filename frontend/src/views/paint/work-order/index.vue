<script setup lang="tsx">
import { NButton, NPopconfirm, NTag, NSpace, NImage, NCard, NStatistic, NInput, NSpin } from 'naive-ui';
import { ref, computed } from 'vue';
import {
  fetchWorkOrderPage,
  deleteWorkOrder,
  fetchPaintShopList,
  fetchWorkOrderById,
  quickCreateWorkOrder,
  auditWorkOrder,
  unauditWorkOrder
} from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import { $t } from '@/locales';
import { recognizeWorkOrderImage } from '@/utils/ocr';
import { compressDualImage } from '@/utils/image-compress';
import WorkOrderOperateDrawer from './modules/work-order-operate-drawer.vue';

const shops = ref<{ id: string; name: string; code: string; brand?: string }[]>([]);
const showDetail = ref(false);
const currentOrder = ref<any>(null);
const selectedShopId = ref<string | null>(null);

// 快速录入
const showQuickCreate = ref(false);
const quickShopId = ref<string>('');
const quickSettlementMonth = ref<string>('');
const quickUploading = ref(false);

// OCR 确认弹窗
const showOcrConfirm = ref(false);
const ocrRecognizing = ref(false);
const ocrResult = ref({ plateNumber: '', orderNo: '', rawText: '' });
const ocrOriginalFile = ref<File | null>(null);

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
    settlementMonth: undefined as string | undefined
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
      key: 'orderNo',
      title: '工单号',
      align: 'center',
      minWidth: 140,
      ellipsis: { tooltip: true }
    },
    {
      key: 'shopName',
      title: '门店',
      align: 'center',
      minWidth: 120,
      render: (row: any) => row.shop?.name || '-'
    },
    {
      key: 'plateNumber',
      title: '车牌号',
      align: 'center',
      width: 110
    },
    {
      key: 'carModel',
      title: '车型',
      align: 'center',
      minWidth: 100,
      ellipsis: { tooltip: true }
    },
    {
      key: 'customerName',
      title: '客户',
      align: 'center',
      width: 90
    },
    {
      key: 'orderDate',
      title: '工单日期',
      align: 'center',
      width: 100,
      render: (row: any) => new Date(row.orderDate).toLocaleDateString()
    },
    {
      key: 'settlementMonth',
      title: '结算月份',
      align: 'center',
      width: 100,
      render: (row: any) => row.settlementMonth || <NTag size="small" type="warning">未结算</NTag>
    },
    {
      key: 'totalPaintCount',
      title: '总幅数',
      align: 'center',
      width: 80,
      render: (row: any) => <NTag type="info" round>{Number(row.totalPaintCount).toFixed(1)}</NTag>
    },
    {
      key: 'status',
      title: '状态',
      align: 'center',
      width: 80,
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
        return <NTag type={statusMap[row.status] || 'default'}>{labelMap[row.status] || row.status}</NTag>;
      }
    },
    {
      key: 'isAudited',
      title: '审核',
      align: 'center',
      width: 80,
      render: (row: any) => row.isAudited
        ? <NTag type="success" size="small">已审核</NTag>
        : <NTag size="small">未审核</NTag>
    },
    {
      key: 'operate',
      title: '操作',
      align: 'center',
      width: 240,
      render: (row: any) => (
        <div class="flex-center gap-8px">
          {!row.isAudited && (
            <NButton type="primary" ghost size="small" onClick={() => edit(row.id)}>
              编辑
            </NButton>
          )}
          <NButton type="info" ghost size="small" onClick={() => viewDetail(row.id)}>
            查看
          </NButton>
          {row.isAudited ? (
            <NPopconfirm onPositiveClick={() => handleUnaudit(row.id)}>
              {{
                default: () => '确认取消审核？取消后工单将可修改和删除。',
                trigger: () => (
                  <NButton type="warning" ghost size="small">
                    取消审核
                  </NButton>
                )
              }}
            </NPopconfirm>
          ) : (
            <NPopconfirm onPositiveClick={() => handleAudit(row.id)}>
              {{
                default: () => '确认审核？审核后工单将不可修改和删除。',
                trigger: () => (
                  <NButton type="success" ghost size="small">
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

async function handleQuickUpload({ file }: { file: File }) {
  if (!quickShopId.value) {
    window.$message?.warning('请先选择门店');
    return;
  }

  // 保存原图用于 OCR
  ocrOriginalFile.value = file;
  ocrRecognizing.value = true;
  showOcrConfirm.value = true;
  ocrResult.value = { plateNumber: '', orderNo: '', rawText: '' };

  // 用原图进行 OCR 识别
  try {
    const result = await recognizeWorkOrderImage(file);
    ocrResult.value = {
      plateNumber: result.plateNumber || '',
      orderNo: result.orderNo || '',
      rawText: result.rawText || ''
    };
  } catch {
    window.$message?.warning('OCR识别失败，可手动填写后提交');
  } finally {
    ocrRecognizing.value = false;
  }
}

async function confirmQuickCreate() {
  if (!quickShopId.value || !ocrOriginalFile.value) return;

  quickUploading.value = true;

  // 生成双图：高清版(OCR+存档) + 缩略版(展示)
  const { hd, thumbnail } = await compressDualImage(ocrOriginalFile.value);

  const formData = new FormData();
  formData.append('shopId', quickShopId.value);
  if (quickSettlementMonth.value) {
    formData.append('settlementMonth', quickSettlementMonth.value);
  }
  if (ocrResult.value.plateNumber) {
    formData.append('plateNumber', ocrResult.value.plateNumber);
  }
  if (ocrResult.value.orderNo) {
    formData.append('orderNo', ocrResult.value.orderNo);
  }
  formData.append('file', hd);
  formData.append('thumbnail', thumbnail);

  const { data: resData, error } = await quickCreateWorkOrder(quickShopId.value, formData);
  quickUploading.value = false;

  if (!error && resData) {
    window.$message?.success(`工单 ${resData.orderNo} 创建成功`);
    showOcrConfirm.value = false;
    ocrOriginalFile.value = null;
    await getDataByPage();
  } else {
    window.$message?.error('快速创建工单失败');
  }
}
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <NCard :bordered="false" size="small">
      <NSpace align="end" :wrap="true" :size="[16, 12]">
        <NSelect
          v-model:value="selectedShopId"
          placeholder="选择门店"
          :options="shops.map(s => ({ label: s.name, value: s.id }))"
          clearable
          style="width: 200px"
          @update:value="(val: string | null) => { searchParams.shopId = val ?? undefined; getDataByPage(); }"
        />
        <NDatePicker
          :formatted-value="searchParams.settlementMonth || undefined"
          @update:formatted-value="(val: string | undefined) => { searchParams.settlementMonth = val || undefined; getDataByPage(); }"
          type="month"
          value-format="yyyy-MM"
          clearable
          style="width: 150px"
          placeholder="结算月份"
        />
        <NButton type="primary" @click="getData">刷新</NButton>
        <NButton type="warning" @click="showQuickCreate = true">快速录入</NButton>
      </NSpace>
    </NCard>

    <NCard title="喷漆工单管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
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
          :custom-request="({ file }) => handleQuickUpload({ file: file.file as File })"
          multiple
        >
          <NButton type="primary" :loading="quickUploading" :disabled="!quickShopId" block>
            <template #icon><icon-ic-round-add-photo-alternate /></template>
            选择图片上传（一张图片=一个工单）
          </NButton>
        </NUpload>

        <NAlert type="info" :bordered="false">
          上传图片后自动OCR识别车牌号和工单号，确认后创建工单。
        </NAlert>
      </NSpace>
    </NModal>

    <!-- OCR 确认弹窗 -->
    <NModal v-model:show="showOcrConfirm" preset="card" title="OCR识别结果" style="width: 480px" :mask-closable="false">
      <NSpin :show="ocrRecognizing" description="正在识别图片...">
        <NSpace vertical :size="16">
          <NFormItem label="车牌号">
            <NInput v-model:value="ocrResult.plateNumber" placeholder="未识别到车牌号，请手动输入" clearable />
          </NFormItem>
          <NFormItem label="工单号">
            <NInput v-model:value="ocrResult.orderNo" placeholder="未识别到工单号，请手动输入" clearable />
          </NFormItem>
          <NAlert v-if="!ocrResult.plateNumber && !ocrResult.orderNo && !ocrRecognizing" type="warning" :bordered="false">
            未识别到车牌号和工单号，请手动填写或直接提交后在工单列表中编辑。
          </NAlert>
          <NAlert v-if="ocrResult.plateNumber || ocrResult.orderNo" type="success" :bordered="false">
            已识别到信息，请核对后提交。
          </NAlert>
        </NSpace>
      </NSpin>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showOcrConfirm = false">取消</NButton>
          <NButton type="primary" :loading="quickUploading" :disabled="ocrRecognizing" @click="confirmQuickCreate">
            确认提交
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>
