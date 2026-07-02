<script setup lang="tsx">
import { NButton, NPopconfirm, NTag, NSpace, NImage, NCard, NStatistic, NProgress, NAlert, NDivider, NModal, NEmpty, NInputGroup, NGridItem, NText, NRadioGroup, NRadio, NDescriptions, NDescriptionsItem } from 'naive-ui';
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
  addSettlementRecord,
  removeSettlementRecord,
  setAbnormal,
  importWorkOrderExcel,
  exportWorkOrderExcel,
  downloadWorkOrderTemplate,
  detectExcelTemplate,
  saveExcelTemplate,
  getExcelTemplateConfig,
  saveOcrAnnotation,
  getAnnotatedOrderIds,
  getOcrTemplate,
  ocrRecognizeImage,
  updateWorkOrder
} from '@/service/api';
import { useTable, useTableOperate } from '@/hooks/common/table';
import { $t } from '@/locales';
import { compressDualImage } from '@/utils/image-compress';
import WorkOrderOperateDrawer from './modules/work-order-operate-drawer.vue';
import OcrCorrectModal from './modules/ocr-correct-modal.vue';
import { canAudit, canDelete, canBatchOcr, canBatchAnnotate, canMerge, canSettle, canEdit } from '@/utils/permission';

// 权限控制（一次性求值，角色在登录态确定后不变）
const allowAudit = canAudit();
const allowDelete = canDelete();
const allowBatchOcr = canBatchOcr();
const allowBatchAnnotate = canBatchAnnotate();
const allowMerge = canMerge();
const allowSettle = canSettle();
const allowEdit = canEdit();

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

// 批量标注相关
const showBatchAnnotation = ref(false);
const batchAnnotationLoading = ref(false);
const batchAnnotationResult = ref<{ success: number; failed: number } | null>(null);
const annotatedOrderIds = ref<Set<string>>(new Set()); // 已标注的工单ID集合

// OCR 单条修正相关
const ocrCorrectVisible = ref(false);
const ocrCorrectOrder = ref<any>(null);

function openOcrCorrect(row: any) {
  ocrCorrectOrder.value = row;
  ocrCorrectVisible.value = true;
}

async function onOcrCorrectSaved() {
  await getDataByPage();
}

// 加载已标注工单ID列表
async function loadAnnotatedOrderIds() {
  if (!selectedShopId.value) return;
  try {
    const { data, error } = await getAnnotatedOrderIds(selectedShopId.value);
    if (!error && data) {
      annotatedOrderIds.value = new Set(data);
    }
  } catch {
    // 静默失败
  }
}

