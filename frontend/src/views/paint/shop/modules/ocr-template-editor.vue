<script setup lang="ts">
import { ref, reactive, watch, nextTick, h, onMounted } from 'vue';
import { getOcrTemplate, saveOcrTemplate, deleteOcrTemplate, ocrRecognizeImage, ocrSmartAnnotate, batchValidateOcr, fetchWorkOrderPage, saveOcrAnnotation, getOcrAnnotations, deleteOcrAnnotation, getAggregatedOcrTemplate, getOcrAnnotationStats, ocrDiagnose, fixOcrVerifiedStatus } from '@/service/api';

defineOptions({ name: 'OcrTemplateEditor' });

interface Props {
  shopId: string;
  shopName: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'saved'): void }>();

const visible = defineModel<boolean>('visible', { default: false });

// 图片相关
const imageUrl = ref('');
const imageFile = ref<File | null>(null);
const imgRef = ref<HTMLImageElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

// 模板配置
interface RegionConfig {
  x: number;
  y: number;
  width: number;
  height: number;
}

const templateConfig = reactive({
  name: '',
  imageWidth: 0,
  imageHeight: 0,
  regions: {
    orderNo: null as RegionConfig | null,
    plateNumber: null as RegionConfig | null,
    customerName: null as RegionConfig | null,
    phone: null as RegionConfig | null,
    carModel: null as RegionConfig | null,
    date: null as RegionConfig | null,
  }
});

// 字段定义
const fieldDefs = [
  { key: 'orderNo', label: '工单号', color: '#18a058' },
  { key: 'plateNumber', label: '车牌号', color: '#2080f0' },
  { key: 'customerName', label: '客户名称', color: '#f0a020' },
  { key: 'phone', label: '联系电话', color: '#d03050' },
  { key: 'carModel', label: '车型', color: '#8a2be2' },
  { key: 'date', label: '日期', color: '#0099a9' },
] as const;

type FieldKey = typeof fieldDefs[number]['key'];

// 当前选中的字段
const activeField = ref<FieldKey>('orderNo');

// 绘制状态
const isDrawing = ref(false);
const drawStart = reactive({ x: 0, y: 0 });
const drawEnd = reactive({ x: 0, y: 0 });

// 加载状态
const loading = ref(false);
const smartAnnotateLoading = ref(false);
const diagnoseLoading = ref(false);
const diagnoseResult = ref<any>(null);
const showDiagnoseModal = ref(false);

// ====== 工单选择相关 ======
const showOrderPicker = ref(false);
const orderList = ref<any[]>([]);
const orderLoading = ref(false);
const orderPagination = reactive({ current: 1, size: 10, total: 0 });

async function loadOrders(page = 1) {
  orderLoading.value = true;
  try {
    const { data, error } = await fetchWorkOrderPage({
      current: page,
      size: orderPagination.size,
      shopId: props.shopId,
      status: 'AUDITED', // 只查已审核的工单，数据更准确
    });
    if (!error && data) {
      // 只保留有图片的工单
      orderList.value = (data.records || []).filter((o: any) => o.images && o.images.length > 0);
      orderPagination.total = data.total || 0;
      orderPagination.current = page;
    }
  } finally {
    orderLoading.value = false;
  }
}

function openOrderPicker() {
  showOrderPicker.value = true;
  loadOrders(1);
}

function selectOrder(order: any) {
  const image = order.images?.[0];
  if (!image) {
    window.$message?.warning('该工单没有图片');
    return;
  }

  // 保存当前工单ID
  currentOrderId.value = order.id;

  // 切换工单图片时清空所有旧标注信息（区域坐标、校准结果、测试结果、groundTruth）
  Object.keys(templateConfig.regions).forEach(key => {
    (templateConfig.regions as any)[key] = null;
  });
  calibrationResult.value = null;
  groundTruth.value = {};

  // 加载已录入的数据作为校准基准
  loadGroundTruth(order);

  // 使用工单图片 URL（加代理前缀）
  imageUrl.value = getImageProxyUrl(image.url);
  imageFile.value = null; // 标记为 URL 图片，非上传文件

  // 加载图片获取尺寸
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    templateConfig.imageWidth = img.naturalWidth;
    templateConfig.imageHeight = img.naturalHeight;
    templateConfig.name = `${props.shopName}工单模板`;
  };
  img.src = imageUrl.value;

  showOrderPicker.value = false;

  // 显示提示
  const hasData = Object.values(groundTruth.value).some(v => v);
  window.$message?.success(
    `已选择工单 ${order.orderNo || order.id} 的图片` +
    (hasData ? '，已加载录入数据用于智能校准' : '') +
    '，可点击"智能标注"自动定位字段区域'
  );
}

// ====== 批量验证相关 ======
const validateLoading = ref(false);
const validateResult = ref<{
  total: number;
  fields: Record<string, { total: number; matched: number; accuracy: number }>;
  details: Array<{
    orderId: string;
    orderNo: string;
    expected: Record<string, string>;
    actual: Record<string, string>;
    matched: Record<string, boolean>;
  }>;
} | null>(null);

const fieldLabelMap: Record<string, string> = {
  orderNo: '工单号',
  plateNumber: '车牌号',
  customerName: '客户名称',
  phone: '联系电话',
  carModel: '车型',
  date: '日期',
};

function getFieldColor(key: string): string | undefined {
  return fieldDefs.find(f => f.key === (key as FieldKey))?.color;
}

async function handleBatchValidate() {
  validateLoading.value = true;
  validateResult.value = null;
  try {
    const { data, error } = await batchValidateOcr(props.shopId, 20);
    if (!error && data) {
      validateResult.value = data;
    } else {
      window.$message?.error('批量验证失败');
    }
  } finally {
    validateLoading.value = false;
  }
}

// ====== 图片代理URL处理 ======
// 后端图片URL需要加 /proxy-demo 前缀才能访问
function getImageProxyUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('http') || url.startsWith('/proxy-demo')) return url;
  return `/proxy-demo${url}`;
}

// ====== 图片上传处理 ======
function handleImageUpload(info: { file: { file: File } }) {
  const file = info.file.file;
  if (!file) return;
  imageFile.value = file;
  imageUrl.value = URL.createObjectURL(file);

  const img = new Image();
  img.onload = () => {
    templateConfig.imageWidth = img.naturalWidth;
    templateConfig.imageHeight = img.naturalHeight;
    templateConfig.name = `${props.shopName}工单模板`;
  };
  img.src = imageUrl.value;
}

// ====== 加载已有模板配置 ======
async function loadTemplate() {
  if (!props.shopId) return;
  loading.value = true;
  try {
    const { data, error } = await getOcrTemplate(props.shopId);
    if (!error && data) {
      const config = data;
      templateConfig.name = config.name || '';
      templateConfig.imageWidth = config.imageWidth || 0;
      templateConfig.imageHeight = config.imageHeight || 0;
      if (config.regions) {
        const w = templateConfig.imageWidth || 1;
        const h = templateConfig.imageHeight || 1;
        Object.keys(config.regions).forEach(key => {
          const region = config.regions[key];
          if (region) {
            // 检测是否为相对坐标（0-1范围），如果是则还原为绝对坐标
            const isRelative = region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;
            if (isRelative && w > 1) {
              (templateConfig.regions as any)[key] = {
                x: Math.round(region.x * w),
                y: Math.round(region.y * h),
                width: Math.round(region.width * w),
                height: Math.round(region.height * h),
              };
            } else {
              (templateConfig.regions as any)[key] = region;
            }
          } else {
            (templateConfig.regions as any)[key] = null;
          }
        });
      }
      if (templateConfig.imageWidth && templateConfig.imageHeight && !imageUrl.value) {
        window.$message?.info('已加载模板配置，请选择工单图片查看区域标注');
      }
    }
  } finally {
    loading.value = false;
  }
}

