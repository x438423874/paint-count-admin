<script setup lang="ts">
import { computed, reactive, watch, ref, nextTick, h } from 'vue';
import { NSelect, NInputNumber, NCheckbox, NButton, NText, NImage, NTag, NSpace } from 'naive-ui';
import { createWorkOrder, updateWorkOrder, fetchPaintShopList, fetchShopCategoriesWithStandard, fetchSpecialPaintList, uploadWorkOrderImage, removeWorkOrderImage, ocrRecognizeImage, fetchOrderNoRules } from '@/service/api';
import type { PaintOrderStatus, OrderNoRule } from '@/service/api/paint';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';
import { $t } from '@/locales';
import { compressDualImage } from '@/utils/image-compress';

defineOptions({
  name: 'WorkOrderOperateDrawer'
});

interface Props {
  operateType: NaiveUI.TableOperateType;
  rowData?: any | null;
}

const props = defineProps<Props>();

interface Emits {
  (e: 'submitted'): void;
}

const emit = defineEmits<Emits>();

const visible = defineModel<boolean>('visible', {
  default: false
});

const { formRef, validate, restoreValidation } = useNaiveForm();
const { defaultRequiredRule } = useFormRules();

const shops = ref<{ id: string; name: string; code: string; brand: string; standardTemplateId?: string }[]>([]);
const categories = ref<{ id: string; name: string; alias: string; paintCount: number; newPartAddition: number }[]>([]);
const specialPaints = ref<{ id: string; name: string; multiplier: number }[]>([]);
const loadingCategories = ref(false);
const shopHasTemplate = ref(true);
const orderNoRules = ref<OrderNoRule[]>([]);
const ocrOrderNoCandidates = ref<string[]>([]);
const ocrOrderNoOriginal = ref('');

const title = computed(() => {
  const titles: Record<NaiveUI.TableOperateType, string> = {
    add: '新增工单',
    edit: '编辑工单'
  };
  return titles[props.operateType];
});

interface OrderItem {
  categoryId: string;
  categoryName?: string;
  quantity: number;
  newPartQuantity: number;
  specialPaintId: string;
}

interface FormModel {
  orderNo: string;
  shopId: string;
  orderDate: string;
  carModel: string;
  plateNumber: string;
  vin: string;
  brand: string;
  customerName: string;
  phone: string;
  contactPerson: string;
  description: string;
  remark: string;
  status: PaintOrderStatus;
  settlementMonth: string;
  items: OrderItem[];
}

const model: FormModel = reactive(createDefaultModel());

function createDefaultModel(): FormModel {
  return {
    orderNo: '',
    shopId: '',
    orderDate: '',
    carModel: '',
    plateNumber: '',
    vin: '',
    brand: '',
    customerName: '',
    phone: '',
    contactPerson: '',
    description: '',
    remark: '',
    status: 'DRAFT',
    settlementMonth: '',
    items: []
  };
}

type RuleKey = Extract<keyof FormModel, 'shopId' | 'plateNumber'>;

const rules: Record<RuleKey, App.Global.FormRule> = {
  shopId: defaultRequiredRule,
  plateNumber: defaultRequiredRule
};

const orderNoValidation = computed(() => {
  if (!model.orderNo || orderNoRules.value.length === 0) return { valid: true, message: '', candidates: [] as string[] };
  const upper = model.orderNo.trim().toUpperCase();
  for (const rule of orderNoRules.value) {
    try {
      const regex = new RegExp(`^${rule.pattern}$`);
      if (regex.test(upper)) return { valid: true, message: '', candidates: [] as string[] };
    } catch {
      continue;
    }
  }
  const candidates = generateOrderNoCandidates(upper, orderNoRules.value);
  return {
    valid: false,
    message: `工单号不符合门店规则（长度应为 ${orderNoRules.value.map(r => r.length).join('/')}` +
      (candidates.length > 0 ? '，点击候选值一键修正' : '）'),
    candidates
  };
});

function generateOrderNoCandidates(orderNo: string, rules: OrderNoRule[]): string[] {
  const substitutions: Record<string, string[]> = {
    '0': ['O'], 'O': ['0'], 'o': ['0'],
    '1': ['I', 'l'], 'I': ['1', 'l'], 'i': ['1', 'l'], 'l': ['1', 'I'],
    '2': ['Z'], 'Z': ['2'], 'z': ['2'],
    '5': ['S'], 'S': ['5'], 's': ['5'],
    '8': ['B'], 'B': ['8'], 'b': ['8'],
    '6': ['G'], 'G': ['6'], 'g': ['6']
  };
  const positions: number[] = [];
  for (let i = 0; i < orderNo.length; i++) {
    if (substitutions[orderNo[i]]?.length) positions.push(i);
  }
  const limited = positions.slice(0, 5);
  if (limited.length === 0) return [];
  const results = new Set<string>();
  const total = 1 << limited.length;
  for (let mask = 1; mask < total; mask++) {
    const chars = orderNo.split('');
    for (let i = 0; i < limited.length; i++) {
      if ((mask >> i) & 1) {
        const pos = limited[i];
        chars[pos] = substitutions[chars[pos]][0];
      }
    }
    const candidate = chars.join('');
    if (rules.some(r => new RegExp(`^${r.pattern}$`).test(candidate))) {
      results.add(candidate);
    }
  }
  return Array.from(results).slice(0, 5);
}