async function handleBatchAnnotation() {
  if (!selectedShopId.value || checkedRowKeys.value.length === 0) return;

  // 获取选中的工单数据
  const selectedOrders = data.value.filter((order: any) => checkedRowKeys.value.includes(order.id));
  const ordersWithImages = selectedOrders.filter((order: any) => order.images && order.images.length > 0);

  if (ordersWithImages.length === 0) {
    window.$message?.warning('选中的工单中没有带图片的工单');
    return;
  }

  // 过滤掉已标注的工单，防止重复标注
  const unannotatedOrders = ordersWithImages.filter((order: any) => !annotatedOrderIds.value.has(order.id));
  const alreadyAnnotatedCount = ordersWithImages.length - unannotatedOrders.length;

  if (unannotatedOrders.length === 0) {
    window.$message?.warning('选中的工单已全部标注过，无需重复标注');
    return;
  }

  // 先加载当前门店的OCR模板区域配置，作为批量标注的默认区域
  let templateRegions: Record<string, any> = {};
  try {
    const { data: templateData, error: templateError } = await getOcrTemplate(selectedShopId.value);
    if (!templateError && templateData?.regions) {
      templateRegions = templateData.regions;
    }
  } catch {
    // 静默失败，使用空区域
  }

  batchAnnotationLoading.value = true;
  batchAnnotationResult.value = null;

  let successCount = 0;
  let failedCount = 0;

  for (const order of unannotatedOrders) {
    const image = order.images?.[0];
    if (!image) {
      failedCount++;
      continue;
    }

    try {
      // 从 orderDate 提取年月日作为日期基准
      let dateStr = '';
      if (order.orderDate) {
        const d = new Date(order.orderDate);
        if (!isNaN(d.getTime())) {
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      }

      // 调用保存标注接口，将工单图片和已填写的数据作为标注
      // 批量标注只是导入数据，不自动设为已验证
      // 已验证状态应在 OCR 模板标注编辑器中识别校准准确率 100% 后才设置
      const { error } = await saveOcrAnnotation({
        shopId: selectedShopId.value,
        orderId: order.id,
        imageUrl: image.url,
        imageWidth: image.width || 0,
        imageHeight: image.height || 0,
        regions: templateRegions, // 使用模板区域配置作为默认区域（可能为空）
        groundTruth: {
          orderNo: order.orderNo || '',
          plateNumber: order.plateNumber || '',
          customerName: order.customerName || '',
          phone: order.phone || '',
          carModel: order.carModel || '',
          date: dateStr,
        },
        isVerified: false, // 始终为待验证，需在 OCR 模板标注编辑器中校准后手动验证
      });
      if (!error) {
        successCount++;
        // 标记为已标注
        annotatedOrderIds.value.add(order.id);
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  batchAnnotationLoading.value = false;
  batchAnnotationResult.value = { success: successCount, failed: failedCount };

  if (failedCount === 0) {
    window.$message?.success(`成功保存 ${successCount} 条标注数据`);
  } else {
    window.$message?.warning(`完成：成功 ${successCount} 条，失败 ${failedCount} 条`);
  }
}

// 快速录入
const showQuickCreate = ref(false);
const quickShopId = ref<string>('');
const quickSettlementMonth = ref<string>(getCurrentMonth());

// 批量 OCR 填充相关
const showBatchOcrFill = ref(false);
const batchOcrLoading = ref(false);
const batchOcrMode = ref<'selected' | 'all'>('selected');
const batchOcrProgress = ref({ current: 0, total: 0, success: 0, failed: 0, skipped: 0 });
const batchOcrResult = ref<{ success: number; failed: number; skipped: number; details: string[] } | null>(null);
const batchOcrCancelled = ref(false);

// 检查工单是否有空白字段（车牌号、工单号、客户名称、电话、车型）
function hasEmptyFields(order: any): boolean {
  return !order.plateNumber || !order.orderNo || !order.customerName || !order.phone || !order.carModel;
}

// 获取待 OCR 处理的工单列表
function getOcrPendingOrders(): any[] {
  const source = batchOcrMode.value === 'selected'
    ? data.value.filter((o: any) => checkedRowKeys.value.includes(o.id))
    : data.value;
  return source.filter((o: any) => !o.isAudited && o.images?.length > 0 && hasEmptyFields(o));
}

// 批量 OCR 填充
async function handleBatchOcrFill() {
  const pendingOrders = getOcrPendingOrders();
  if (pendingOrders.length === 0) {
    window.$message?.warning('没有符合条件的工单（需要未审核、有图片、有空白字段）');
    return;
  }
  if (!selectedShopId.value) {
    window.$message?.warning('请先选择门店');
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

      // OCR 识别
      const { data: ocrResult, error: ocrError } = await ocrRecognizeImage(formData);
      if (ocrError || !ocrResult) {
        throw new Error('OCR识别失败');
      }

      // 只填充空白字段
      const updateData: any = { id: order.id };
      let filledFields: string[] = [];
      if (!order.plateNumber && ocrResult.plateNumber) {
        updateData.plateNumber = ocrResult.plateNumber;
        filledFields.push('车牌号');
      }
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
    window.$message?.success(`OCR填充完成：成功 ${batchOcrProgress.value.success} 条，跳过 ${batchOcrProgress.value.skipped} 条`);
  } else {
    window.$message?.warning(`OCR填充完成：成功 ${batchOcrProgress.value.success} 条，失败 ${batchOcrProgress.value.failed} 条，跳过 ${batchOcrProgress.value.skipped} 条`);
  }

  // 刷新列表
  await getDataByPage();
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
  return data.value.filter((o: any) =>
    checkedRowKeys.value.includes(o.id) && !o.isAudited && o.images?.length > 0 && hasEmptyFields(o)
  ).length;
});

const ocrPendingAllCount = computed(() => {
  return data.value.filter((o: any) =>
    !o.isAudited && o.images?.length > 0 && hasEmptyFields(o)
  ).length;
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
  const { data, error } = await fetchPaintShopList();
  if (!error && data) {
    shops.value = data;
    // 数据权限：若用户仅绑定 1 个门店，自动选中并锁定
    if (data.length === 1 && !selectedShopId.value) {
      selectedShopId.value = data[0].id;
    }
  }
}
loadShops();
loadAnnotatedOrderIds(); // 初始加载已标注工单ID

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
          {row.images && row.images.length > 0 && (
            <NTag type="primary" size="small" round>
              📷 {row.images.length}
            </NTag>
          )}
          {row._isDuplicate && (
            <NTag type="warning" size="small" round>{row._duplicateCount}条重复</NTag>
          )}
          {annotatedOrderIds.value.has(row.id) && (
            <NTag type="success" size="small" round>已标注</NTag>
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
      key: 'isAbnormal',
      title: '异常',
      align: 'center',
      width: 60,
      render: (row: any) => row.isAbnormal
        ? <NTag type="error" size="small">异常</NTag>
        : <NTag type="default" size="small">正常</NTag>
    },
    {
      key: 'operate',
      title: '操作',
      align: 'center',
      width: 220,
      render: (row: any) => (
        <div class="flex-center gap-4px flex-wrap">
          {!row.isAudited && allowEdit && (
            <NButton type="primary" text size="small" onClick={() => edit(row.id)}>
              编辑
            </NButton>
          )}
          <NButton type="info" text size="small" onClick={() => viewDetail(row.id)}>
            查看
          </NButton>
          {row.images?.length > 0 && allowBatchAnnotate && (
            <NButton type="warning" text size="small" onClick={() => openOcrCorrect(row)}>
              修正OCR
            </NButton>
          )}
          {row._isDuplicate && !row.isAudited && allowMerge && (
            <NButton type="warning" text size="small" onClick={() => openMergeModal(row.orderNo, row.id)}>
              合并
            </NButton>
          )}
          {allowAudit && (
            row.isAudited ? (
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
            )
          )}
          {allowSettle && row.isAudited && !row.settlements?.length && (
            <NButton type="info" text size="small" onClick={() => handleSettle(row.id)}>
              结算
            </NButton>
          )}
          {allowSettle && row.isAudited && !row.isAbnormal && !row.settlements?.length && (
            <NButton type="warning" text size="small" onClick={() => handleAbnormal(row.id, false)}>
              标记异常
            </NButton>
          )}
          {allowSettle && row.isAudited && row.isAbnormal && (
            <NButton type="success" text size="small" onClick={() => handleAbnormal(row.id, true, row.abnormalRemark)}>
              取消异常
            </NButton>
          )}
          {allowSettle && row.settlements?.length > 0 && (
            <NPopconfirm onPositiveClick={() => handleUnsettle(row.id, row.settlements[0].id)}>
              {{
                default: () => '确认取消最近一次结算？',
                trigger: () => (
                  <NButton type="warning" text size="small">
                    取消结算
                  </NButton>
                )
              }}
            </NPopconfirm>
          )}
          {allowDelete && !row.isAudited && (
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
} = useTableOperate(data as any, getData);

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

// 结算相关
const showSettleModal = ref(false);
const settleOrderId = ref('');
const settleMonth = ref(getCurrentMonth());
const settleRemark = ref('');

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
  await getDataByPage();
}

function handleSettle(id: string) {
  settleOrderId.value = id;
  const row = data.value.find((r: any) => r.id === id);
  settleMonth.value = row?.settlementMonth || getCurrentMonth();
  settleRemark.value = '';
  showSettleModal.value = true;
}

async function confirmSettle() {
  if (!settleMonth.value) {
    window.$message?.warning('请选择结算月份');
    return;
  }
  const { error } = await addSettlementRecord(settleOrderId.value, settleMonth.value, settleRemark.value || undefined);
  if (error) return;
  window.$message?.success('结算成功');
  showSettleModal.value = false;
  await getDataByPage();
}

async function handleUnsettle(orderId: string, recordId: string) {
  const { error } = await removeSettlementRecord(orderId, recordId);
  if (error) return;
  window.$message?.success('已取消结算');
  await getDataByPage();
}

async function handleDeleteSettlement(recordId: string) {
  const { error } = await removeSettlementRecord(settlementOrderId.value, recordId);
  if (error) return;
  window.$message?.success('已删除结算记录');
  // 刷新结算历史
  const { data } = await getSettlementHistory(settlementOrderId.value);
  if (data) settlementHistory.value = data;
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
            @update:value="(val: string | null) => { searchParams.shopId = val ?? undefined; getDataByPage(); loadAnnotatedOrderIds(); }"
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
        <NButton v-if="allowEdit" type="warning" @click="showQuickCreate = true">快速录入</NButton>
        <NButton type="info" @click="handleDownloadTemplate" :disabled="!selectedShopId">下载模板</NButton>
        <NButton v-if="allowEdit" type="success" @click="triggerImport" :disabled="!selectedShopId">导入</NButton>
        <NButton @click="handleExport" :disabled="!selectedShopId">导出</NButton>
        <NButton v-if="allowEdit" type="default" @click="openTemplateConfig" :disabled="!selectedShopId">模板配置</NButton>
        <NButton v-if="allowBatchAnnotate" type="primary" @click="showBatchAnnotation = true" :disabled="!selectedShopId || checkedRowKeys.length === 0">
          批量标注 ({{ checkedRowKeys.length }})
        </NButton>
        <NButton v-if="allowBatchOcr" type="info" @click="openBatchOcrFill" :disabled="!selectedShopId">
          一键OCR填充
        </NButton>
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

      <OcrCorrectModal
        v-model:visible="ocrCorrectVisible"
        :order="ocrCorrectOrder"
        @saved="onOcrCorrectSaved"
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

    <!-- 结算弹窗 -->
    <!-- 异常标注弹窗 -->
    <NModal v-model:show="showAbnormalModal" preset="card" :title="abnormalFlag ? '标记异常' : '取消异常'" style="width: 400px">
      <NSpace vertical :size="16">
        <NAlert v-if="abnormalFlag" type="warning" title="标记异常后该工单将无法结算" />
        <NInput v-model:value="abnormalRemark" type="textarea" :placeholder="abnormalFlag ? '请输入异常原因' : '备注（选填）'" :rows="3" />
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showAbnormalModal = false">取消</NButton>
          <NButton :type="abnormalFlag ? 'warning' : 'success'" @click="confirmAbnormal">{{ abnormalFlag ? '确认标记' : '确认取消异常' }}</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal v-model:show="showSettleModal" preset="card" title="结算工单" style="width: 400px">
      <NSpace vertical :size="16">
        <NSpace align="center" :size="8">
          <NText>结算月份</NText>
          <NDatePicker
            v-model:formatted-value="settleMonth"
            type="month"
            value-format="yyyy-MM"
            style="width: 180px"
            placeholder="选择结算月份"
          />
        </NSpace>
        <NInput v-model:value="settleRemark" type="textarea" placeholder="备注（选填）" :rows="2" />
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showSettleModal = false">取消</NButton>
          <NButton type="primary" @click="confirmSettle">确认结算</NButton>
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
            <NPopconfirm @positive-click="() => handleDeleteSettlement(record.id)">
              <template #default>确认删除此结算记录？</template>
              <template #trigger>
                <NButton type="error" text size="small">删除</NButton>
              </template>
            </NPopconfirm>
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

    <!-- 批量标注弹窗 -->
    <NModal v-model:show="showBatchAnnotation" preset="card" title="批量标注工单图片（智能校准）" style="width: 550px" :mask-closable="false">
      <NSpace vertical :size="16">
        <NAlert type="success" :bordered="false">
          <template #header>智能标注学习</template>
          将选中的已审核工单图片和<strong>已录入的字段数据</strong>保存为训练数据。<br />
          系统会自动对比OCR识别结果与正确数据，持续优化识别准确率。<br />
          <strong>标注越多，识别越准确！</strong> 建议每家门店至少标注 5-10 张工单。
        </NAlert>
        <NDescriptions label-placement="left" bordered size="small" :column="1">
          <NDescriptionsItem label="选中工单数">
            <NTag type="info">{{ checkedRowKeys.length }}</NTag>
          </NDescriptionsItem>
          <NDescriptionsItem label="当前门店">
            {{ shops.find(s => s.id === selectedShopId)?.name || '-' }}
          </NDescriptionsItem>
          <NDescriptionsItem label="带图工单数">
            <NTag type="success">{{ data.filter((order: any) => checkedRowKeys.includes(order.id) && order.images?.length > 0).length }}</NTag>
          </NDescriptionsItem>
          <NDescriptionsItem label="已标注">
            <NTag type="warning">{{ data.filter((order: any) => checkedRowKeys.includes(order.id) && annotatedOrderIds.has(order.id)).length }}</NTag>
            <NText depth="3" style="font-size:12px; margin-left:4px">（已标注的将自动跳过）</NText>
          </NDescriptionsItem>
          <NDescriptionsItem label="待标注">
            <NTag type="info">{{ data.filter((order: any) => checkedRowKeys.includes(order.id) && !annotatedOrderIds.has(order.id) && order.images?.length > 0).length }}</NTag>
          </NDescriptionsItem>
        </NDescriptions>

        <!-- 显示选中工单中已有的字段数据预览 -->
        <NCard size="small" :bordered="true" title="将包含以下已录入数据作为校准基准">
          <NSpace :size="4" wrap>
            <template v-for="(order, idx) in data.filter((o: any) => checkedRowKeys.includes(o.id) && !annotatedOrderIds.has(o.id)).slice(0, 3)" :key="idx">
              <NTag size="small" :type="annotatedOrderIds.has(order.id) ? 'success' : 'default'">
                {{ order.orderNo || order.id }}
                {{ annotatedOrderIds.has(order.id) ? '(已标注)' : '' }}
              </NTag>
              <span v-if="order.plateNumber" style="font-size:12px">车牌:{{ order.plateNumber }}</span>
              <span v-if="order.customerName" style="font-size:12px">客户:{{ order.customerName }}</span>
            </template>
            <NText v-if="checkedRowKeys.length > 3" depth="3" style="font-size:12px">...等 {{ checkedRowKeys.length }} 条</NText>
          </NSpace>
        </NCard>

        <template v-if="batchAnnotationResult">
          <NAlert :type="batchAnnotationResult.failed > 0 ? 'warning' : 'success'" :bordered="false">
            标注完成：成功 {{ batchAnnotationResult.success }} 条，失败 {{ batchAnnotationResult.failed }} 条
            <br />
            <span style="font-size:12px">系统已记录每条工单的正确数据，用于后续智能优化模板</span>
          </NAlert>
        </template>
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showBatchAnnotation = false">取消</NButton>
          <NButton type="primary" :loading="batchAnnotationLoading" @click="handleBatchAnnotation">
            开始智能标注
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 一键OCR填充弹窗 -->
    <NModal v-model:show="showBatchOcrFill" preset="card" title="一键OCR识别填充" style="width: 600px" :mask-closable="false">
      <NSpace vertical :size="16">
        <NAlert type="info" :bordered="false">
          <template #header>批量OCR识别填充空白字段</template>
          对未审核、有图片、有空白字段的工单进行OCR识别，<strong>只填充空白字段</strong>（已有值的不覆盖）。<br />
          支持字段：车牌号、工单号、客户名、电话、车型。
        </NAlert>

        <NRadioGroup v-model:value="batchOcrMode" :disabled="batchOcrLoading">
          <NSpace>
            <NRadio value="selected" :disabled="checkedRowKeys.length === 0">
              选中的工单（可处理 {{ ocrPendingSelectedCount }} 条）
            </NRadio>
            <NRadio value="all">
              当前页全部待审核工单（可处理 {{ ocrPendingAllCount }} 条）
            </NRadio>
          </NSpace>
        </NRadioGroup>

        <NDescriptions label-placement="left" bordered size="small" :column="1">
          <NDescriptionsItem label="当前门店">
            {{ shops.find(s => s.id === selectedShopId)?.name || '-' }}
          </NDescriptionsItem>
          <NDescriptionsItem label="处理范围">
            {{ batchOcrMode === 'selected' ? `选中的 ${checkedRowKeys.length} 条工单` : `当前页 ${data.length} 条工单` }}
          </NDescriptionsItem>
          <NDescriptionsItem label="符合条件">
            <NTag type="success">{{ batchOcrMode === 'selected' ? ocrPendingSelectedCount : ocrPendingAllCount }} 条</NTag>
            <NText depth="3" style="font-size:12px; margin-left:8px">（未审核 + 有图片 + 有空白字段）</NText>
          </NDescriptionsItem>
        </NDescriptions>

        <!-- 进度显示 -->
        <template v-if="batchOcrLoading">
          <NCard size="small" :bordered="true">
            <NSpace vertical :size="8">
              <NSpace justify="space-between">
                <span>正在处理...</span>
                <span>{{ batchOcrProgress.current }} / {{ batchOcrProgress.total }}</span>
              </NSpace>
              <NProgress
                type="line"
                :percentage="batchOcrProgress.total > 0 ? Math.round(batchOcrProgress.current / batchOcrProgress.total * 100) : 0"
                :show-indicator="false"
              />
              <NSpace :size="16">
                <NTag type="success" size="small">成功 {{ batchOcrProgress.success }}</NTag>
                <NTag type="error" size="small">失败 {{ batchOcrProgress.failed }}</NTag>
                <NTag type="warning" size="small">跳过 {{ batchOcrProgress.skipped }}</NTag>
              </NSpace>
            </NSpace>
          </NCard>
        </template>

        <!-- 结果显示 -->
        <template v-if="batchOcrResult">
          <NAlert :type="batchOcrResult.failed > 0 ? 'warning' : 'success'" :bordered="false">
            OCR填充完成：成功 {{ batchOcrResult.success }} 条，失败 {{ batchOcrResult.failed }} 条，跳过 {{ batchOcrResult.skipped }} 条
          </NAlert>
          <NCard size="small" :bordered="true" title="处理详情" style="max-height: 200px; overflow-y: auto">
            <NSpace vertical :size="4">
              <div v-for="(detail, idx) in batchOcrResult.details" :key="idx" style="font-size: 12px; line-height: 1.6">
                {{ detail }}
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

<style scoped></style>