// ====== Canvas 绘制 ======
function redrawCanvas() {
  const canvas = canvasRef.value;
  const img = imgRef.value;
  if (!canvas || !img) return;

  const ctx = canvas.getContext('2d')!;
  const cssWidth = img.clientWidth;
  const cssHeight = img.clientHeight;
  const scale = cssWidth / img.naturalWidth;

  canvas.width = cssWidth;
  canvas.height = cssHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 绘制所有已标注的区域
  for (const field of fieldDefs) {
    const region = templateConfig.regions[field.key];
    if (!region) continue;

    const x = region.x * scale;
    const y = region.y * scale;
    const w = region.width * scale;
    const h = region.height * scale;

    ctx.strokeStyle = field.color;
    ctx.lineWidth = field.key === activeField.value ? 3 : 2;
    ctx.setLineDash(field.key === activeField.value ? [] : [4, 4]);
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = field.color + '20';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = field.color;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(field.label, x + 4, y - 4 > 12 ? y - 4 : y + 14);
  }

  // 绘制当前正在拖拽的区域
  if (isDrawing.value) {
    const field = fieldDefs.find(f => f.key === activeField.value)!;
    const x = Math.min(drawStart.x, drawEnd.x);
    const y = Math.min(drawStart.y, drawEnd.y);
    const w = Math.abs(drawEnd.x - drawStart.x);
    const h = Math.abs(drawEnd.y - drawStart.y);

    ctx.strokeStyle = field.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = field.color + '30';
    ctx.fillRect(x, y, w, h);
  }
}

// ====== 鼠标事件处理 ======
function onCanvasMouseDown(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  drawStart.x = e.clientX - rect.left;
  drawStart.y = e.clientY - rect.top;
  drawEnd.x = drawStart.x;
  drawEnd.y = drawStart.y;
  isDrawing.value = true;
}

function onCanvasMouseMove(e: MouseEvent) {
  if (!isDrawing.value) return;
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  drawEnd.x = e.clientX - rect.left;
  drawEnd.y = e.clientY - rect.top;
  redrawCanvas();
}

function onCanvasMouseUp() {
  if (!isDrawing.value) return;
  isDrawing.value = false;

  const img = imgRef.value;
  if (!img) return;

  const scale = img.clientWidth / img.naturalWidth;
  const x = Math.min(drawStart.x, drawEnd.x) / scale;
  const y = Math.min(drawStart.y, drawEnd.y) / scale;
  const width = Math.abs(drawEnd.x - drawStart.x) / scale;
  const height = Math.abs(drawEnd.y - drawStart.y) / scale;

  if (width < 5 || height < 5) {
    redrawCanvas();
    return;
  }

  (templateConfig.regions as any)[activeField.value] = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };

  redrawCanvas();
}

// ====== 操作方法 ======
function clearFieldRegion(key: FieldKey) {
  (templateConfig.regions as any)[key] = null;
  redrawCanvas();
}

async function handleSave() {
  if (!templateConfig.name) {
    window.$message?.warning('请输入模板名称');
    return;
  }

  // 归一化区域坐标为相对值（0-1范围），使不同尺寸图片可通用
  const normalizedRegions: Record<string, any> = {};
  const w = templateConfig.imageWidth || 1;
  const h = templateConfig.imageHeight || 1;

  for (const [key, region] of Object.entries(templateConfig.regions)) {
    if (!region) {
      normalizedRegions[key] = null;
      continue;
    }
    normalizedRegions[key] = {
      x: region.x / w,
      y: region.y / h,
      width: region.width / w,
      height: region.height / h,
    };
  }

  loading.value = true;
  try {
    const { error } = await saveOcrTemplate(props.shopId, {
      name: templateConfig.name,
      imageWidth: templateConfig.imageWidth,
      imageHeight: templateConfig.imageHeight,
      regions: normalizedRegions,
    });
    if (!error) {
      window.$message?.success('模板保存成功');
      emit('saved');
    }
  } finally {
    loading.value = false;
  }
}

async function handleDelete() {
  loading.value = true;
  try {
    const { error } = await deleteOcrTemplate(props.shopId);
    if (!error) {
      window.$message?.success('模板已删除');
      Object.keys(templateConfig.regions).forEach(key => {
        (templateConfig.regions as any)[key] = null;
      });
      templateConfig.name = '';
      templateConfig.imageWidth = 0;
      templateConfig.imageHeight = 0;
      redrawCanvas();
      emit('saved');
    }
  } finally {
    loading.value = false;
  }
}

// 智能标注：自动识别字段区域坐标
async function handleSmartAnnotate() {
  if (!imageFile.value && !imageUrl.value) {
    window.$message?.warning('请先选择或上传工单图片');
    return;
  }

  smartAnnotateLoading.value = true;
  try {
    const formData = new FormData();

    if (imageFile.value) {
      formData.append('file', imageFile.value);
    } else {
      const img = imgRef.value;
      if (!img) {
        window.$message?.warning('图片未加载完成');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png');
      });
      formData.append('file', blob, 'smart_annotate.png');
    }

    const { data, error } = await ocrSmartAnnotate(formData);
    if (!error && data) {
      // 将智能标注结果应用到区域配置（归一化坐标转为绝对坐标）
      const w = templateConfig.imageWidth || 1;
      const h = templateConfig.imageHeight || 1;
      let annotatedCount = 0;

      for (const [key, region] of Object.entries(data)) {
        if (region && (region as any).x !== undefined) {
          const r = region as { x: number; y: number; width: number; height: number };
          // 检测是否为归一化坐标（0-1范围）
          const isRelative = r.x <= 1 && r.y <= 1 && r.width <= 1 && r.height <= 1;
          if (isRelative && w > 1) {
            (templateConfig.regions as any)[key] = {
              x: Math.round(r.x * w),
              y: Math.round(r.y * h),
              width: Math.round(r.width * w),
              height: Math.round(r.height * h),
            };
          } else {
            (templateConfig.regions as any)[key] = {
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height),
            };
          }
          annotatedCount++;
        }
      }

      redrawCanvas();
      window.$message?.success(`智能标注完成，自动识别了 ${annotatedCount} 个字段区域，请检查并修正不准确的位置`);
    } else {
      window.$message?.error('智能标注失败');
    }
  } catch {
    window.$message?.error('智能标注失败，请确认 PaddleOCR 服务是否正常运行');
  } finally {
    smartAnnotateLoading.value = false;
  }
}

// 诊断识别：返回详细的识别过程信息
async function handleDiagnose() {
  if (!imageUrl.value) {
    window.$message?.warning('请先选择工单图片');
    return;
  }

  diagnoseLoading.value = true;
  try {
    let file: File | null = imageFile.value;
    // 如果是 URL 图片（从工单列表选择的），先下载为 File 对象
    if (!file) {
      try {
        const response = await fetch(imageUrl.value, { mode: 'cors' });
        if (!response.ok) throw new Error('下载图片失败');
        const blob = await response.blob();
        file = new File([blob], 'diagnose-image.png', { type: blob.type || 'image/png' });
      } catch (e) {
        window.$message?.error('获取图片失败，请尝试上传本地图片');
        diagnoseLoading.value = false;
        return;
      }
    }

    if (!file) {
      window.$message?.warning('请先选择工单图片');
      diagnoseLoading.value = false;
      return;
    }

    const { data, error } = await ocrDiagnose(file, props.shopId);
    if (!error && data) {
      diagnoseResult.value = data;
      showDiagnoseModal.value = true;
    } else {
      window.$message?.error('诊断失败');
    }
  } catch {
    window.$message?.error('诊断失败，请确认 PaddleOCR 服务是否正常运行');
  } finally {
    diagnoseLoading.value = false;
  }
}

