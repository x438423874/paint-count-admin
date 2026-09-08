<script setup lang="tsx">
import { computed, h, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  NDropdown,
  NEmpty,
  NForm,
  NFormItem,
  NImage,
  NInput,
  NModal,
  NPopconfirm,
  NProgress,
  NRadio,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSpin,
  NStatistic,
  NTag,
  NText
} from 'naive-ui';
import { PAINT_ORDER_STATUS_LABEL, getPaintOrderStatusTagType } from '@/constants/paint';
import {
  auditWorkOrder,
  batchSettleWorkOrders,
  batchUnsettleWorkOrders,
  deleteWorkOrder,
  downloadWorkOrderTemplate,
  exportWorkOrderExcel,
  fetchPaintCategoryList,
  fetchWorkOrderById,
  fetchWorkOrderPage,
  findDuplicateOrders,
  importWorkOrderExcel,
  mergeWorkOrders,
  ocrRecognizeImage,
  quickCreateWorkOrder,
  setAbnormal,
  settleWorkOrder,
  unauditWorkOrder,
  unsettleWorkOrder,
  unvoidWorkOrder,
  updateWorkOrder,
  voidWorkOrder
} from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import { useShopOptions } from '@/hooks/business/use-shop-options';
import { compressDualImage } from '@/utils/image-compress';
import { formatPaintCount } from '@/utils/paint-count';
import { canAudit, canBatchOcr, canDelete, canEdit, canMerge, canSettle } from '@/utils/permission';
import EmptyState from '@/components/common/EmptyState.vue';
import { $t } from '@/locales';
import WorkOrderOperateDrawer from './modules/work-order-operate-drawer.vue';
import OcrCorrectModal from './modules/ocr-correct-modal.vue';
import BatchOcrModal from './modules/batch-ocr-modal.vue';
import WorkOrderDetailModal from './modules/work-order-detail-modal.vue';

// 权限控制（一次性求值，角色在登录态确定后不变）
const allowAudit = computed(() => canAudit());
const allowDelete = computed(() => canDelete());
const allowBatchOcr = canBatchOcr();
const allowMerge = computed(() => canMerge());
const allowSettle = computed(() => canSettle());
const allowEdit = computed(() => canEdit());

// 门店走 paint store 共享缓存，全应用只请求一次（原为每页各自 fetchPaintShopList）
const { shops, ensureShops } = useShopOptions();
const showDetail = ref(false);
const currentOrder = ref<any>(null);
const selectedShopId = ref<string | null>(null);

const route = useRoute();
const router = useRouter();
onMounted(() => {
  const id = route.query.id as string;
  if (id) {
    viewDetail(id);
  }
});

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

// 状态文案/颜色统一走 constants/paint（原映射 AUDITED/SETTLED 颜色与结算页相反）
function getStatusType(status?: string): NaiveUI.ThemeColor {
  return getPaintOrderStatusTagType(status);
}

function getStatusLabel(status?: string): string {
  if (!status) return '-';
  return PAINT_ORDER_STATUS_LABEL[status] || status;
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

async function openMergeModal(orderNo: string, currentId: string, settlementMonth?: string) {
  mergeTargetId.value = currentId;
  mergeOrderNo.value = orderNo;
  mergeSelectedIds.value = [];
  const { data, error } = await findDuplicateOrders(orderNo, currentId, settlementMonth);
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
  await getData();
}

// 导入导出相关
const fileInputRef = ref<HTMLInputElement | null>(null);
const importLoading = ref(false);
const showImportResult = ref(false);
const importResult = ref<{
  success: number;
  failed: number;
  errors: string[];
  mode?: 'quantity' | 'paintCount';
} | null>(null);

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
    const modeText = data.mode === 'paintCount' ? '部位幅数' : '数量';
    const msg = `导入完成：成功 ${data.success} 条，失败 ${data.failed} 条（按${modeText}导入）`;
    if (data.failed > 0) {
      window.$message?.warning(msg);
    } else {
      window.$message?.success(msg);
    }
    await getDataByPage();
  }
}