async function loadOrderNoRules(shopId: string) {
  if (!shopId) {
    orderNoRules.value = [];
    return;
  }
  const { data } = await fetchOrderNoRules(shopId);
  orderNoRules.value = data || [];
}

async function loadShops() {
  const { data, error } = await fetchPaintShopList();
  if (!error && data) {
    shops.value = data;
  }
}
loadShops();

async function loadSpecialPaints() {
  const { data, error } = await fetchSpecialPaintList(undefined, true);
  if (!error && data) {
    specialPaints.value = data.map((sp: any) => ({ id: sp.id, name: sp.name, multiplier: Number(sp.multiplier) }));
  }
}
loadSpecialPaints();

async function onShopChange(shopId: string, isInit = false) {
  if (!isInit) {
    categories.value = [];
    model.items = [];
  }
  if (!shopId) {
    shopHasTemplate.value = true;
    return;
  }

  loadingCategories.value = true;
  const { data, error } = await fetchShopCategoriesWithStandard(shopId);
  // eslint-disable-next-line no-console
  console.log('[fetchShopCategoriesWithStandard] raw data:', JSON.parse(JSON.stringify(data)));
  if (!error && data) {
    const items = (data as any[]).filter((s: any) => Number(s.coefficient) > 0);
    if (items.length === 0 && (data as any[]).length === 0) {
      shopHasTemplate.value = false;
    } else {
      shopHasTemplate.value = true;
    }
    categories.value = items.map((s: any) => ({
      id: s.categoryId || s.category?.id || '',
      name: s.alias || s.category?.name || '',
      alias: s.alias || '',
      paintCount: Number(s.coefficient) || 0,
      newPartAddition: Number(s.newPartAddition) || 0
    }));
    // eslint-disable-next-line no-console
    console.log('[fetchShopCategoriesWithStandard] mapped categories:', JSON.parse(JSON.stringify(categories.value)));

    // 编辑初始化时：若 categoryId 找不到对应系统部位，但保存了名字，则按名字自动匹配
    if (isInit) {
      model.items.forEach(item => {
        if (item.categoryId && categories.value.some(c => c.id === item.categoryId)) return;
        const nameHint = item.categoryName;
        if (!nameHint) return;
        const match = categories.value.find(
          c => c.name === nameHint || c.alias === nameHint
        );
        if (match) item.categoryId = match.id;
      });
    }
  } else {
    shopHasTemplate.value = false;
  }
  loadingCategories.value = false;
}

function addItem(count = 1) {
  for (let i = 0; i < count; i++) {
    model.items.push({ categoryId: '', quantity: 1, newPartQuantity: 0, specialPaintId: '' });
  }
}

function getAvailableCategories(currentCategoryId?: string) {
  const selectedIds = new Set(model.items.filter(i => i.categoryId && i.categoryId !== currentCategoryId).map(i => i.categoryId));
  return categories.value
    .filter(c => !selectedIds.has(c.id))
    .map(c => ({ label: `${c.name} (${(Number(c.paintCount) || 0).toFixed(1)}幅)`, value: c.id }));
}

const canAddItem = computed(() => {
  return model.shopId && model.items.every(item => item.categoryId);
});

function removeItem(index: number) {
  model.items.splice(index, 1);
}

const itemColumns = computed(() => {
  // 显式依赖 items，让表格在增删行或切换项目时重新渲染列
  const itemDependency = model.items.map(i => `${i.categoryId}:${i.quantity}:${i.newPartQuantity}:${i.specialPaintId}`).join('|');
  return [
    {
      key: 'categoryId',
      title: '项目名称',
    width: 200,
    render: (_row: any, index: number) => {
      const item = model.items[index];
      return h(NSelect, {
        value: item.categoryId,
        options: getAvailableCategories(item.categoryId),
        placeholder: '选择项目',
        loading: loadingCategories.value,
        size: 'small',
        onUpdateValue: (val: string) => { item.categoryId = val; }
      });
    }
  },
  {
    key: 'quantity',
    title: '数量',
    width: 80,
    align: 'center' as const,
    render: (_row: any, index: number) => {
      const item = model.items[index];
      return h(NInputNumber, {
        value: item.quantity,
        min: 1,
        max: 99,
        size: 'small',
        style: 'width: 100%',
        onUpdateValue: (val: number | null) => { if (val !== null) item.quantity = val; }
      });
    }
  },
  {
    key: 'newPartQuantity',
    title: '新件数',
    width: 80,
    align: 'center' as const,
    render: (_row: any, index: number) => {
      const item = model.items[index];
      return h(NInputNumber, {
        value: item.newPartQuantity,
        min: 0,
        max: item.quantity,
        size: 'small',
        style: 'width: 100%',
        onUpdateValue: (val: number | null) => { if (val !== null) item.newPartQuantity = val; }
      });
    }
  },
  {
    key: 'specialPaintId',
    title: '特殊车漆',
    width: 160,
    render: (_row: any, index: number) => {
      const item = model.items[index];
      return h(NSelect, {
        value: item.specialPaintId || null,
        options: [{ label: '无', value: '' }, ...specialPaints.value.map(sp => ({ label: `${sp.name} x${sp.multiplier}`, value: sp.id }))],
        placeholder: '无',
        size: 'small',
        clearable: true,
        onUpdateValue: (val: string) => { item.specialPaintId = val || ''; }
      });
    }
  },
  {
    key: 'paintCount',
    title: '幅数',
    width: 70,
    align: 'center' as const,
    render: (_row: any, index: number) => {
      const item = model.items[index];
      const count = getCategoryPaintCount(item.categoryId, item.newPartQuantity, item.quantity, item.specialPaintId);
      return h(NText, { depth: 3 }, () => `${count.toFixed(1)}`);
    }
  },
  {
    key: 'operate',
    title: '操作',
    width: 50,
    align: 'center' as const,
    render: (_row: any, index: number) => {
      return h(NButton, {
        type: 'error',
        quaternary: true,
        size: 'small',
        onClick: () => removeItem(index)
      }, { icon: () => h('span', { class: 'i-ic-round-delete' }) });
    }
  }
  ];
});