// ====== 标注学习相关 ======
const annotationStats = ref<{ total: number; verified: number; coverage: Record<string, number> } | null>(null);
const annotationLoading = ref(false);
const saveAnnotationLoading = ref(false);
const aggregatedTemplate = ref<any>(null);
const aggregateLoading = ref(false);
const currentOrderId = ref<string>(''); // 当前选择的工单ID
const groundTruth = ref<Record<string, string>>({}); // 已录入的正确数据（用于校准）
const calibrationResult = ref<{
  matched: Record<string, boolean>;
  expected: Record<string, string>;
  actual: Record<string, string>;
  accuracy: number;
} | null>(null); // 校准结果
const calibrationLoading = ref(false);

// ====== 标注管理相关 ======
const annotationList = ref<any[]>([]);
const annotationListLoading = ref(false);
const annotationListTotal = ref(0);
const annotationPage = ref(1);
const showAnnotationManager = ref(false);

// 加载标注列表
async function loadAnnotationList(page = 1) {
  annotationListLoading.value = true;
  try {
    const { data, error } = await getOcrAnnotations(props.shopId, page, 10);
    if (!error && data) {
      annotationList.value = data.list || [];
      annotationListTotal.value = data.total || 0;
      annotationPage.value = page;
    }
  } finally {
    annotationListLoading.value = false;
  }
}

// 删除标注
async function handleDeleteAnnotation(id: string) {
  const result = await new Promise<boolean>((resolve) => {
    window.$dialog?.warning({
      title: '确认删除',
      content: '删除后该标注数据将不再参与聚合模板计算，确定删除？',
      positiveText: '确认删除',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onMaskClick: () => resolve(false),
    });
  });
  if (!result) return;

  try {
    const { error } = await deleteOcrAnnotation(id, props.shopId);
    if (!error) {
      window.$message?.success('标注已删除');
      loadAnnotationList(annotationPage.value);
      loadAnnotationStats();
    }
  } catch {
    window.$message?.error('删除失败');
  }
}

// 检查标注是否有有效的区域（至少一个字段有非 null 的区域坐标）
function hasValidAnnotationRegions(annotation: any): boolean {
  if (!annotation.regions || typeof annotation.regions !== 'object') return false;
  return Object.values(annotation.regions).some(v => v !== null && v !== undefined);
}

// 修复脏数据：没有有效区域标注但标记为已验证的记录重置为待验证
async function handleFixVerifiedStatus() {
  const result = await new Promise<boolean>((resolve) => {
    window.$dialog?.info({
      title: '修复验证状态',
      content: '将没有有效区域标注但标记为"已验证"的记录重置为"待验证"，确定执行？',
      positiveText: '确认修复',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
    });
  });
  if (!result) return;

  try {
    const { data, error } = await fixOcrVerifiedStatus(props.shopId);
    if (!error && data) {
      if (data.fixed > 0) {
        window.$message?.success(`已修复 ${data.fixed} 条脏数据，重置为待验证`);
      } else {
        window.$message?.success('数据正常，无需修复');
      }
      loadAnnotationList(annotationPage.value);
      loadAnnotationStats();
    }
  } catch {
    window.$message?.error('修复失败');
  }
}

// 从标注加载到编辑器（重新编辑）
function loadAnnotationToEditor(annotation: any) {
  // 加载图片
  if (annotation.imageUrl) {
    imageUrl.value = getImageProxyUrl(annotation.imageUrl);
    imageFile.value = null;
    currentOrderId.value = annotation.orderId || '';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      templateConfig.imageWidth = annotation.imageWidth || img.naturalWidth;
      templateConfig.imageHeight = annotation.imageHeight || img.naturalHeight;
    };
    img.src = imageUrl.value;
  }

  // 加载区域标注
  if (annotation.regions) {
    const w = annotation.imageWidth || templateConfig.imageWidth || 1;
    const h = annotation.imageHeight || templateConfig.imageHeight || 1;
    Object.keys(annotation.regions).forEach(key => {
      const region = annotation.regions[key];
      if (region) {
        const isRelative = region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;
        if (isRelative && w > 1) {
          (templateConfig.regions as any)[key] = {
            x: Math.round(region.x * w),
            y: Math.round(region.y * h),
            width: Math.round(region.width * w),
            height: Math.round(region.height * h),
          };
        } else {
          (templateConfig.regions as any)[key] = region;
        }
      } else {
        (templateConfig.regions as any)[key] = null;
      }
    });
  }

  // 加载 ground truth
  if (annotation.groundTruth) {
    groundTruth.value = { ...annotation.groundTruth };
  }

  showAnnotationManager.value = false;
  window.$message?.info('已加载标注到编辑器，修改后重新保存即可');
}

// 加载标注统计
async function loadAnnotationStats() {
  try {
    const { data, error } = await getOcrAnnotationStats(props.shopId);
    if (!error && data) {
      annotationStats.value = data;
    }
  } catch {
    // 静默失败
  }
}

// 选择工单时自动加载已录入的数据作为校准基准
function loadGroundTruth(order: any) {
  // date 字段从 orderDate（DateTime）提取年月日
  let dateStr = '';
  if (order.orderDate) {
    const d = new Date(order.orderDate);
    if (!isNaN(d.getTime())) {
      dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }

  // 从已审核工单中提取已录入的字段数据
  groundTruth.value = {
    orderNo: order.orderNo || '',
    plateNumber: order.plateNumber || '',
    customerName: order.customerName || '',
    phone: order.phone || '',
    carModel: order.carModel || '',
    date: dateStr,
  };
  calibrationResult.value = null; // 重置校准结果
}

// 智能校准：对比已录入数据与OCR识别结果
async function handleCalibrate() {
  if (!imageUrl.value) {
    window.$message?.warning('请先选择工单图片');
    return;
  }

  const hasGroundTruth = Object.values(groundTruth.value).some(v => v);

  calibrationLoading.value = true;
  calibrationResult.value = null;

  try {
    // 执行OCR识别
    const formData = new FormData();
    if (imageFile.value) {
      formData.append('file', imageFile.value);
    } else {
      const img = imgRef.value;
      if (!img) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png');
      });
      formData.append('file', blob, 'calibrate_image.png');
    }
    formData.append('shopId', props.shopId);

    const { data: ocrData, error: ocrError } = await ocrRecognizeImage(formData);
    if (ocrError || !ocrData) {
      window.$message?.error('OCR识别失败');
      return;
    }

    // 没有已录入数据时，只显示识别结果（不校准）
    if (!hasGroundTruth) {
      calibrationResult.value = {
        matched: {},
        expected: {},
        actual: ocrData,
        accuracy: -1, // -1 表示无校准（只识别）
      };
      return;
    }

    // 有已录入数据时，对比识别结果与已录入数据
    const fields = ['orderNo', 'plateNumber', 'customerName', 'phone', 'carModel', 'date'] as const;
    const matched: Record<string, boolean> = {};
    let matchCount = 0;

    for (const field of fields) {
      const expected = (groundTruth.value[field] || '').trim();
      const actual = (ocrData[field] || '').trim();

      if (!expected) {
        matched[field] = true; // 没有期望值，UI标记为匹配，但不计入准确率统计
      } else if (!actual) {
        matched[field] = false; // 有期望值但没识别出来
      } else {
        // 模糊匹配：包含关系或相似度
        matched[field] =
          actual.includes(expected) ||
          expected.includes(actual) ||
          calculateSimilarity(expected, actual) >= 0.7;
      }
      // 仅当有期望值且匹配时才计入分子
      if (expected && matched[field]) matchCount++;
    }

    calibrationResult.value = {
      matched,
      expected: { ...groundTruth.value },
      actual: ocrData,
      accuracy: Math.round((matchCount / fields.filter(f => groundTruth.value[f]).length) * 100),
    };

    // 100% 准确度时自动保存标注并转验证状态
    if (calibrationResult.value.accuracy === 100) {
      const hasRegions = Object.values(templateConfig.regions).some(r => r !== null);
      if (hasRegions) {
        try {
          const { error: saveError } = await saveOcrAnnotation({
            shopId: props.shopId,
            orderId: currentOrderId.value || undefined,
            imageUrl: imageUrl.value.startsWith('/proxy-demo') ? imageUrl.value.replace('/proxy-demo', '') : imageUrl.value,
            imageWidth: templateConfig.imageWidth,
            imageHeight: templateConfig.imageHeight,
            regions: { ...templateConfig.regions },
            groundTruth: Object.keys(groundTruth.value).some(k => groundTruth.value[k]) ? { ...groundTruth.value } : undefined,
            isVerified: true,
          });
          if (!saveError) {
            window.$message?.success('校准准确率 100%，已自动保存标注并设为已验证');
            loadAnnotationStats();
            // 如果标注管理弹窗打开着，刷新列表
            if (showAnnotationManager.value) {
              loadAnnotationList(annotationPage.value);
            }
          }
        } catch {
          // 自动保存失败不影响校准结果展示
        }
      }
    }

  } finally {
    calibrationLoading.value = false;
  }
}