async function handleExport(mode: 'detail' | 'summary' = 'detail') {
  if (!selectedShopId.value) return;
  const { data, error } = await exportWorkOrderExcel(selectedShopId.value, searchParams.settlementMonth, mode);
  if (error) return;
  if (data) {
    const url = window.URL.createObjectURL(data as any);
    const a = document.createElement('a');
    a.href = url;
    const shopName = shops.value.find(s => s.id === selectedShopId.value)?.name || '喷漆';
    const suffix = mode === 'summary' ? '汇总' : '台账';
    a.download = `${shopName}_${suffix}_${searchParams.settlementMonth || '全部'}.xlsx`;
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

// 批量标注相关
// OCR 单条修正相关
const ocrCorrectVisible = ref(false);
const ocrCorrectOrder = ref<any>(null);
const batchOcrVisible = ref(false);

function openOcrCorrect(row: any) {
  ocrCorrectOrder.value = row;
  ocrCorrectVisible.value = true;
}

async function onOcrCorrectSaved() {
  await getData();
}

// 快速录入
const showQuickCreate = ref(false);
const quickShopId = ref<string>('');
const quickSettlementMonth = ref<string>(getCurrentMonth());
// 快速录入 OCR 识别模式
const quickOcrMode = ref<'basic' | 'items' | 'all'>('basic');

// 批量 OCR 填充相关
const showBatchOcrFill = ref(false);
const batchOcrLoading = ref(false);
const batchOcrMode = ref<'selected' | 'all'>('selected');
// 批量 OCR 填充识别模式
const batchOcrFillMode = ref<'basic' | 'items' | 'all'>('basic');
const batchOcrProgress = ref({ current: 0, total: 0, success: 0, failed: 0, skipped: 0 });
const batchOcrResult = ref<{ success: number; failed: number; skipped: number; details: string[] } | null>(null);
const batchOcrCancelled = ref(false);

// 获取待 OCR 处理的工单列表
function isUnauditedStatus(status?: string): boolean {
  return status === 'DRAFT' || status === 'PENDING';
}

function getOcrPendingOrders(): any[] {
  const source =
    batchOcrMode.value === 'selected' ? data.value.filter((o: any) => checkedRowKeys.value.includes(o.id)) : data.value;
  return source.filter((o: any) => isUnauditedStatus(o.status) && o.images?.length > 0);
}

// 批量 OCR 填充
async function handleBatchOcrFill() {
  const pendingOrders = getOcrPendingOrders();
  if (pendingOrders.length === 0) {
    window.$message?.warning('没有符合条件的工单（需要未审核、有图片、有空白字段）');
    return;
  }

  batchOcrLoading.value = true;
  batchOcrCancelled.value = false;
  batchOcrResult.value = null;
  batchOcrProgress.value = { current: 0, total: pendingOrders.length, success: 0, failed: 0, skipped: 0 };
  const details: string[] = [];

  for (const order of pendingOrders) {
    if (batchOcrCancelled.value) {
      details.push(`已取消，剩余 ${pendingOrders.length - batchOcrProgress.value.current} 条未处理`);
      break;
    }
    batchOcrProgress.value.current++;

    try {
      // fetch 图片
      const imageUrl = getImageUrl(order.images[0].url);
      const resp = await fetch(imageUrl);
      if (!resp.ok) {
        throw new Error('获取图片失败');
      }
      const blob = await resp.blob();

      // 构建 FormData
      const formData = new FormData();
      formData.append('file', blob, 'image.jpg');
      formData.append('shopId', order.shopId);
      // 智能选择OCR模式：根据当前工单已填字段决定识别范围
      const basicFields = [
        order.plateNumber,
        order.orderNo,
        order.customerName,
        order.phone,
        order.carModel,
        order.vin,
        order.brand,
        order.orderDate
      ];
      const basicFilled = basicFields.some((v: any) => v && String(v).trim());
      const itemsFilled = (order.items || []).some((it: any) => it.quantity && it.quantity > 0);
      let smartMode: 'basic' | 'items' | 'all' = 'all';
      if (basicFilled && !itemsFilled) smartMode = 'items';
      else if (!basicFilled && itemsFilled) smartMode = 'basic';
      // 如果用户手动选了非all模式，优先用手动选择；否则用智能模式
      const effectiveMode = batchOcrFillMode.value !== 'all' ? batchOcrFillMode.value : smartMode;
      formData.append('ocrMode', effectiveMode);

      // OCR 识别
      const { data: ocrResult, error: ocrError } = await ocrRecognizeImage(formData);
      if (ocrError || !ocrResult) {
        throw new Error('OCR识别失败');
      }

      // 空白字段直接填充，已填字段不覆盖
      const updateData: any = { id: order.id };
      const filledFields: string[] = [];
      // 车牌号：仅填充空白
      if (!order.plateNumber && ocrResult.plateNumber) {
        updateData.plateNumber = ocrResult.plateNumber;
        filledFields.push('车牌号');
      }
      // 工单号：仅填充空白
      if (!order.orderNo && ocrResult.orderNo) {
        updateData.orderNo = ocrResult.orderNo;
        filledFields.push('工单号');
      }
      if (!order.customerName && ocrResult.customerName) {
        updateData.customerName = ocrResult.customerName;
        filledFields.push('客户名');
      }
      if (!order.phone && ocrResult.phone) {
        updateData.phone = ocrResult.phone;
        filledFields.push('电话');
      }
      if (!order.carModel && ocrResult.carModel) {
        updateData.carModel = ocrResult.carModel;
        filledFields.push('车型');
      }
      // 车架号：仅填充空白
      if ((ocrResult as any).vin && !order.vin) {
        updateData.vin = (ocrResult as any).vin;
        filledFields.push('车架号');
      }
      // 品牌：仅填充空白
      if ((ocrResult as any).brand && !order.brand) {
        updateData.brand = (ocrResult as any).brand;
        filledFields.push('品牌');
      }
      // 工单日期：仅填充空白
      if ((ocrResult as any).date && !order.orderDate) {
        updateData.orderDate = (ocrResult as any).date;
        filledFields.push('工单日期');
      }

      // 部位项目：仅当工单无有效项目时，用 OCR 识别到的部位填充
      const ocrItems = ocrResult.items;
      if (ocrItems && ocrItems.length > 0) {
        const matchedItems = ocrItems.filter(it => it.matched && it.categoryId);
        if (matchedItems.length > 0) {
          const hasNoItems =
            !order.items ||
            order.items.length === 0 ||
            order.items.every((it: any) => !it.quantity || it.quantity === 0);
          if (hasNoItems) {
            updateData.items = matchedItems.map(it => ({
              categoryId: it.categoryId as string,
              quantity: it.quantity,
              newPartQuantity: it.newPartQuantity
            }));
            filledFields.push(`部位(${matchedItems.length})`);
          }
        }
      }

      if (filledFields.length === 0) {
        batchOcrProgress.value.skipped++;
        details.push(`${order.orderNo || order.id}: 识别结果无有效数据，跳过`);
        continue;
      }

      // 更新工单
      const { error: updateError } = await updateWorkOrder(updateData);
      if (updateError) {
        throw new Error('更新工单失败');
      }

      batchOcrProgress.value.success++;
      details.push(`${order.orderNo || order.id}: 填充 ${filledFields.join('、')}`);
    } catch (e: any) {
      batchOcrProgress.value.failed++;
      details.push(`${order.orderNo || order.id}: 失败 - ${e.message || '未知错误'}`);
    }
  }

  batchOcrLoading.value = false;
  batchOcrResult.value = {
    success: batchOcrProgress.value.success,
    failed: batchOcrProgress.value.failed,
    skipped: batchOcrProgress.value.skipped,
    details
  };

  if (batchOcrProgress.value.failed === 0) {
    window.$message?.success(
      `OCR填充完成：成功 ${batchOcrProgress.value.success} 条，跳过 ${batchOcrProgress.value.skipped} 条`
    );
  } else {
    window.$message?.warning(
      `OCR填充完成：成功 ${batchOcrProgress.value.success} 条，失败 ${batchOcrProgress.value.failed} 条，跳过 ${batchOcrProgress.value.skipped} 条`
    );
  }

  // 刷新列表
  await getData();
}

function cancelBatchOcr() {
  batchOcrCancelled.value = true;
}

// 打开批量OCR填充弹窗，重置状态
function openBatchOcrFill() {
  batchOcrLoading.value = false;
  batchOcrCancelled.value = false;
  batchOcrResult.value = null;
  batchOcrProgress.value = { current: 0, total: 0, success: 0, failed: 0, skipped: 0 };
  showBatchOcrFill.value = true;
}

// 计算选中工单中可 OCR 处理的数量
const ocrPendingSelectedCount = computed(() => {
  return data.value.filter(
    (o: any) => checkedRowKeys.value.includes(o.id) && isUnauditedStatus(o.status) && o.images?.length > 0
  ).length;
});

const ocrPendingAllCount = computed(() => {
  return data.value.filter((o: any) => isUnauditedStatus(o.status) && o.images?.length > 0).length;
});

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
  const list = await ensureShops();
  // 数据权限：若用户仅绑定 1 个门店，自动选中并锁定
  if (list.length === 1) {
    selectedShopId.value = list[0].id;
    searchParams.shopId = list[0].id;
  }
}

const categories = ref<{ id: string; name: string }[]>([]);
async function loadCategories() {
  const { data, error } = await fetchPaintCategoryList();
  if (!error && data) {
    categories.value = data;
  }
}

loadShops();
loadCategories();

const {
  columns,
  columnChecks,
  data,
  getData,
  getDataByPage,
  loading,
  mobilePagination,
  searchParams,
  resetSearchParams,
  extra
} = useTable({
  apiFn: fetchWorkOrderPage,
  showTotal: true,
  apiParams: {
    current: 1,
    size: 10,
    shopId: undefined as string | undefined,
    plateNumber: undefined as string | undefined,
    customerName: undefined as string | undefined,
    status: undefined as string | undefined,
    settlementMonth: undefined as string | undefined,
    isRework: undefined as boolean | undefined,
    isAdjustment: undefined as boolean | undefined,
    categoryId: undefined as string | undefined
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
          {row.images && row.images.length > 0 && (
            <NTag type="primary" size="small" round>
              📷 {row._count?.images ?? row.images?.length}
            </NTag>
          )}
          {row._isDuplicate && (
            <NTag type="warning" size="small" round>
              {row._duplicateCount}条重复
            </NTag>
          )}
          {row._hasOtherMonthSettlement && (
            <NTag type="success" size="small" round>
              跨月结算
            </NTag>
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
      width: 110,
      render: (row: any) => {
        if (!row.plateNumber) return '-';
        return h(
          NButton,
          {
            text: true,
            type: 'primary',
            size: 'small',
            onClick: () => router.push({ path: '/paint/vehicle', query: { plateNumber: row.plateNumber } })
          },
          { default: () => row.plateNumber }
        );
      }
    },
    {
      key: 'carModel',
      title: '车型',
      align: 'center',
      minWidth: 80,
      ellipsis: { tooltip: true }
    },
    {
      key: 'brand',
      title: '品牌',
      align: 'center',
      width: 80,
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
      render: (row: any) => (row.orderDate ? new Date(row.orderDate).toLocaleDateString() : '-')
    },
    {
      key: 'settlementMonth',
      title: '结算月份',
      align: 'center',
      width: 110,
      render: (row: any) =>
        row.settlementMonth ? (
          <span>{row.settlementMonth}</span>
        ) : (
          <NTag size="small" type="warning">
            未结算
          </NTag>
        )
    },
    {
      key: 'totalPaintCount',
      title: '幅数',
      align: 'center',
      width: 60,
      render: (row: any) => {
        const v = Number(row.totalPaintCount);
        return (
          <NTag type={v < 0 ? 'error' : 'info'} size="small" round>
            {formatPaintCount(v)}
          </NTag>
        );
      }
    },
    {
      key: 'status',
      title: '状态',
      align: 'center',
      width: 80,
      render: (row: any) => (
        <NSpace justify="center" size={4}>
          <NTag type={getStatusType(row.status)} size="small">
            {getStatusLabel(row.status)}
          </NTag>
          {row.isRework && (
            <NTag type="error" size="small">
              返工
            </NTag>
          )}
          {row.isAdjustment && (
            <NTag type="warning" size="small">
              调整
            </NTag>
          )}
          {row._isSealed && (
            <NTag type="warning" size="small">
              已封单
            </NTag>
          )}
        </NSpace>
      )
    },
    {
      key: 'operate',
      title: '操作',
      align: 'center',
      width: 220,
      fixed: 'right',
      render: (row: any) => {
        const isUnaudited = row.status === 'DRAFT' || row.status === 'PENDING';
        const isAudited = row.status === 'AUDITED';
        const isSettled = row.status === 'SETTLED';
        const isAbnormal = row.status === 'ABNORMAL';
        const sealed = row._isSealed;
        return (
          <div class="flex-center flex-wrap gap-4px">
            {isUnaudited && allowEdit && !sealed && (
              <NButton type="primary" text size="small" onClick={() => edit(row.id)}>
                编辑
              </NButton>
            )}
            <NButton type="info" text size="small" onClick={() => viewDetail(row.id)}>
              查看
            </NButton>
            {row.images?.length > 0 && allowEdit && !sealed && (
              <NButton type="warning" text size="small" onClick={() => openOcrCorrect(row)}>
                修正OCR
              </NButton>
            )}
            {row._isDuplicate && allowMerge && !sealed && (
              <NButton
                type="warning"
                text
                size="small"
                onClick={() => openMergeModal(row.orderNo, row.id, row.settlementMonth)}
              >
                合并
              </NButton>
            )}
            {allowAudit.value && isUnaudited && !sealed && (
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
            {allowAudit.value && row.status === 'AUDITED' && !sealed && (
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
            )}
            {allowSettle.value && isAudited && !sealed && (
              <NPopconfirm onPositiveClick={() => handleSettle(row.id)}>
                {{
                  default: () => '确认结算？',
                  trigger: () => (
                    <NButton type="info" text size="small">
                      结算
                    </NButton>
                  )
                }}
              </NPopconfirm>
            )}
            {allowSettle.value && isAudited && !sealed && (
              <NButton type="warning" text size="small" onClick={() => handleAbnormal(row.id, false)}>
                标记异常
              </NButton>
            )}
            {allowSettle.value && isAbnormal && !sealed && (
              <NButton
                type="success"
                text
                size="small"
                onClick={() => handleAbnormal(row.id, true, row.abnormalRemark)}
              >
                取消异常
              </NButton>
            )}
            {allowEdit.value && !row.isRework && !sealed && (
              <NButton type="error" text size="small" onClick={() => handleRework(row, true)}>
                标记返工
              </NButton>
            )}
            {allowEdit.value && row.isRework && !sealed && (
              <NButton type="success" text size="small" onClick={() => handleRework(row, false)}>
                取消返工
              </NButton>
            )}
            {allowSettle.value && isSettled && !sealed && (
              <NPopconfirm onPositiveClick={() => handleUnsettle(row.id)}>
                {{
                  default: () => '确认取消结算？',
                  trigger: () => (
                    <NButton type="warning" text size="small">
                      取消结算
                    </NButton>
                  )
                }}
              </NPopconfirm>
            )}
            {allowEdit.value && row.status !== 'VOID' && !sealed && (
              <NPopconfirm onPositiveClick={() => handleVoid(row.id)}>
                {{
                  default: () => '确认作废该工单？作废后不计入幅数统计与对账',
                  trigger: () => (
                    <NButton type="error" text size="small">
                      作废
                    </NButton>
                  )
                }}
              </NPopconfirm>
            )}
            {allowEdit.value && row.status === 'VOID' && !sealed && (
              <NPopconfirm onPositiveClick={() => handleUnvoid(row.id)}>
                {{
                  default: () => '确认恢复该作废工单？',
                  trigger: () => (
                    <NButton type="success" text size="small">
                      恢复
                    </NButton>
                  )
                }}
              </NPopconfirm>
            )}
            {allowDelete.value && isUnaudited && !sealed && (
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
        );
      }
    }
  ]
});

const { drawerVisible, operateType, editingData, handleAdd, handleEdit, checkedRowKeys, onBatchDeleted, onDeleted } =
  useTableOperate(data as any, getData);

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
  await getData();
}

async function handleUnaudit(id: string) {
  const { error } = await unauditWorkOrder(id);
  if (error) return;
  window.$message?.success('已取消审核');
  await getData();
}

// 结算相关

// 异常标注相关
const showAbnormalModal = ref(false);
const abnormalOrderId = ref('');
const abnormalFlag = ref(true);
const abnormalRemark = ref('');

function handleAbnormal(id: string, currentIsAbnormal: boolean, currentRemark?: string) {
  abnormalOrderId.value = id;
  abnormalFlag.value = !currentIsAbnormal;
  abnormalRemark.value = currentRemark || '';
  showAbnormalModal.value = true;
}

async function confirmAbnormal() {
  const { error } = await setAbnormal(abnormalOrderId.value, abnormalFlag.value, abnormalRemark.value || undefined);
  if (error) return;
  window.$message?.success(abnormalFlag.value ? '已标记异常' : '已取消异常');
  showAbnormalModal.value = false;
  await getData();
}

// 返工标记相关
const showReworkModal = ref(false);
const reworkOrderId = ref('');
const reworkFlag = ref(true);
const reworkRemarkInput = ref('');

function handleRework(row: any, markAsRework: boolean) {
  reworkOrderId.value = row.id;
  reworkFlag.value = markAsRework;
  reworkRemarkInput.value = markAsRework ? '' : row.reworkRemark || '';
  showReworkModal.value = true;
}

async function confirmRework() {
  const { error } = await updateWorkOrder({
    id: reworkOrderId.value,
    isRework: reworkFlag.value,
    reworkRemark: reworkRemarkInput.value || undefined
  });
  if (error) return;
  window.$message?.success(reworkFlag.value ? '已标记返工' : '已取消返工');
  showReworkModal.value = false;
  await getData();
}

async function handleSettle(orderId: string) {
  const { error } = await settleWorkOrder(orderId);
  if (error) return;
  window.$message?.success('结算成功');
  await getData();
}

async function handleUnsettle(orderId: string) {
  const { error } = await unsettleWorkOrder(orderId);
  if (error) return;
  window.$message?.success('已取消结算');
  await getData();
}

async function handleVoid(orderId: string) {
  const { error } = await voidWorkOrder(orderId);
  if (error) return;
  window.$message?.success('已作废，不计入幅数统计与对账');
  await getData();
}

async function handleUnvoid(orderId: string) {
  const { error } = await unvoidWorkOrder(orderId);
  if (error) return;
  window.$message?.success('已恢复工单');
  await getData();
}

// 批量结算相关
const batchSettleLoading = ref(false);
const batchUnsettleLoading = ref(false);

// 选中的工单中可结算的（已审核且非异常）
const settleableIds = computed(() => {
  return data.value
    .filter((o: any) => checkedRowKeys.value.includes(o.id) && o.status === 'AUDITED' && !o.isRework)
    .map((o: any) => o.id);
});

// 选中的工单中可取消结算的（已结算）
const unsettleableIds = computed(() => {
  return data.value
    .filter((o: any) => checkedRowKeys.value.includes(o.id) && o.status === 'SETTLED')
    .map((o: any) => o.id);
});

async function handleBatchSettle() {
  const ids = settleableIds.value;
  if (ids.length === 0) {
    window.$message?.warning('选中的工单中没有可结算的（需为已审核状态）');
    return;
  }
  batchSettleLoading.value = true;
  const { data, error } = await batchSettleWorkOrders(ids);
  batchSettleLoading.value = false;
  if (error) return;
  if (data) {
    if (data.failed === 0) {
      window.$message?.success(`批量结算成功：${data.success} 条`);
    } else {
      window.$message?.warning(`结算完成：成功 ${data.success} 条，失败 ${data.failed} 条`);
    }
  }
  checkedRowKeys.value = [];
  await getData();
}

async function handleBatchUnsettle() {
  const ids = unsettleableIds.value;
  if (ids.length === 0) {
    window.$message?.warning('选中的工单中没有可取消结算的（需为已结算状态）');
    return;
  }
  batchUnsettleLoading.value = true;
  const { data, error } = await batchUnsettleWorkOrders(ids);
  batchUnsettleLoading.value = false;
  if (error) return;
  if (data) {
    if (data.failed === 0) {
      window.$message?.success(`批量取消结算成功：${data.success} 条`);
    } else {
      window.$message?.warning(`取消结算完成：成功 ${data.success} 条，失败 ${data.failed} 条`);
    }
  }
  checkedRowKeys.value = [];
  await getData();
}

async function viewDetail(id: string) {
  const { data: resData, error } = await fetchWorkOrderById(id);
  if (!error && resData) {
    currentOrder.value = resData;
    showDetail.value = true;
  }
}

// 幅数显示格式：默认1位小数，实际值有2位小数时显示2位（与编辑页幅数规则一致）

const totalPaintCount = computed(() => {
  return formatPaintCount(extra.value?.totalPaintCount);
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
    formData.append('ocrMode', quickOcrMode.value);
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
          <NText depth="3" style="white-space: nowrap">门店</NText>
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
          <NText depth="3" style="white-space: nowrap">结算月份</NText>
          <NDatePicker
            :formatted-value="searchParams.settlementMonth || undefined"
            type="month"
            value-format="yyyy-MM"
            clearable
            style="width: 150px"
            placeholder="选择月份"
            @update:formatted-value="(val: string | undefined) => { searchParams.settlementMonth = val || undefined; getDataByPage(); }"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap">状态</NText>
          <NSelect
            :value="searchParams.status || ''"
            :options="[
              { label: '全部', value: '' },
              { label: '草稿', value: 'DRAFT' },
              { label: '待审核', value: 'PENDING' },
              { label: '已审核', value: 'AUDITED' },
              { label: '已结算', value: 'SETTLED' },
              { label: '异常', value: 'ABNORMAL' },
              { label: '作废', value: 'VOID' }
            ]"
            clearable
            style="width: 120px"
            placeholder="全部"
            @update:value="(val: string) => { searchParams.status = val || undefined; getDataByPage(); }"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap">返工</NText>
          <NSelect
            :value="searchParams.isRework === undefined ? '' : String(searchParams.isRework)"
            :options="[
              { label: '全部', value: '' },
              { label: '是', value: 'true' },
              { label: '否', value: 'false' }
            ]"
            clearable
            style="width: 100px"
            placeholder="全部"
            @update:value="(val: string) => { searchParams.isRework = val === '' ? undefined : val === 'true'; getDataByPage(); }"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap">调整单</NText>
          <NSelect
            :value="searchParams.isAdjustment === undefined ? '' : String(searchParams.isAdjustment)"
            :options="[
              { label: '全部', value: '' },
              { label: '仅调整单', value: 'true' },
              { label: '仅普通', value: 'false' }
            ]"
            clearable
            style="width: 110px"
            placeholder="全部"
            @update:value="(val: string) => { searchParams.isAdjustment = val === '' ? undefined : val === 'true'; getDataByPage(); }"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap">部位</NText>
          <NSelect
            v-model:value="searchParams.categoryId"
            :options="categories.map(c => ({ label: c.name, value: c.id }))"
            clearable
            style="width: 140px"
            placeholder="全部部位"
            @update:value="getDataByPage()"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap">车牌号</NText>
          <NInput
            :value="searchParams.plateNumber || ''"
            placeholder="搜索车牌号"
            clearable
            style="width: 130px"
            @update:value="(val: string) => { searchParams.plateNumber = val || undefined; }"
            @keyup.enter="getDataByPage()"
          />
        </NSpace>
        <NSpace align="center" :size="6">
          <NText depth="3" style="white-space: nowrap">客户</NText>
          <NInput
            :value="searchParams.customerName || ''"
            placeholder="搜索客户名"
            clearable
            style="width: 120px"
            @update:value="(val: string) => { searchParams.customerName = val || undefined; }"
            @keyup.enter="getDataByPage()"
          />
        </NSpace>
        <NButton type="primary" @click="getDataByPage()">搜索</NButton>
        <NButton
          @click="
            resetSearchParams();
            selectedShopId = null;
            getDataByPage();
          "
        >
          重置
        </NButton>
        <NDivider vertical />
        <NButton v-if="allowEdit" type="warning" @click="showQuickCreate = true">快速录入</NButton>
        <NButton type="info" :disabled="!selectedShopId" @click="handleDownloadTemplate">下载模板</NButton>
        <NButton v-if="allowEdit" type="success" :disabled="!selectedShopId" @click="triggerImport">导入</NButton>
        <NDropdown
          trigger="click"
          :options="[
            { label: '导出明细台账', key: 'detail' },
            { label: '导出汇总（只含总幅数）', key: 'summary' }
          ]"
          :disabled="!selectedShopId"
          @select="(key: string) => handleExport(key as 'detail' | 'summary')"
        >
          <NButton :disabled="!selectedShopId">导出</NButton>
        </NDropdown>

        <NButton v-if="allowBatchOcr" type="info" @click="openBatchOcrFill">一键OCR填充</NButton>
        <NButton type="success" :disabled="!selectedShopId" @click="batchOcrVisible = true">批量OCR录入</NButton>
        <NPopconfirm v-if="allowSettle && settleableIds.length > 0" @positive-click="handleBatchSettle">
          <template #trigger>
            <NButton type="info" :loading="batchSettleLoading">批量结算（{{ settleableIds.length }} 条）</NButton>
          </template>
          确认结算选中的 {{ settleableIds.length }} 条工单？
        </NPopconfirm>
        <NPopconfirm v-if="allowSettle && unsettleableIds.length > 0" @positive-click="handleBatchUnsettle">
          <template #trigger>
            <NButton type="warning" :loading="batchUnsettleLoading">
              批量取消结算（{{ unsettleableIds.length }} 条）
            </NButton>
          </template>
          确认取消结算选中的 {{ unsettleableIds.length }} 条工单？
        </NPopconfirm>
        <input ref="fileInputRef" type="file" accept=".xlsx,.xls" style="display: none" @change="handleImportFile" />
      </NSpace>
    </NCard>

    <NAlert v-if="selectedShopHasNoTemplate" type="warning" :bordered="false" class="mb-0">
      当前门店未关联标准模板，无法正常导入和快速录入。请先到「门店管理」页面为该门店关联标准模板。
    </NAlert>

    <NCard title="喷漆工单管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header>
        <NSpace align="center" :size="8">
          <span>喷漆工单管理</span>
          <NTag size="tiny" type="info" round>已审核/已结算/异常工单不可编辑/删除</NTag>
        </NSpace>
      </template>
      <template #header-extra>
        <NSpace align="center" :size="16">
          <NStatistic label="搜索总幅数" :value="totalPaintCount" style="min-width: 120px" />
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
        striped
        :flex-height="true"
        virtual-scroll
        :scroll-x="1200"
        :loading="loading"
        remote
        :row-key="(row: any) => row.id"
        :pagination="mobilePagination"
        class="paint-table sm:h-full"
      >
        <template #empty>
          <EmptyState description="暂无工单数据">
            <template #action>
              <NButton v-if="allowEdit" text type="primary" size="small" @click="handleAdd">点击新建工单</NButton>
            </template>
          </EmptyState>
        </template>
      </NDataTable>

      <WorkOrderOperateDrawer
        v-model:visible="drawerVisible"
        :operate-type="operateType"
        :row-data="editingData"
        @submitted="getDataByPage"
      />

      <OcrCorrectModal v-model:visible="ocrCorrectVisible" :order="ocrCorrectOrder" @saved="onOcrCorrectSaved" />

      <BatchOcrModal
        v-model:show="batchOcrVisible"
        :shop-id="selectedShopId || ''"
        :shop-name="shops.find(s => s.id === selectedShopId)?.name"
        @success="getDataByPage"
      />
    </NCard>

    <WorkOrderDetailModal v-model:show="showDetail" :order="currentOrder" />

    <!-- 快速录入弹窗 -->
    <NModal
      v-model:show="showQuickCreate"
      preset="card"
      title="快速录入工单"
      style="width: 480px"
      :mask-closable="false"
    >
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
            type="month"
            value-format="yyyy-MM"
            style="width: 100%"
            clearable
            placeholder="选择结算月份"
            @update:formatted-value="(val: string | undefined) => quickSettlementMonth = val || ''"
          />
        </NFormItem>

        <NFormItem label="识别模式" :show-feedback="false">
          <NRadioGroup v-model:value="quickOcrMode">
            <NSpace>
              <NRadioButton value="basic">仅基础资料</NRadioButton>
              <NRadioButton value="items">仅部位</NRadioButton>
              <NRadioButton value="all">全部</NRadioButton>
            </NSpace>
          </NRadioGroup>
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
          indicator-placement="inside"
          processing
        />
      </NSpace>
    </NModal>

    <!-- 合并工单弹窗 -->
    <NModal
      v-model:show="showMergeModal"
      preset="card"
      :title="`合并重复工单 - ${mergeOrderNo}`"
      style="width: 600px"
      :mask-closable="false"
    >
      <NAlert type="warning" :bordered="false" class="mb-12px">
        检测到工单号
        {{ mergeOrderNo }}
        存在多条记录，请勾选要合并到当前工单的记录。合并后，仅转移被合并工单的图片；若当前工单缺少车牌号、车型等基础信息，会用被合并工单的内容自动补齐；当前工单的幅数明细保持不变；源工单将被删除。
      </NAlert>
      <NEmpty v-if="duplicateOrders.length === 0" description="没有其他重复工单" />
      <template v-else>
        <NSpace vertical :size="8">
          <NCard v-for="order in duplicateOrders" :key="order.id" size="small" :bordered="true">
            <NSpace justify="space-between" align="center">
              <NCheckbox
                :checked="mergeSelectedIds.includes(order.id)"
                @update:checked="(val: boolean) => toggleMergeSelect(order.id, val)"
              >
                <NSpace vertical :size="4">
                  <NText strong>{{ order.orderNo }}</NText>
                  <NText depth="3">
                    {{ order.shop?.name }} | {{ order.plateNumber || '无车牌' }} | 幅数:
                    {{ formatPaintCount(order.totalPaintCount) }}
                  </NText>
                  <NText depth="3">
                    项目数: {{ order.items?.length || 0 }} | 图片数:
                    {{ (order._count?.images ?? order.images?.length) || 0 }}
                  </NText>
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

    <!-- 结算弹窗 -->
    <!-- 异常标注弹窗 -->
    <NModal
      v-model:show="showAbnormalModal"
      preset="card"
      :title="abnormalFlag ? '标记异常' : '取消异常'"
      style="width: 400px"
    >
      <NSpace vertical :size="16">
        <NAlert v-if="abnormalFlag" type="warning" title="标记异常后该工单将无法结算" />
        <NInput
          v-model:value="abnormalRemark"
          type="textarea"
          :placeholder="abnormalFlag ? '请输入异常原因' : '备注（选填）'"
          :rows="3"
        />
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showAbnormalModal = false">取消</NButton>
          <NButton :type="abnormalFlag ? 'warning' : 'success'" @click="confirmAbnormal">
            {{ abnormalFlag ? '确认标记' : '确认取消异常' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 返工标记弹窗 -->
    <NModal
      v-model:show="showReworkModal"
      preset="card"
      :title="reworkFlag ? '标记返工' : '取消返工'"
      style="width: 400px"
    >
      <NSpace vertical :size="16">
        <NAlert v-if="reworkFlag" type="error" title="返工工单的幅数将不计入总幅数统计" />
        <NInput
          v-model:value="reworkRemarkInput"
          type="textarea"
          :placeholder="reworkFlag ? '请输入返工原因（选填）' : '备注（选填）'"
          :rows="3"
        />
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showReworkModal = false">取消</NButton>
          <NButton :type="reworkFlag ? 'error' : 'success'" @click="confirmRework">
            {{ reworkFlag ? '确认标记' : '确认取消' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 导入结果弹窗 -->
    <NModal v-model:show="showImportResult" preset="card" title="导入结果" style="width: 600px">
      <template v-if="importResult">
        <NAlert :type="importResult.failed > 0 ? 'warning' : 'success'" :bordered="false" class="mb-12px">
          成功导入 {{ importResult.success }} 条，失败 {{ importResult.failed }} 条
          <template v-if="importResult.mode">
            （部位数值按
            <strong>{{ importResult.mode === 'paintCount' ? '幅数' : '数量' }}</strong>
            导入）
          </template>
        </NAlert>
        <template v-if="importResult.errors?.length > 0">
          <NText strong class="mb-8px" style="display: block">错误详情：</NText>
          <div
            style="
              max-height: 300px;
              overflow-y: auto;
              background: var(--neutral-100);
              padding: 12px;
              border-radius: 4px;
              font-size: 13px;
            "
          >
            <div v-for="(err, idx) in importResult.errors" :key="idx" style="padding: 2px 0">
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

    <!-- 一键OCR填充弹窗 -->
    <NModal
      v-model:show="showBatchOcrFill"
      preset="card"
      title="一键 OCR 填充空白字段"
      style="width: 600px"
      :mask-closable="false"
    >
      <NSpace vertical :size="16">
        <NAlert type="info" :bordered="false">
          <template #header>批量OCR识别填充空白字段</template>
          对未审核、有图片、有空白字段的工单进行OCR识别，
          <strong>只填充空白字段</strong>
          （已有值的不覆盖）。
          <br />
          支持填充字段：车牌号、工单号、客户名称、电话、车型、车架号、品牌、日期、部位项目。
        </NAlert>

        <NRadioGroup v-model:value="batchOcrMode" :disabled="batchOcrLoading">
          <NSpace>
            <NRadio value="selected" :disabled="checkedRowKeys.length === 0">
              选中的工单（可处理 {{ ocrPendingSelectedCount }} 条）
            </NRadio>
            <NRadio value="all">当前页全部待审核工单（可处理 {{ ocrPendingAllCount }} 条）</NRadio>
          </NSpace>
        </NRadioGroup>

        <NFormItem label="识别范围" :show-feedback="false">
          <NSpace align="center" :size="8" wrap>
            <NRadioGroup v-model:value="batchOcrFillMode" :disabled="batchOcrLoading">
              <NSpace>
                <NRadioButton value="basic">仅基础资料</NRadioButton>
                <NRadioButton value="items">仅部位</NRadioButton>
                <NRadioButton value="all">全部识别</NRadioButton>
              </NSpace>
            </NRadioGroup>
            <NButton
              v-if="batchOcrFillMode !== 'all'"
              type="primary"
              size="small"
              ghost
              :disabled="batchOcrLoading"
              @click="batchOcrFillMode = 'all'"
            >
              智能推荐
            </NButton>
          </NSpace>
        </NFormItem>
        <NAlert v-if="batchOcrFillMode === 'basic'" type="success" :bordered="false" style="padding: 6px 12px">
          快速填充车牌号、工单号、客户名称等核心基础信息，推荐首次使用
        </NAlert>

        <NDescriptions label-placement="left" bordered size="small" :column="1">
          <NDescriptionsItem label="处理范围">
            {{
              batchOcrMode === 'selected' ? `选中的 ${checkedRowKeys.length} 条工单` : `当前页 ${data.length} 条工单`
            }}
          </NDescriptionsItem>
          <NDescriptionsItem label="符合条件">
            <NTag type="success">
              {{ batchOcrMode === 'selected' ? ocrPendingSelectedCount : ocrPendingAllCount }} 条
            </NTag>
            <NText depth="3" style="font-size: 12px; margin-left: 8px">（未审核 + 有图片 + 有空白字段）</NText>
          </NDescriptionsItem>
        </NDescriptions>

        <!-- 进度显示 -->
        <template v-if="batchOcrLoading">
          <NCard size="small" :bordered="true">
            <NSpace vertical :size="8">
              <NSpace justify="space-between">
                <NSpace align="center" :size="6">
                  <icon-ic-round-sync style="animation: spin 1s linear infinite" />
                  <span>正在处理...</span>
                </NSpace>
                <span>{{ batchOcrProgress.current }} / {{ batchOcrProgress.total }}</span>
              </NSpace>
              <NProgress
                type="line"
                :percentage="
                  batchOcrProgress.total > 0 ? Math.round((batchOcrProgress.current / batchOcrProgress.total) * 100) : 0
                "
                :show-indicator="false"
              />
              <NSpace :size="16">
                <NTag type="success" size="small">✓ 成功 {{ batchOcrProgress.success }}</NTag>
                <NTag type="error" size="small">✗ 失败 {{ batchOcrProgress.failed }}</NTag>
                <NTag type="warning" size="small">− 跳过 {{ batchOcrProgress.skipped }}</NTag>
              </NSpace>
            </NSpace>
          </NCard>
        </template>

        <!-- 结果显示 -->
        <template v-if="batchOcrResult">
          <NAlert :type="batchOcrResult.failed > 0 ? 'warning' : 'success'" :bordered="false">
            <NSpace :size="12">
              <NTag type="success" size="small">✓ 成功 {{ batchOcrResult.success }}</NTag>
              <NTag v-if="batchOcrResult.failed > 0" type="error" size="small">✗ 失败 {{ batchOcrResult.failed }}</NTag>
              <NTag v-if="batchOcrResult.skipped > 0" type="warning" size="small">
                − 跳过 {{ batchOcrResult.skipped }}
              </NTag>
            </NSpace>
          </NAlert>
          <NCard size="small" :bordered="true" title="处理详情" style="max-height: 200px; overflow-y: auto">
            <NSpace vertical :size="4">
              <div v-for="(detail, idx) in batchOcrResult.details" :key="idx" style="font-size: 12px; line-height: 1.6">
                <NText v-if="detail.startsWith('✓') || detail.includes('成功')" type="success">{{ detail }}</NText>
                <NText v-else-if="detail.startsWith('✗') || detail.includes('失败')" type="error">{{ detail }}</NText>
                <NText v-else depth="3">{{ detail }}</NText>
              </div>
            </NSpace>
          </NCard>
        </template>
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton v-if="batchOcrLoading" type="error" @click="cancelBatchOcr">取消处理</NButton>
          <NButton v-else @click="showBatchOcrFill = false">关闭</NButton>
          <NButton
            v-if="!batchOcrLoading && !batchOcrResult"
            type="primary"
            :loading="batchOcrLoading"
            @click="handleBatchOcrFill"
          >
            开始OCR填充
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.paint-table :deep(.n-data-table-tr:hover .n-data-table-td) {
  background-color: color-mix(in srgb, rgb(var(--primary-color)) 8%, transparent);
}
</style>