function getCategoryName(categoryId: string) {
  const cat = categories.value.find(c => c.id === categoryId);
  return cat?.name || '';
}

function getCategoryPaintCount(categoryId: string, newPartQuantity: number, totalQuantity: number, specialPaintId?: string) {
  const cat = categories.value.find(c => c.id === categoryId);
  if (!cat) return 0;
  const base = Number.isNaN(cat.paintCount) ? 0 : cat.paintCount;
  const addition = Number.isNaN(cat.newPartAddition) ? 0 : cat.newPartAddition;
  // 非新件幅数 + 新件幅数
  const oldCount = totalQuantity - newPartQuantity;
  let result = base * oldCount + (base + addition) * newPartQuantity;
  // 特殊车漆倍数
  if (specialPaintId) {
    const sp = specialPaints.value.find(s => s.id === specialPaintId);
    if (sp) result *= sp.multiplier;
  }
  return result;
}

const totalPaintCount = computed(() => {
  return model.items.reduce((sum, item) => {
    const count = getCategoryPaintCount(item.categoryId, item.newPartQuantity, item.quantity, item.specialPaintId);
    return sum + count;
  }, 0);
});

// 图片上传相关
interface ImageItem {
  id?: string;
  url: string;
  thumbnailUrl?: string | null;
  imageType: string;
  status: 'finished' | 'uploading' | 'error';
  file?: File;
}

const images = ref<ImageItem[]>([]);
const uploadingImage = ref(false);
const backendOrigin = ''; // 通过Vite代理访问，无需后端根地址

// OCR 相关状态
const ocrLoading = ref(false);
const ocrMode = ref<'all' | 'basic' | 'items'>('all');
const showOcrModal = ref(false);
const ocrImageIndex = ref(-1);
const ocrCanvasRef = ref<HTMLCanvasElement | null>(null);
const ocrImgRef = ref<HTMLImageElement | null>(null);
const isDrawing = ref(false);
const drawStart = ref({ x: 0, y: 0 });
const drawEnd = ref({ x: 0, y: 0 });
const hasCropRegion = ref(false);

// OCR 可识别字段标签
const ocrFieldLabels = ['工单号', '车牌号', '客户名称', '联系电话', '车型', '车架号', '品牌', '日期'];

// OCR 冲突确认弹窗
const showConflictModal = ref(false);
const conflictFields = ref<Array<{ key: string; label: string; oldValue: string; newValue: string; checked: boolean }>>([]);

// 获取图片的显示URL
// 列表展示用缩略图（加载快），OCR用高清图
function getImageDisplayUrl(img: ImageItem): string {
  if (img.url.startsWith('blob:')) return img.url;
  // 优先使用缩略图展示
  if (img.thumbnailUrl) return `/proxy-demo${img.thumbnailUrl}`;
  return `/proxy-demo${img.url}`;
}

// 获取高清图URL（用于OCR识别）
function getHdImageUrl(img: ImageItem): string {
  if (img.url.startsWith('blob:')) return img.url;
  return `/proxy-demo${img.url}`;
}

// 打开OCR识别弹窗
function openOcrModal(index: number) {
  ocrImageIndex.value = index;
  showOcrModal.value = true;
  hasCropRegion.value = false;
  drawStart.value = { x: 0, y: 0 };
  drawEnd.value = { x: 0, y: 0 };

  nextTick(() => {
    const img = images.value[index];
    if (!img) return;
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = () => {
      ocrImgRef.value = imgEl;
      drawOcrCanvas();
    };
    // OCR 用高清图
    imgEl.src = getHdImageUrl(img);
  });
}

// 快速OCR识别：直接对第一张图片进行全图识别，跳过弹窗
async function ocrQuickRecognize() {
  if (images.value.length === 0) {
    window.$message?.warning('请先上传工单图片');
    return;
  }
  ocrImageIndex.value = 0;

  // 预加载图片到 ocrImgRef，以防 fetch 失败时降级到 canvas 方式
  const img = images.value[0];
  if (img && !img.file) {
    await new Promise<void>((resolve) => {
      const imgEl = new Image();
      imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => {
        ocrImgRef.value = imgEl;
        resolve();
      };
      imgEl.onerror = () => resolve();
      imgEl.src = getHdImageUrl(img);
    });
  }

  await ocrRecognizeFull();
}