// 计算字符串相似度（编辑距离算法）
function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // 删除
        matrix[i][j - 1] + 1,     // 插入
        matrix[i - 1][j - 1] + cost // 替换
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

// 保存当前标注为训练数据（增强版：附带校准信息）
async function handleSaveAnnotation() {
  if (!imageUrl.value) {
    window.$message?.warning('请先选择工单图片');
    return;
  }

  // 检查是否有标注区域
  const hasRegions = Object.values(templateConfig.regions).some(r => r !== null);
  if (!hasRegions) {
    window.$message?.warning('请至少标注一个字段区域');
    return;
  }

  saveAnnotationLoading.value = true;
  try {
    const { error } = await saveOcrAnnotation({
      shopId: props.shopId,
      orderId: currentOrderId.value || undefined,
      imageUrl: imageUrl.value.startsWith('/proxy-demo') ? imageUrl.value.replace('/proxy-demo', '') : imageUrl.value,
      imageWidth: templateConfig.imageWidth,
      imageHeight: templateConfig.imageHeight,
      regions: { ...templateConfig.regions },
      groundTruth: Object.keys(groundTruth.value).some(k => groundTruth.value[k]) ? { ...groundTruth.value } : undefined,
      // 校准准确率100%时保存为已验证，否则为待验证
      isVerified: calibrationResult.value?.accuracy === 100,
    });
    if (!error) {
      const verified = calibrationResult.value?.accuracy === 100;
      window.$message?.success(verified ? '标注保存成功（已验证）' : '标注保存成功（待验证），校准准确率100%时将自动转为已验证');
      loadAnnotationStats(); // 刷新统计
      // 如果标注管理弹窗打开着，刷新列表
      if (showAnnotationManager.value) {
        loadAnnotationList(annotationPage.value);
      }
    }
  } finally {
    saveAnnotationLoading.value = false;
  }
}

// 生成聚合模板（需要至少3条已验证标注）
async function handleAggregateTemplate() {
  // 检查已验证标注数量
  if (annotationStats.value && annotationStats.value.verified < 3) {
    window.$message?.warning(`生成聚合模板至少需要 3 条已验证标注，当前仅 ${annotationStats.value.verified} 条`);
    return;
  }

  aggregateLoading.value = true;
  aggregatedTemplate.value = null;
  try {
    const { data, error } = await getAggregatedOcrTemplate(props.shopId);
    if (!error && data) {
      aggregatedTemplate.value = data;
      window.$message?.success(`聚合模板生成成功，基于 ${data.annotationCount} 条标注数据，可继续添加数据提高准确度`);
    } else {
      window.$message?.warning('暂无足够的标注数据生成聚合模板（至少需要3条已验证标注）');
    }
  } finally {
    aggregateLoading.value = false;
  }
}

// 应用聚合模板
function applyAggregatedTemplate() {
  if (!aggregatedTemplate.value) return;

  const template = aggregatedTemplate.value;
  templateConfig.name = template.name || `${props.shopName} 聚合模板`;
  templateConfig.imageWidth = template.imageWidth || templateConfig.imageWidth;
  templateConfig.imageHeight = template.imageHeight || templateConfig.imageHeight;

  if (template.regions) {
    const w = templateConfig.imageWidth || 1;
    const h = templateConfig.imageHeight || 1;
    Object.keys(template.regions).forEach(key => {
      const region = template.regions[key];
      if (region) {
        // 检测是否为相对坐标（0-1范围）
        const isRelative = region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;
        if (isRelative && w > 1) {
          (templateConfig.regions as any)[key] = {
            x: Math.round(region.x * w),
            y: Math.round(region.y * h),
            width: Math.round(region.width * w),
            height: Math.round(region.height * h),
          };
        } else {
          (templateConfig.regions as any)[key] = region;
        }
      } else {
        (templateConfig.regions as any)[key] = null;
      }
    });
  }

  redrawCanvas();
  window.$message?.success('已应用聚合模板');
}

// 重置编辑器状态（清除所有旧数据）
function resetEditor() {
  imageUrl.value = '';
  imageFile.value = null;
  validateResult.value = null;
  calibrationResult.value = null;
  aggregatedTemplate.value = null;
  currentOrderId.value = '';
  groundTruth.value = {};
  templateConfig.name = '';
  templateConfig.imageWidth = 0;
  templateConfig.imageHeight = 0;
  Object.keys(templateConfig.regions).forEach(key => {
    (templateConfig.regions as any)[key] = null;
  });
}

// 监听 visible 变化加载模板
watch(visible, (val) => {
  if (val) {
    resetEditor();
    loadTemplate();
    loadAnnotationStats(); // 加载标注统计
  } else {
    resetEditor();
  }
});

// 监听 shopId 变化，切换门店时重新加载
watch(() => props.shopId, (newId, oldId) => {
  if (newId && newId !== oldId && visible.value) {
    resetEditor();
    loadTemplate();
  }
});

watch(imgRef, () => {
  if (imgRef.value) {
    nextTick(() => redrawCanvas());
  }
});

watch(activeField, () => redrawCanvas());
</script>

<template>
  <NModal v-model:show="visible" preset="card" title="OCR 模板标注编辑器" style="width: 960px; max-height: 90vh;" :mask-closable="false">
    <NScrollbar style="max-height: calc(90vh - 120px);">
      <NSpace vertical :size="16">
        <!-- 使用说明 -->
        <NAlert type="info" :bordered="false">
          <template #header>使用说明</template>
          系统已支持<strong>关键字自动定位</strong>（识别"车牌号"等标签并提取旁边文字），无需标注区域也能识别。<br />
          区域标注为<strong>可选</strong>，用于补充关键字定位未识别到的字段。标注时请框选<strong>文字值本身</strong>（如"粤EZ9A33"），不是标签（如"车牌号："）。<br />
          坐标已自动归一化，不同尺寸的图片可通用同一模板。
        </NAlert>

        <!-- 模板基本信息 -->
        <NForm label-placement="left" :label-width="80" size="small">
          <NFormItem label="门店">
            <NInput :value="shopName" disabled />
          </NFormItem>
          <NFormItem label="模板名称">
            <NInput v-model:value="templateConfig.name" placeholder="如：盛通工单模板" />
          </NFormItem>
          <NFormItem label="图片尺寸">
            <NSpace>
              <NTag v-if="templateConfig.imageWidth" type="info" size="small">
                {{ templateConfig.imageWidth }} x {{ templateConfig.imageHeight }}
              </NTag>
              <span v-else class="text-gray-400">选择图片后自动获取</span>
            </NSpace>
          </NFormItem>
        </NForm>

        <!-- 图片来源选择 -->
        <NDivider title-placement="left">选择工单图片</NDivider>
        <NSpace>
          <NButton type="primary" size="small" @click="openOrderPicker">
            从系统工单选择（推荐）
          </NButton>
          <NUpload
            :max="1"
            accept="image/*"
            :show-file-list="false"
            :custom-request="({ file }) => handleImageUpload({ file: file as any })"
          >
            <NButton size="small">上传本地图片</NButton>
          </NUpload>
          <NButton
            type="success"
            size="small"
            :loading="smartAnnotateLoading"
            :disabled="!imageUrl"
            @click="handleSmartAnnotate"
          >
            智能标注
          </NButton>
          <NButton
            type="info"
            size="small"
            :loading="diagnoseLoading"
            :disabled="!imageUrl"
            @click="handleDiagnose"
          >
            诊断识别
          </NButton>
        </NSpace>

        <!-- 图片标注区域 -->
        <div v-if="imageUrl" style="position: relative; display: inline-block; border: 1px solid #e0e0e0; border-radius: 4px; overflow: hidden;">
          <img
            ref="imgRef"
            :src="imageUrl"
            crossorigin="anonymous"
            style="max-width: 100%; display: block; user-select: none;"
            @load="redrawCanvas"
          />
          <canvas
            ref="canvasRef"
            style="position: absolute; top: 0; left: 0; cursor: crosshair;"
            @mousedown="onCanvasMouseDown"
            @mousemove="onCanvasMouseMove"
            @mouseup="onCanvasMouseUp"
            @mouseleave="onCanvasMouseUp"
          />
        </div>

        <!-- 字段区域列表 -->
        <NDivider title-placement="left">字段区域标注</NDivider>
        <NAlert type="info" :bordered="false" size="small" style="margin-bottom: 8px;">
          点击"智能标注"可自动识别字段区域，标注不准确可手动修正。切换工单图片时坐标会自动清空。
        </NAlert>
        <NSpace vertical :size="8">
          <div
            v-for="field in fieldDefs"
            :key="field.key"
            :style="{
              border: `2px solid ${activeField === field.key ? field.color : '#e0e0e0'}`,
              borderRadius: '6px',
              padding: '8px 12px',
              cursor: 'pointer',
              background: activeField === field.key ? field.color + '10' : 'transparent',
            }"
            @click="activeField = field.key"
          >
            <NSpace justify="space-between" align="center">
              <NSpace align="center" :size="8">
                <span :style="{ color: field.color, fontWeight: 'bold' }">{{ field.label }}</span>
                <NTag v-if="templateConfig.regions[field.key]" size="small" :color="{ color: field.color + '20', textColor: field.color }">
                  已标注
                </NTag>
                <NTag v-else size="small" type="default">未标注</NTag>
              </NSpace>
              <NSpace :size="4">
                <NButton v-if="templateConfig.regions[field.key]" size="tiny" quaternary type="error" @click.stop="clearFieldRegion(field.key)">
                  清除
                </NButton>
              </NSpace>
            </NSpace>
          </div>
        </NSpace>

        <!-- 识别测试与智能校准（合并） -->
        <NDivider title-placement="left">识别测试与校准</NDivider>
        <NAlert v-if="Object.values(groundTruth).some(v => v)" type="info" :bordered="false" size="small">
          <template #header>当前工单已录入数据（作为校准基准）</template>
          系统会将 OCR 识别结果与已录入数据对比，准确率100%时自动保存标注并转为已验证状态。
        </NAlert>
        <NAlert v-else type="default" :bordered="false" size="small">
          当前图片无已录入数据，点击下方按钮仅测试识别效果。选择系统工单可自动加载已录入数据进行校准。
        </NAlert>

        <!-- 显示已录入的基准数据 -->
        <NCard v-if="Object.values(groundTruth).some(v => v)" size="small" :bordered="true">
          <template #header><span style="font-size: 13px;">基准数据（已录入）</span></template>
          <NSpace :size="4">
            <NTag v-if="groundTruth.orderNo" size="small" type="info">工单号: {{ groundTruth.orderNo }}</NTag>
            <NTag v-if="groundTruth.plateNumber" size="small" type="info">车牌: {{ groundTruth.plateNumber }}</NTag>
            <NTag v-if="groundTruth.customerName" size="small" type="info">客户: {{ groundTruth.customerName }}</NTag>
            <NTag v-if="groundTruth.phone" size="small" type="info">电话: {{ groundTruth.phone }}</NTag>
            <NTag v-if="groundTruth.carModel" size="small" type="info">车型: {{ groundTruth.carModel }}</NTag>
            <NTag v-if="groundTruth.date" size="small" type="info">日期: {{ groundTruth.date }}</NTag>
          </NSpace>
        </NCard>

        <NSpace :size="12">
          <NButton
            type="primary"
            size="small"
            :loading="calibrationLoading"
            :disabled="!imageUrl"
            @click="handleCalibrate"
          >
            {{ Object.values(groundTruth).some(v => v) ? '识别并校准' : '测试识别' }}
          </NButton>
        </NSpace>

        <!-- 识别/校准结果 -->
        <template v-if="calibrationResult">
          <!-- 有校准基准时显示对比结果 -->
          <NCard
            v-if="calibrationResult.accuracy >= 0"
            size="small"
            :bordered="true"
            :type="calibrationResult.accuracy >= 80 ? 'success' : calibrationResult.accuracy >= 50 ? 'warning' : 'error'"
          >
            <template #header>
              <NSpace align="center" :size="8">
                <span>校准结果</span>
                <NTag
                  size="small"
                  :type="calibrationResult.accuracy >= 80 ? 'success' : calibrationResult.accuracy >= 50 ? 'warning' : 'error'"
                >
                  准确率 {{ calibrationResult.accuracy }}%
                </NTag>
              </NSpace>
            </template>
            <NDescriptions label-placement="left" bordered size="small" :column="1">
              <NDescriptionsItem label="工单号">
                <NSpace align="center" :size="8">
                  <span :style="{ color: calibrationResult.matched.orderNo === false ? '#d03050' : '#18a058', fontWeight: 'bold' }">
                    {{ calibrationResult.expected.orderNo || '-' }}
                  </span>
                  <span>→</span>
                  <span :style="{ color: calibrationResult.matched.orderNo === false ? '#d03050' : '' }">
                    {{ calibrationResult.actual.orderNo || '未识别' }}
                  </span>
                  <NTag size="tiny" :type="calibrationResult.matched.orderNo !== false ? 'success' : 'error'">
                    {{ calibrationResult.matched.orderNo !== false ? '✓ 匹配' : '✗ 不匹配' }}
                  </NTag>
                </NSpace>
              </NDescriptionsItem>
              <NDescriptionsItem label="车牌号">
                <NSpace align="center" :size="8">
                  <span :style="{ color: calibrationResult.matched.plateNumber === false ? '#d03050' : '#18a058', fontWeight: 'bold' }">
                    {{ calibrationResult.expected.plateNumber || '-' }}
                  </span>
                  <span>→</span>
                  <span :style="{ color: calibrationResult.matched.plateNumber === false ? '#d03050' : '' }">
                    {{ calibrationResult.actual.plateNumber || '未识别' }}
                  </span>
                  <NTag size="tiny" :type="calibrationResult.matched.plateNumber !== false ? 'success' : 'error'">
                    {{ calibrationResult.matched.plateNumber !== false ? '✓ 匹配' : '✗ 不匹配' }}
                  </NTag>
                </NSpace>
              </NDescriptionsItem>
              <NDescriptionsItem label="客户名称">
                <NSpace align="center" :size="8">
                  <span :style="{ color: calibrationResult.matched.customerName === false ? '#d03050' : '#18a058', fontWeight: 'bold' }">
                    {{ calibrationResult.expected.customerName || '-' }}
                  </span>
                  <span>→</span>
                  <span :style="{ color: calibrationResult.matched.customerName === false ? '#d03050' : '' }">
                    {{ calibrationResult.actual.customerName || '未识别' }}
                  </span>
                  <NTag size="tiny" :type="calibrationResult.matched.customerName !== false ? 'success' : 'error'">
                    {{ calibrationResult.matched.customerName !== false ? '✓ 匹配' : '✗ 不匹配' }}
                  </NTag>
                </NSpace>
              </NDescriptionsItem>
              <NDescriptionsItem label="联系电话">
                <NSpace align="center" :size="8">
                  <span :style="{ color: calibrationResult.matched.phone === false ? '#d03050' : '#18a058', fontWeight: 'bold' }">
                    {{ calibrationResult.expected.phone || '-' }}
                  </span>
                  <span>→</span>
                  <span :style="{ color: calibrationResult.matched.phone === false ? '#d03050' : '' }">
                    {{ calibrationResult.actual.phone || '未识别' }}
                  </span>
                  <NTag size="tiny" :type="calibrationResult.matched.phone !== false ? 'success' : 'error'">
                    {{ calibrationResult.matched.phone !== false ? '✓ 匹配' : '✗ 不匹配' }}
                  </NTag>
                </NSpace>
              </NDescriptionsItem>
              <NDescriptionsItem label="车型">
                <NSpace align="center" :size="8">
                  <span :style="{ color: calibrationResult.matched.carModel === false ? '#d03050' : '#18a058', fontWeight: 'bold' }">
                    {{ calibrationResult.expected.carModel || '-' }}
                  </span>
                  <span>→</span>
                  <span :style="{ color: calibrationResult.matched.carModel === false ? '#d03050' : '' }">
                    {{ calibrationResult.actual.carModel || '未识别' }}
                  </span>
                  <NTag size="tiny" :type="calibrationResult.matched.carModel !== false ? 'success' : 'error'">
                    {{ calibrationResult.matched.carModel !== false ? '✓ 匹配' : '✗ 不匹配' }}
                  </NTag>
                </NSpace>
              </NDescriptionsItem>
              <NDescriptionsItem label="日期">
                <NSpace align="center" :size="8">
                  <span :style="{ color: calibrationResult.matched.date === false ? '#d03050' : '#18a058', fontWeight: 'bold' }">
                    {{ calibrationResult.expected.date || '-' }}
                  </span>
                  <span>→</span>
                  <span :style="{ color: calibrationResult.matched.date === false ? '#d03050' : '' }">
                    {{ calibrationResult.actual.date || '未识别' }}
                  </span>
                  <NTag size="tiny" :type="calibrationResult.matched.date !== false ? 'success' : 'error'">
                    {{ calibrationResult.matched.date !== false ? '✓ 匹配' : '✗ 不匹配' }}
                  </NTag>
                </NSpace>
              </NDescriptionsItem>
            </NDescriptions>
          </NCard>

          <!-- 无校准基准时只显示识别结果 -->
          <NCard v-else size="small" :bordered="true">
            <template #header><span>识别结果</span></template>
            <NDescriptions label-placement="left" bordered size="small" :column="1">
              <NDescriptionsItem label="工单号">
                <NTag :type="calibrationResult.actual.orderNo ? 'success' : 'default'" size="small">{{ calibrationResult.actual.orderNo || '未识别' }}</NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="车牌号">
                <NTag :type="calibrationResult.actual.plateNumber ? 'success' : 'default'" size="small">{{ calibrationResult.actual.plateNumber || '未识别' }}</NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="客户名称">
                <NTag :type="calibrationResult.actual.customerName ? 'success' : 'default'" size="small">{{ calibrationResult.actual.customerName || '未识别' }}</NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="联系电话">
                <NTag :type="calibrationResult.actual.phone ? 'success' : 'default'" size="small">{{ calibrationResult.actual.phone || '未识别' }}</NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="车型">
                <NTag :type="calibrationResult.actual.carModel ? 'success' : 'default'" size="small">{{ calibrationResult.actual.carModel || '未识别' }}</NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="日期">
                <NTag :type="calibrationResult.actual.date ? 'success' : 'default'" size="small">{{ calibrationResult.actual.date || '未识别' }}</NTag>
              </NDescriptionsItem>
            </NDescriptions>
          </NCard>

          <!-- 优化建议（仅校准模式且未100%时显示） -->
          <NAlert
            v-if="calibrationResult.accuracy >= 0 && calibrationResult.accuracy < 100"
            :type="calibrationResult.accuracy >= 70 ? 'warning' : 'error'"
            :bordered="false"
            size="small"
          >
            <template #header>优化建议</template>
            <p>有以下字段识别不匹配，建议调整标注区域：</p>
            <ul style="margin: 8px 0; padding-left: 20px;">
              <li v-if="calibrationResult.matched.orderNo === false"><strong>工单号</strong>：检查标注区域是否完整覆盖工单号文字</li>
              <li v-if="calibrationResult.matched.plateNumber === false"><strong>车牌号</strong>：检查标注区域是否完整覆盖车牌文字，注意字母和数字的区分</li>
              <li v-if="calibrationResult.matched.customerName === false"><strong>客户名称</strong>：中文姓名可能需要更大的标注区域</li>
              <li v-if="calibrationResult.matched.phone === false"><strong>联系电话</strong>：检查数字是否清晰可辨</li>
              <li v-if="calibrationResult.matched.carModel === false"><strong>车型</strong>：可能需要扩大标注区域包含更多上下文</li>
              <li v-if="calibrationResult.matched.date === false"><strong>日期</strong>：检查标注区域是否覆盖接车/开单/进厂/打印日期，系统按此优先级识别</li>
            </ul>
            <p style="margin-top: 8px;"><strong>提示</strong>：调整区域后重新点击"识别并校准"验证效果。准确率100%时将自动保存标注并转为已验证状态。</p>
          </NAlert>
        </template>

        <!-- 批量验证 -->
        <NDivider title-placement="left">批量验证准确率</NDivider>
        <NAlert type="info" :bordered="false" size="small">
          对该门店已审核工单的图片重新跑 OCR，与已录入数据对比，统计各字段准确率。验证过程较慢，请耐心等待。
        </NAlert>
        <NSpace>
          <NButton size="small" type="warning" :loading="validateLoading" @click="handleBatchValidate">
            开始批量验证（最近20条）
          </NButton>
        </NSpace>

        <template v-if="validateResult">
          <NDescriptions label-placement="left" bordered size="small" :column="1" title="准确率统计">
            <NDescriptionsItem v-for="(stat, key) in validateResult.fields" :key="key" :label="fieldLabelMap[key] || key">
              <NSpace align="center" :size="8">
                <NProgress
                  type="line"
                  :percentage="stat.accuracy"
                  :color="stat.accuracy >= 80 ? '#18a058' : stat.accuracy >= 50 ? '#f0a020' : '#d03050'"
                  :show-indicator="false"
                  style="width: 120px"
                  size="small"
                />
                <span>{{ stat.accuracy }}% ({{ stat.matched }}/{{ stat.total }})</span>
              </NSpace>
            </NDescriptionsItem>
          </NDescriptions>

          <NDivider title-placement="left" style="font-size: 13px;">详细对比（红色为不匹配）</NDivider>
          <div style="max-height: 300px; overflow: auto;">
            <NDataTable
              :data="validateResult.details"
              size="small"
              :columns="[
                { key: 'orderNo', title: '工单号', width: 100, render: (row: any) => row.orderNo || '-' },
                { key: 'plateNumber', title: '车牌号', width: 100, render: (row: any) => h('span', { style: { color: row.matched.plateNumber === false ? '#d03050' : '' } }, row.actual.plateNumber || '-') },
                { key: 'customerName', title: '客户名称', width: 90, render: (row: any) => h('span', { style: { color: row.matched.customerName === false ? '#d03050' : '' } }, row.actual.customerName || '-') },
                { key: 'phone', title: '电话', width: 120, render: (row: any) => h('span', { style: { color: row.matched.phone === false ? '#d03050' : '' } }, row.actual.phone || '-') },
                { key: 'carModel', title: '车型', width: 100, render: (row: any) => h('span', { style: { color: row.matched.carModel === false ? '#d03050' : '' } }, row.actual.carModel || '-') },
                { key: 'date', title: '日期', width: 110, render: (row: any) => h('span', { style: { color: row.matched.date === false ? '#d03050' : '' } }, row.actual.date || '-') },
              ]"
              :row-key="(row: any) => row.orderId"
            />
          </div>
        </template>

        <!-- 标注学习 -->
        <NDivider title-placement="left">标注学习（智能优化）</NDivider>
        <NAlert type="success" :bordered="false" size="small">
          <template #header>标注学习系统</template>
          通过在已审核工单上进行字段区域标注，系统会自动学习并聚合生成最优模板。<br />
          <strong>标注越多，识别越准确！</strong> 建议每家门店至少标注 5-10 张不同工单图片。
        </NAlert>

        <!-- 标注统计 -->
        <NCard size="small" :bordered="true" v-if="annotationStats">
          <template #header>
            <NSpace align="center" :size="8">
              <span>标注数据统计</span>
              <NTag type="info" size="small">共 {{ annotationStats.total }} 条</NTag>
              <NTag type="success" size="small">已验证 {{ annotationStats.verified }} 条</NTag>
              <NButton size="tiny" type="warning" quaternary @click="handleFixVerifiedStatus">修复验证状态</NButton>
            </NSpace>
          </template>
          <NSpace :size="4" v-if="annotationStats.coverage">
            <NText depth="3" style="font-size: 12px;">字段覆盖率：</NText>
            <NTag v-for="(count, key) in annotationStats.coverage" :key="key" size="tiny" :type="count > 0 ? 'success' : 'default'">
              {{ fieldLabelMap[key] || key }}: {{ count }}
            </NTag>
          </NSpace>
        </NCard>

        <!-- 标注操作按钮 -->
        <NSpace :size="12">
          <NButton
            type="success"
            size="small"
            :loading="saveAnnotationLoading"
            :disabled="!imageUrl"
            @click="handleSaveAnnotation"
          >
            保存当前标注（用于训练）
          </NButton>
          <NButton
            type="warning"
            size="small"
            :loading="aggregateLoading"
            @click="handleAggregateTemplate"
          >
            生成聚合模板
          </NButton>
          <NButton
            v-if="aggregatedTemplate"
            type="primary"
            size="small"
            @click="applyAggregatedTemplate"
          >
            应用聚合模板
          </NButton>
          <NButton
            size="small"
            @click="showAnnotationManager = true; loadAnnotationList(1)"
          >
            管理标注数据
          </NButton>
        </NSpace>

        <!-- 聚合模板预览 -->
        <NCard v-if="aggregatedTemplate" size="small" :bordered="true" title="聚合模板预览">
          <template #header-extra>
            <NButton size="tiny" type="error" quaternary @click="aggregatedTemplate = null">删除聚合模板</NButton>
          </template>
          <NDescriptions label-placement="left" bordered size="small" :column="1">
            <NDescriptionsItem label="名称">{{ aggregatedTemplate.name }}</NDescriptionsItem>
            <NDescriptionsItem label="基于标注数">
              <NTag type="success" size="small">{{ aggregatedTemplate.annotationCount }} 条</NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="推荐尺寸">
              {{ aggregatedTemplate.imageWidth }} x {{ aggregatedTemplate.imageHeight }}
            </NDescriptionsItem>
            <NDescriptionsItem label="字段覆盖率">
              <NSpace :size="4">
                <NTag v-for="(count, key) in aggregatedTemplate.fieldCoverage" :key="key" size="tiny" :type="count > 0 ? 'success' : 'default'">
                  {{ fieldLabelMap[key] || key }}: {{ count }}
                </NTag>
              </NSpace>
            </NDescriptionsItem>
          </NDescriptions>
          <NAlert type="info" :bordered="false" size="small" style="margin-top: 8px;">
            可继续添加标注数据后重新生成聚合模板，提高准确度。
          </NAlert>
        </NCard>
      </NSpace>
    </NScrollbar>

    <template #footer>
      <NSpace justify="end" style="width: 100%;">
        <NButton @click="visible = false">关闭</NButton>
      </NSpace>
    </template>
  </NModal>

  <!-- 工单选择弹窗 -->
  <NModal v-model:show="showOrderPicker" preset="card" title="选择工单图片" style="width: 800px; max-height: 80vh;" :mask-closable="true">
    <NSpace vertical :size="12">
      <NAlert type="info" :bordered="false" size="small">
        显示该门店已审核且有图片的工单，点击选择工单图片用于标注模板。
      </NAlert>
      <NSpin :show="orderLoading">
        <div style="max-height: 500px; overflow: auto;">
          <NGrid :cols="2" :x-gap="12" :y-gap="12">
            <NGridItem v-for="order in orderList" :key="order.id">
              <NCard
                size="small"
                hoverable
                style="cursor: pointer;"
                @click="selectOrder(order)"
              >
                <template #header>
                  <NSpace align="center" :size="8">
                    <NTag size="small" type="info">{{ order.orderNo || '-' }}</NTag>
                    <span style="font-size: 12px; color: #666;">{{ order.plateNumber || '-' }}</span>
                  </NSpace>
                </template>
                <div style="display: flex; gap: 8px; align-items: flex-start;">
                  <img
                    v-if="order.images?.[0]?.thumbnailUrl || order.images?.[0]?.url"
                    :src="getImageProxyUrl(order.images[0].thumbnailUrl || order.images[0].url)"
                    style="width: 120px; height: 80px; object-fit: cover; border-radius: 4px;"
                  />
                  <div style="flex: 1; font-size: 12px; color: #666; line-height: 1.8;">
                    <div v-if="order.customerName">客户：{{ order.customerName }}</div>
                    <div v-if="order.phone">电话：{{ order.phone }}</div>
                    <div v-if="order.carModel">车型：{{ order.carModel }}</div>
                    <div>{{ order.orderDate }}</div>
                  </div>
                </div>
              </NCard>
            </NGridItem>
          </NGrid>
          <NEmpty v-if="!orderLoading && orderList.length === 0" description="暂无已审核的带图工单" />
        </div>
      </NSpin>
      <NSpace justify="center" v-if="orderPagination.total > orderPagination.size">
        <NPagination
          v-model:page="orderPagination.current"
          :page-size="orderPagination.size"
          :item-count="orderPagination.total"
          @update:page="loadOrders"
          size="small"
        />
      </NSpace>
    </NSpace>
  </NModal>

  <!-- 标注管理弹窗 -->
  <NModal v-model:show="showAnnotationManager" preset="card" title="标注数据管理" style="width: 800px; max-height: 80vh;" :mask-closable="true">
    <NSpace vertical :size="12">
      <NAlert type="info" :bordered="false" size="small">
        管理当前门店的所有标注数据。可以查看、删除、重新编辑标注。删除后该标注将不再参与聚合模板计算。
      </NAlert>

      <NSpin :show="annotationListLoading">
        <div style="max-height: 500px; overflow: auto;">
          <NEmpty v-if="!annotationListLoading && annotationList.length === 0" description="暂无标注数据" />

          <NCard
            v-for="annotation in annotationList"
            :key="annotation.id"
            size="small"
            hoverable
            style="margin-bottom: 8px;"
          >
            <template #header>
              <NSpace align="center" :size="8">
                <NTag size="small" :type="annotation.isVerified && hasValidAnnotationRegions(annotation) ? 'success' : 'warning'">
                  {{ annotation.isVerified && hasValidAnnotationRegions(annotation) ? '已验证' : '待验证' }}
                </NTag>
                <span style="font-size: 12px; color: #666;">
                  {{ annotation.createdAt ? new Date(annotation.createdAt).toLocaleString('zh-CN') : '-' }}
                </span>
              </NSpace>
            </template>
            <template #header-extra>
              <NSpace :size="4">
                <NButton size="tiny" type="primary" quaternary @click="loadAnnotationToEditor(annotation)">
                  重新编辑
                </NButton>
                <NButton size="tiny" type="error" quaternary @click="handleDeleteAnnotation(annotation.id)">
                  删除
                </NButton>
              </NSpace>
            </template>

            <NSpace vertical :size="6">
              <!-- 图片预览 -->
              <div v-if="annotation.imageUrl" style="display: flex; gap: 8px; align-items: flex-start;">
                <img
                  :src="getImageProxyUrl(annotation.imageUrl)"
                  style="width: 100px; height: 70px; object-fit: cover; border-radius: 4px; border: 1px solid #eee;"
                />
                <div style="flex: 1; font-size: 12px; color: #666; line-height: 1.8;">
                  <div>尺寸：{{ annotation.imageWidth }} x {{ annotation.imageHeight }}</div>
                  <div v-if="annotation.orderId">工单ID：{{ annotation.orderId }}</div>
                </div>
              </div>

              <!-- 标注区域（仅已验证标注显示坐标） -->
              <div v-if="annotation.regions && Object.keys(annotation.regions).length > 0">
                <NText depth="3" style="font-size: 12px;">标注区域：</NText>
                <NSpace :size="4" style="margin-top: 2px;">
                  <NTag
                    v-for="(region, key) in annotation.regions"
                    :key="key"
                    v-show="region"
                    size="tiny"
                    :color="{ color: (getFieldColor(String(key)) || '#999999') + '20', textColor: getFieldColor(String(key)) || '#999999' }"
                  >
                    {{ fieldLabelMap[key] || key }}{{ annotation.isVerified && region ? ` (${region.x},${region.y})` : '' }}
                  </NTag>
                  <NText v-if="Object.values(annotation.regions).every(r => !r)" depth="3" style="font-size: 12px;">无区域标注</NText>
                </NSpace>
              </div>

              <!-- Ground Truth 数据 -->
              <div v-if="annotation.groundTruth && Object.values(annotation.groundTruth).some((v: any) => v)">
                <NText depth="3" style="font-size: 12px;">已录入数据（校准基准）：</NText>
                <NSpace :size="4" style="margin-top: 2px;">
                  <NTag v-if="annotation.groundTruth.orderNo" size="tiny" type="info">工单号: {{ annotation.groundTruth.orderNo }}</NTag>
                  <NTag v-if="annotation.groundTruth.plateNumber" size="tiny" type="info">车牌: {{ annotation.groundTruth.plateNumber }}</NTag>
                  <NTag v-if="annotation.groundTruth.customerName" size="tiny" type="info">客户: {{ annotation.groundTruth.customerName }}</NTag>
                  <NTag v-if="annotation.groundTruth.phone" size="tiny" type="info">电话: {{ annotation.groundTruth.phone }}</NTag>
                  <NTag v-if="annotation.groundTruth.carModel" size="tiny" type="info">车型: {{ annotation.groundTruth.carModel }}</NTag>
                  <NTag v-if="annotation.groundTruth.date" size="tiny" type="info">日期: {{ annotation.groundTruth.date }}</NTag>
                </NSpace>
              </div>
            </NSpace>
          </NCard>
        </div>
      </NSpin>

      <NSpace justify="center" v-if="annotationListTotal > 10">
        <NPagination
          v-model:page="annotationPage"
          :page-size="10"
          :item-count="annotationListTotal"
          @update:page="loadAnnotationList"
          size="small"
        />
      </NSpace>

      <NDescriptions label-placement="left" size="small" :column="2" bordered>
        <NDescriptionsItem label="标注总数">{{ annotationListTotal }}</NDescriptionsItem>
        <NDescriptionsItem label="当前页">{{ annotationPage }}</NDescriptionsItem>
      </NDescriptions>
    </NSpace>
  </NModal>

  <!-- OCR 诊断结果弹窗 -->
  <NModal v-model:show="showDiagnoseModal" preset="card" title="OCR 诊断结果" style="width: 800px; max-height: 85vh; overflow: auto;" :mask-closable="false">
    <template v-if="diagnoseResult">
      <NSpace vertical :size="16">
        <!-- 服务状态 -->
        <NAlert :type="diagnoseResult.paddleAvailable ? 'success' : 'error'" :bordered="false">
          PaddleOCR 服务：{{ diagnoseResult.paddleAvailable ? '可用' : '不可用' }}
        </NAlert>

        <!-- 最终识别结果 -->
        <div>
          <div style="font-weight: bold; margin-bottom: 8px;">最终识别结果</div>
          <NDescriptions label-placement="left" size="small" :column="2" bordered>
            <NDescriptionsItem v-for="key in ['orderNo', 'plateNumber', 'customerName', 'phone', 'carModel', 'date']" :key="key" :label="fieldLabelMap[key]">
              <NText :type="diagnoseResult.finalResult[key] ? 'success' : 'error'">
                {{ diagnoseResult.finalResult[key] || '（未识别）' }}
              </NText>
            </NDescriptionsItem>
          </NDescriptions>
        </div>

        <!-- 关键字识别详情 -->
        <div v-if="diagnoseResult.keywordDetails && diagnoseResult.keywordDetails.length > 0">
          <div style="font-weight: bold; margin-bottom: 8px;">关键字定位识别详情</div>
          <div v-for="item in diagnoseResult.keywordDetails" :key="item.field" style="padding: 8px; border: 1px solid #e0e0e0; border-radius: 4px; margin-bottom: 8px;">
            <NSpace align="center" justify="space-between">
              <div>
                <NTag size="small" type="info">{{ fieldLabelMap[item.field] || item.field }}</NTag>
                <NText depth="3" size="small" style="margin-left: 8px;">匹配标签：{{ item.label || '无' }}</NText>
              </div>
              <NText size="small" depth="3">置信度：{{ (item.confidence * 100).toFixed(1) }}%</NText>
            </NSpace>
            <div style="margin-top: 6px; font-size: 13px;">
              <NText depth="3">原始文本：</NText>
              <NText>{{ item.rawText || '（空）' }}</NText>
            </div>
            <div style="margin-top: 4px; font-size: 13px;">
              <NText depth="3">提取结果：</NText>
              <NText :type="item.extracted ? 'success' : 'error'">{{ item.extracted || '（提取失败）' }}</NText>
            </div>
          </div>
        </div>

        <!-- 区域识别详情 -->
        <div v-if="diagnoseResult.regionDetails && diagnoseResult.regionDetails.length > 0">
          <div style="font-weight: bold; margin-bottom: 8px;">区域识别详情（使用模板标注的区域）</div>
          <div v-for="item in diagnoseResult.regionDetails" :key="item.field" style="padding: 8px; border: 1px solid #e0e0e0; border-radius: 4px; margin-bottom: 8px;">
            <NSpace align="center" justify="space-between">
              <div>
                <NTag size="small" type="warning">{{ fieldLabelMap[item.field] || item.field }}</NTag>
                <NTag v-if="item.usedFallback" size="small" type="warning" style="margin-left: 8px;">使用了原始文本回退</NTag>
              </div>
              <NText size="small" depth="3">置信度：{{ (item.confidence * 100).toFixed(1) }}%</NText>
            </NSpace>
            <div style="margin-top: 6px; font-size: 13px;">
              <NText depth="3">原始文本：</NText>
              <NText>{{ item.rawText || '（空）' }}</NText>
            </div>
            <div style="margin-top: 4px; font-size: 13px;">
              <NText depth="3">提取结果：</NText>
              <NText :type="item.extracted ? 'success' : 'error'">{{ item.extracted || '（提取失败）' }}</NText>
            </div>
          </div>
        </div>

        <NAlert v-if="diagnoseResult.regionDetails === null && diagnoseResult.regionResult === null" type="warning" :bordered="false">
          未配置 OCR 模板区域，仅使用关键字定位识别。建议在上方标注字段区域以提高识别准确率。
        </NAlert>
      </NSpace>
    </template>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showDiagnoseModal = false">关闭</NButton>
      </NSpace>
    </template>
  </NModal>
</template>