// 绘制OCR画布（图片+可选框选区域）
function drawOcrCanvas() {
  const canvas = ocrCanvasRef.value;
  const imgEl = ocrImgRef.value;
  if (!canvas || !imgEl) return;

  const maxW = 860;
  const maxH = 640;
  const scale = Math.min(maxW / imgEl.naturalWidth, maxH / imgEl.naturalHeight, 1);
  const displayW = Math.round(imgEl.naturalWidth * scale);
  const displayH = Math.round(imgEl.naturalHeight * scale);

  // 使用设备像素比提高清晰度
  const dpr = window.devicePixelRatio || 1;
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.drawImage(imgEl, 0, 0, displayW, displayH);

  // 绘制框选区域
  if (hasCropRegion.value) {
    const x = Math.min(drawStart.value.x, drawEnd.value.x);
    const y = Math.min(drawStart.value.y, drawEnd.value.y);
    const w = Math.abs(drawEnd.value.x - drawStart.value.x);
    const h = Math.abs(drawEnd.value.y - drawStart.value.y);

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, displayW, displayH);
    // 清除选区
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(imgEl, x / scale, y / scale, w / scale, h / scale, x, y, w, h);
    // 选区边框
    ctx.strokeStyle = '#18a058';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
  }
}

// 鼠标事件：框选区域
function onOcrMouseDown(e: MouseEvent) {
  const canvas = ocrCanvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  isDrawing.value = true;
  drawStart.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  drawEnd.value = { ...drawStart.value };
  hasCropRegion.value = false;
}

function onOcrMouseMove(e: MouseEvent) {
  if (!isDrawing.value) return;
  const canvas = ocrCanvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  drawEnd.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  hasCropRegion.value = true;
  drawOcrCanvas();
}

function onOcrMouseUp() {
  isDrawing.value = false;
}

// 全图OCR识别（调用后端 PaddleOCR API）
async function ocrRecognizeFull() {
  const img = images.value[ocrImageIndex.value];
  if (!img?.file && !img?.url) return;

  ocrLoading.value = true;
  try {
    let blob: Blob | null = null;

    if (img.file) {
      // 新上传的图片，直接用文件
      blob = img.file;
    } else {
      // 已有图片（URL），优先通过 fetch 下载原始图片（避免 canvas 跨域污染和质量损失）
      try {
        const hdUrl = getHdImageUrl(img);
        const response = await fetch(hdUrl, { mode: 'cors' });
        if (response.ok) {
          blob = await response.blob();
        }
      } catch {
        // fetch 失败（可能是跨域），降级到 canvas 方式
        console.warn('fetch 图片失败，降级到 canvas 方式');
      }

      if (!blob) {
        // fetch 失败，使用 canvas 方式
        const imgEl = ocrImgRef.value;
        if (!imgEl) {
          window.$message?.error('无法获取图片');
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext('2d')!.drawImage(imgEl, 0, 0);

        blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/png');
        });
      }
    }

    // 调用后端 PaddleOCR 识别
    const formData = new FormData();
    formData.append('file', blob, 'ocr_image.png');
    if (model.shopId) formData.append('shopId', model.shopId);
    formData.append('ocrMode', ocrMode.value);
    const { data, error } = await ocrRecognizeImage(formData);
    if (!error && data) {
      applyOcrResult(data);
      showOcrModal.value = false;
    } else {
      // 后端识别失败（通常是 PaddleOCR 服务未启动）
      const errMsg = (error as any)?.message || 'OCR识别失败，请确认 PaddleOCR 服务已启动';
      window.$message?.error(errMsg);
    }
  } catch {
    window.$message?.error('OCR识别失败，请确认 PaddleOCR 服务已启动（端口 8500）');
  } finally {    ocrLoading.value = false;
  }
}

// 将OCR识别结果应用到表单（空字段直接填充，冲突字段弹窗确认）
function applyOcrResult(result: { plateNumber?: string; orderNo?: string; orderNoValid?: boolean; orderNoCandidates?: string[]; customerName?: string; phone?: string; carModel?: string; vin?: string; brand?: string; date?: string }) {
  const fieldMap: Array<{ key: 'plateNumber' | 'orderNo' | 'customerName' | 'phone' | 'carModel' | 'vin' | 'brand' | 'orderDate'; label: string; ocrKey: string }> = [
    { key: 'plateNumber', label: '车牌号', ocrKey: 'plateNumber' },
    { key: 'orderNo', label: '工单号', ocrKey: 'orderNo' },
    { key: 'customerName', label: '客户名称', ocrKey: 'customerName' },
    { key: 'phone', label: '联系电话', ocrKey: 'phone' },
    { key: 'carModel', label: '车型', ocrKey: 'carModel' },
    { key: 'vin', label: '车架号', ocrKey: 'vin' },
    { key: 'brand', label: '品牌', ocrKey: 'brand' },
    { key: 'orderDate', label: '日期', ocrKey: 'date' },
  ];

  const filledMessages: string[] = [];
  const conflicts: Array<{ key: string; label: string; oldValue: string; newValue: string; checked: boolean }> = [];

  // 记录 OCR 工单号纠正信息
  ocrOrderNoOriginal.value = result.orderNo || '';
  ocrOrderNoCandidates.value = result.orderNoCandidates || [];

  for (const { key, label, ocrKey } of fieldMap) {
    const ocrValue = ((result as any)[ocrKey] || '').trim();
    if (!ocrValue) continue;

    const currentValue = (model[key] || '').trim();
    if (!currentValue) {
      // 空字段直接填充
      (model as any)[key] = ocrValue;
      filledMessages.push(`${label}：${ocrValue}`);
    } else if (currentValue !== ocrValue) {
      // 冲突字段，加入确认列表
      conflicts.push({ key, label, oldValue: currentValue, newValue: ocrValue, checked: false });
    }
  }

  if (filledMessages.length > 0) {
    window.$message?.success(`已填充 ${filledMessages.join('、')}`);
  }

  if (conflicts.length > 0) {
    // 有冲突字段，弹出确认弹窗
    conflictFields.value = conflicts;
    showConflictModal.value = true;
  } else if (filledMessages.length === 0) {
    window.$message?.warning('未识别到有效信息，请尝试框选标记区域识别');
  }
}

// 确认覆盖冲突字段
function confirmConflictOverwrite() {
  const selected = conflictFields.value.filter(f => f.checked);
  for (const field of selected) {
    (model as any)[field.key] = field.newValue;
  }
  if (selected.length > 0) {
    window.$message?.success(`已覆盖 ${selected.map(f => f.label).join('、')}`);
  }
  showConflictModal.value = false;
  conflictFields.value = [];
}

// 框选区域OCR识别（裁剪后调用后端 PaddleOCR API）
async function ocrRecognizeCrop() {
  const imgEl = ocrImgRef.value;
  if (!imgEl || !hasCropRegion.value) return;

  const canvas = ocrCanvasRef.value;
  if (!canvas) return;

  // CSS 显示尺寸（不含 dpr）
  const cssWidth = parseFloat(canvas.style.width);
  const cssHeight = parseFloat(canvas.style.height);

  // CSS 坐标与原图的比例
  const scale = cssWidth / imgEl.naturalWidth;

  // 将 CSS 坐标换算为原图坐标
  const region = {
    x: Math.min(drawStart.value.x, drawEnd.value.x) / scale,
    y: Math.min(drawStart.value.y, drawEnd.value.y) / scale,
    width: Math.abs(drawEnd.value.x - drawStart.value.x) / scale,
    height: Math.abs(drawEnd.value.y - drawStart.value.y) / scale
  };

  if (region.width < 10 || region.height < 10) {
    window.$message?.warning('框选区域太小，请重新选择');
    return;
  }

  ocrLoading.value = true;
  try {
    // 从原图裁剪区域，转为 blob 发送给后端 PaddleOCR
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.round(region.width);
    cropCanvas.height = Math.round(region.height);
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(
      imgEl,
      Math.round(region.x),
      Math.round(region.y),
      Math.round(region.width),
      Math.round(region.height),
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      cropCanvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('裁剪失败'));
      }, 'image/png');
    });

    // 调用后端 PaddleOCR 识别
    const formData = new FormData();
    formData.append('file', blob, 'ocr_crop.png');
    if (model.shopId) formData.append('shopId', model.shopId);
    formData.append('ocrMode', ocrMode.value);
    const { data, error } = await ocrRecognizeImage(formData);
    if (!error && data) {
      applyOcrResult(data);
      showOcrModal.value = false;
    } else {
      const errMsg = (error as any)?.message || 'OCR识别失败，请确认 PaddleOCR 服务已启动';
      window.$message?.error(errMsg);
    }
  } catch {
    window.$message?.error('OCR识别失败，请确认 PaddleOCR 服务已启动（端口 8500）');
  } finally {
    ocrLoading.value = false;
  }
}

function handleInitModel() {
  Object.assign(model, createDefaultModel());
  images.value = [];

  if (props.operateType === 'edit' && props.rowData) {
    Object.assign(model, {
      orderNo: props.rowData.orderNo || '',
      shopId: props.rowData.shopId || props.rowData.shop?.id || '',
      orderDate: props.rowData.orderDate ? new Date(props.rowData.orderDate).toISOString().split('T')[0] : '',
      carModel: props.rowData.carModel || '',
      plateNumber: props.rowData.plateNumber || '',
      vin: props.rowData.vin || '',
      brand: props.rowData.brand || '',
      customerName: props.rowData.customerName || '',
      phone: props.rowData.phone || '',
      contactPerson: props.rowData.contactPerson || '',
      description: props.rowData.description || '',
      remark: props.rowData.remark || '',
      status: props.rowData.status || 'PENDING',
      settlementMonth: props.rowData.settlementMonth || '',
      items: (props.rowData.items || []).map((it: any) => ({
        categoryId: it.categoryId || it.category?.id || '',
        categoryName: it.category?.name || it.categoryName || '',
        quantity: it.quantity || 1,
        newPartQuantity: it.newPartQuantity || 0,
        specialPaintId: it.specialPaintId || ''
      }))
    });
    // 加载已有图片
    images.value = (props.rowData.images || []).map((img: any) => ({
      id: img.id,
      url: img.url,
      thumbnailUrl: img.thumbnailUrl,
      imageType: img.imageType || 'BEFORE',
      status: 'finished' as const
    }));
    if (model.shopId) {
      onShopChange(model.shopId, true);
    }
  }
}

async function handleUploadImage({ file }: { file: File }) {
  if (!props.rowData?.id && props.operateType !== 'add') return;

  // 生成双图：高清版(OCR+存档) + 缩略版(展示)
  const { hd, thumbnail } = await compressDualImage(file);

  // 新增模式下先保存到本地预览，提交工单后再上传
  if (props.operateType === 'add') {
    const url = URL.createObjectURL(file);
    images.value.push({ url, imageType: 'BEFORE', status: 'finished', file: hd });
  } else {
    // 编辑模式下直接上传
    uploadingImage.value = true;
    const formData = new FormData();
    formData.append('imageType', 'BEFORE');
    formData.append('file', hd);
    formData.append('thumbnail', thumbnail);
    const { data, error } = await uploadWorkOrderImage(props.rowData.id, formData);
    if (!error && data) {
      images.value.push({ id: data.id, url: data.url, thumbnailUrl: data.thumbnailUrl, imageType: data.imageType || 'BEFORE', status: 'finished' });
    } else {
      window.$message?.error('图片上传失败');
    }
    uploadingImage.value = false;
  }
}

async function handleRemoveImage(index: number) {
  const img = images.value[index];
  if (img.id) {
    await removeWorkOrderImage(img.id);
  }
  images.value.splice(index, 1);
}

function closeDrawer() {
  visible.value = false;
}

async function handleSubmit() {
  await validate();

  if (props.operateType === 'add') {
    const { data: orderData, error } = await createWorkOrder({
      orderNo: model.orderNo || undefined,
      shopId: model.shopId,
      orderDate: model.orderDate,
      settlementMonth: model.settlementMonth || undefined,
      carModel: model.carModel,
      plateNumber: model.plateNumber,
      vin: model.vin || undefined,
      brand: model.brand || undefined,
      customerName: model.customerName,
      phone: model.phone || undefined,
      contactPerson: model.contactPerson || undefined,
      description: model.description || undefined,
      remark: model.remark || undefined,
      items: model.items.filter(it => it.categoryId).map(it => ({ categoryId: it.categoryId, quantity: it.quantity, newPartQuantity: it.newPartQuantity, specialPaintId: it.specialPaintId || undefined }))
    });
    if (error) return;

    // 创建工单成功后上传图片
    const orderId = orderData?.id;
    if (orderId && images.value.length > 0) {
      for (const img of images.value) {
        if (img.file) {
          const { hd, thumbnail } = await compressDualImage(img.file);
          const formData = new FormData();
          formData.append('imageType', img.imageType || 'BEFORE');
          formData.append('file', hd);
          formData.append('thumbnail', thumbnail);
          await uploadWorkOrderImage(orderId, formData);
        }
      }
    }

    window.$message?.success($t('common.addSuccess'));
  } else {
    const { error } = await updateWorkOrder({
      id: props.rowData.id,
      orderNo: model.orderNo || undefined,
      orderDate: model.orderDate || undefined,
      carModel: model.carModel,
      plateNumber: model.plateNumber,
      vin: model.vin || undefined,
      brand: model.brand || undefined,
      customerName: model.customerName,
      phone: model.phone || undefined,
      settlementMonth: model.settlementMonth || undefined,
      remark: model.remark || undefined,
      items: model.items.filter(it => it.categoryId).map(it => ({ categoryId: it.categoryId, quantity: it.quantity, newPartQuantity: it.newPartQuantity, specialPaintId: it.specialPaintId || undefined }))
    });
    if (error) {
      window.$message?.error(error.message || '更新失败');
      return;
    }
    window.$message?.success($t('common.updateSuccess'));
  }
  closeDrawer();
  emit('submitted');
}

watch(visible, () => {
  if (visible.value) {
    handleInitModel();
    restoreValidation();
  }
});

watch(() => model.shopId, (shopId) => {
  if (shopId) loadOrderNoRules(shopId);
  else orderNoRules.value = [];
});

// 用户手动修改工单号时，清空 OCR 纠正候选（避免与实时规则候选重复显示）
watch(() => model.orderNo, () => {
  ocrOrderNoCandidates.value = [];
  ocrOrderNoOriginal.value = '';
});
</script>

<template>
  <NModal v-model:show="visible" preset="card" :title="title" style="width: 90vw; max-width: 1200px; max-height: 90vh;" :mask-closable="false">
    <div class="operate-modal-body">
      <NScrollbar class="form-panel">
        <NForm ref="formRef" :model="model" :rules="rules" label-placement="left" :label-width="80" class="px-4px pr-12px">
        <NAlert v-if="operateType === 'edit' && images.length > 0 && !model.plateNumber" type="info" :bordered="false" class="mb-12px">
          此工单通过快速录入创建，请点击图片上的OCR识别按钮确认工单信息。
        </NAlert>

        <NDivider title-placement="left">基本信息</NDivider>

        <NGrid :cols="2" :x-gap="16">
          <NGridItem>
            <NFormItem
              label="工单号"
              :validation-status="model.orderNo && !orderNoValidation.valid ? 'warning' : undefined"
              :feedback="orderNoValidation.message"
            >
              <NInput v-model:value="model.orderNo" placeholder="不填则自动生成" />
            </NFormItem>
            <NSpace v-if="orderNoValidation.candidates.length > 0 || ocrOrderNoCandidates.length > 0" class="mb-8px" :size="6">
              <NText depth="3">候选修正：</NText>
              <NTag
                v-for="candidate in (ocrOrderNoCandidates.length > 0 ? ocrOrderNoCandidates : orderNoValidation.candidates)"
                :key="candidate"
                type="warning"
                size="small"
                style="cursor: pointer"
                @click="model.orderNo = candidate"
              >
                {{ candidate }}
              </NTag>
            </NSpace>
          </NGridItem>
          <NGridItem>
            <NFormItem label="门店" path="shopId">
              <NSelect
                v-model:value="model.shopId"
                :options="shops.map(s => ({ label: `${s.name} (${s.brand})${s.standardTemplateId ? '' : ' [未关联模板]'}`, value: s.id }))"
                placeholder="请选择门店"
                :disabled="operateType === 'edit'"
                @update:value="onShopChange"
              />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <NAlert v-if="!shopHasTemplate && model.shopId" type="warning" :bordered="false" class="mb-8px">
          该门店尚未关联标准模板，工单幅数将默认为0。请先到门店管理关联模板。
        </NAlert>

        <NGrid :cols="3" :x-gap="16">
          <NGridItem>
            <NFormItem label="工单日期" path="orderDate">
              <NDatePicker
                :formatted-value="model.orderDate || undefined"
                @update:formatted-value="(val: string | undefined) => model.orderDate = val || ''"
                type="date"
                value-format="yyyy-MM-dd"
                style="width: 100%"
                clearable
              />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="结算月份">
              <NDatePicker
                :formatted-value="model.settlementMonth || undefined"
                @update:formatted-value="(val: string | undefined) => model.settlementMonth = val || ''"
                type="month"
                value-format="yyyy-MM"
                style="width: 100%"
                clearable
              />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <NGrid :cols="2" :x-gap="16">
          <NGridItem>
            <NFormItem label="车牌号" path="plateNumber">
              <NInput v-model:value="model.plateNumber" placeholder="请输入车牌号" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="车型">
              <NInput v-model:value="model.carModel" placeholder="请输入车型" />
            </NFormItem>
          </NGridItem>
          <NGridItem span="2">
            <NFormItem label="车架号">
              <NInput v-model:value="model.vin" placeholder="请输入VIN" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="品牌">
              <NInput v-model:value="model.brand" placeholder="请输入品牌" />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <NGrid :cols="2" :x-gap="16">
          <NGridItem>
            <NFormItem label="客户名称">
              <NInput v-model:value="model.customerName" placeholder="请输入客户名称" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="电话">
              <NInput v-model:value="model.phone" placeholder="请输入电话" />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <NFormItem label="备注">
          <NInput v-model:value="model.remark" type="textarea" placeholder="请输入备注" :rows="2" />
        </NFormItem>

        <NDivider title-placement="left">
          喷漆项目
          <NTag type="info" size="small" round style="margin-left: 8px;">总幅数: {{ totalPaintCount.toFixed(1) }}</NTag>
        </NDivider>

        <div class="mb-8px">
          <NSpace :size="8">
            <NButton type="primary" dashed size="small" :disabled="!model.shopId" @click="addItem(1)">
              <template #icon><icon-ic-round-plus /></template>
              添加1行
            </NButton>
            <NButton type="primary" dashed size="small" :disabled="!model.shopId" @click="addItem(5)">
              添加5行
            </NButton>
            <NButton type="primary" dashed size="small" :disabled="!model.shopId" @click="addItem(10)">
              添加10行
            </NButton>
          </NSpace>
          <NText v-if="!model.shopId" depth="3" class="ml-8px">请先选择门店</NText>
          <NText v-else-if="!shopHasTemplate" type="error" class="ml-8px">该门店未关联幅数标准模板，请先在门店管理中绑定标准模板</NText>
        </div>

        <NDataTable
          v-if="model.items.length > 0"
          :columns="itemColumns"
          :data="model.items"
          size="small"
          :bordered="true"
          :pagination="false"
          :row-key="(row: OrderItem) => row.categoryId"
        />
        <NEmpty v-else-if="model.shopId" description="暂未添加喷漆项目" />
      </NForm>
    </NScrollbar>

    <NScrollbar class="image-panel">
      <div class="image-panel-header">
        <span class="image-panel-title">工单图片</span>
        <NButton
          v-if="images.length > 0"
          type="primary"
          size="small"
          dashed
          :loading="ocrLoading"
          @click="ocrQuickRecognize"
        >
          <template #icon><icon-ic-round-search /></template>
          OCR识别填充
        </NButton>
      </div>
      <NSpace :size="8" align="center" class="image-upload-row">
        <NUpload
          :max="9"
          accept="image/*"
          :show-file-list="false"
          :custom-request="({ file }) => handleUploadImage({ file: file.file as File })"
        >
          <NButton :loading="uploadingImage">
            <template #icon><icon-ic-round-add-photo-alternate /></template>
            选择图片
          </NButton>
        </NUpload>
        <NText v-if="images.length > 0" depth="3" style="font-size: 12px;">
          点击"OCR识别填充"一键识别第一张图，或点击图片左上角搜索图标进行框选识别
        </NText>
      </NSpace>

      <div class="image-list">
        <div v-for="(img, index) in images" :key="index" class="image-card">
          <NImage
            :src="getImageDisplayUrl(img)"
            :preview-src="getHdImageUrl(img)"
            object-fit="cover"
            class="image-card-img"
            show-toolbar
          />
          <NButton
            type="error"
            quaternary
            circle
            size="tiny"
            class="image-remove-btn"
            @click="handleRemoveImage(index)"
          >
            <template #icon><icon-ic-round-close /></template>
          </NButton>
          <NButton
            type="primary"
            quaternary
            circle
            size="tiny"
            class="image-ocr-btn"
            title="OCR识别此图片"
            @click="openOcrModal(index)"
          >
            <template #icon><icon-ic-round-search /></template>
          </NButton>
        </div>
      </div>
    </NScrollbar>
  </div>

    <template #footer>
      <NSpace justify="end" :size="16">
        <NButton @click="closeDrawer">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" @click="handleSubmit">{{ $t('common.confirm') }}</NButton>
      </NSpace>
    </template>
  </NModal>

  <!-- OCR 识别弹窗 -->
  <NModal v-model:show="showOcrModal" preset="card" title="OCR识别" style="width: 900px" :mask-closable="false">
    <NSpace vertical :size="12">
      <NAlert type="info" :bordered="false">
        <template #header>操作说明</template>
        <div><strong>全图识别：</strong>直接识别整张图片中的工单号、车牌号、客户名称、联系电话、车型、车架号、品牌、日期</div>
        <div><strong>标记识别：</strong>在图片上拖拽框选区域，精准识别指定位置的文字（推荐）</div>
      </NAlert>

      <div class="ocr-fields-row">
        <NText depth="3" style="font-size: 12px; white-space: nowrap;">可识别字段：</NText>
        <NSpace :size="8" wrap>
          <NTag v-for="field in ocrFieldLabels" :key="field" size="small" type="info" round>{{ field }}</NTag>
        </NSpace>
      </div>

      <NSpace align="center" :size="12">
        <NText depth="3" style="font-size: 12px; white-space: nowrap;">识别模式：</NText>
        <NRadioGroup v-model:value="ocrMode" size="small">
          <NRadioButton value="all">全部识别</NRadioButton>
          <NRadioButton value="basic">仅基础资料</NRadioButton>
          <NRadioButton value="items">仅部位</NRadioButton>
        </NRadioGroup>
      </NSpace>

      <div style="position: relative; display: inline-block; cursor: crosshair;">
        <canvas
          ref="ocrCanvasRef"
          style="border: 1px solid #e0e0e0; border-radius: 4px; display: block;"
          @mousedown="onOcrMouseDown"
          @mousemove="onOcrMouseMove"
          @mouseup="onOcrMouseUp"
          @mouseleave="onOcrMouseUp"
        />
      </div>

      <NAlert v-if="hasCropRegion" type="success" :bordered="false" style="padding: 8px 12px;">
        <NSpace align="center" :size="8">
          <NText type="success" style="font-size: 13px; font-weight: 500;">已框选标记区域</NText>
          <NText depth="3" style="font-size: 12px;">点击"标记区域识别"进行精准识别</NText>
        </NSpace>
      </NAlert>
      <NAlert v-else type="default" :bordered="false" style="padding: 8px 12px;">
        <NText depth="3" style="font-size: 12px;">提示：按住鼠标左键在图片上拖拽，可框选需要识别的文字区域</NText>
      </NAlert>
    </NSpace>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="showOcrModal = false">取消</NButton>
        <NButton type="default" :loading="ocrLoading" @click="ocrRecognizeFull">
          全图识别
        </NButton>
        <NButton type="primary" :loading="ocrLoading" :disabled="!hasCropRegion" @click="ocrRecognizeCrop">
          标记区域识别
        </NButton>
      </NSpace>
    </template>
  </NModal>

  <!-- OCR 冲突确认弹窗 -->
  <NModal v-model:show="showConflictModal" preset="card" title="OCR识别结果冲突确认" style="width: 560px" :mask-closable="false">
    <NSpace vertical :size="12">
      <NAlert type="warning" :bordered="false">
        以下字段的OCR识别结果与工单原有数据不一致，勾选需要覆盖的字段
      </NAlert>
      <div v-for="(field, index) in conflictFields" :key="field.key" style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid #e0e0e0; border-radius: 4px;">
        <NCheckbox v-model:checked="conflictFields[index].checked" />
        <div style="flex: 1;">
          <div style="font-weight: bold; font-size: 13px; margin-bottom: 4px;">{{ field.label }}</div>
          <NSpace align="center" :size="8" style="font-size: 13px;">
            <NText depth="3">原值：</NText>
            <NText style="text-decoration: line-through; color: #999;">{{ field.oldValue }}</NText>
            <NText>→</NText>
            <NText type="warning" style="font-weight: bold;">{{ field.newValue }}</NText>
          </NSpace>
        </div>
      </div>
    </NSpace>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showConflictModal = false">不覆盖</NButton>
        <NButton type="primary" @click="confirmConflictOverwrite">覆盖选中字段</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.operate-modal-body {
  display: flex;
  height: calc(90vh - 130px);
  gap: 16px;
  overflow: hidden;
}

.form-panel {
  flex: 1;
  min-width: 520px;
  padding-right: 8px;
}

.image-panel {
  width: 520px;
  flex-shrink: 0;
  border-left: 1px solid #f0f0f0;
  padding-left: 16px;
  padding-right: 8px;
}

.image-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.image-panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.image-upload-row {
  margin-bottom: 12px;
}

.image-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.image-card {
  position: relative;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  overflow: hidden;
  background: #fafafa;
}

.image-card-img {
  width: 100%;
  height: auto;
  min-height: 120px;
  display: block;
  object-fit: contain;
  background: #f5f5f5;
}

.image-remove-btn {
  position: absolute;
  top: 6px;
  right: 6px;
}

.image-ocr-btn {
  position: absolute;
  top: 6px;
  left: 6px;
}

.ocr-fields-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 992px) {
  .operate-modal-body {
    flex-direction: column;
    height: auto;
    max-height: calc(90vh - 130px);
  }

  .image-panel {
    width: 100%;
    border-left: none;
    border-top: 1px solid #f0f0f0;
    padding-left: 0;
    padding-top: 16px;
    max-height: 40vh;
  }

  .form-panel {
    max-height: 50vh;
  }
}
</style>
