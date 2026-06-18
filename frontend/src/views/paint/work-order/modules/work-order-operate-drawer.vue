<script setup lang="ts">
import { computed, reactive, watch, ref, nextTick, h } from 'vue';
import { NSelect, NInputNumber, NCheckbox, NButton, NText } from 'naive-ui';
import { createWorkOrder, updateWorkOrder, fetchPaintShopList, fetchShopCategoriesWithStandard, uploadWorkOrderImage, removeWorkOrderImage, fetchSpecialPaintList, ocrRecognizeImage, getSettlementHistory, addSettlementRecord } from '@/service/api';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';
import { $t } from '@/locales';
import { recognizeFromCanvas, cropImageRegion } from '@/utils/ocr';
import type { CropRegion } from '@/utils/ocr';
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

// 结算历史
const settlementRecords = ref<any[]>([]);

const title = computed(() => {
  const titles: Record<NaiveUI.TableOperateType, string> = {
    add: '新增工单',
    edit: '编辑工单'
  };
  return titles[props.operateType];
});

interface OrderItem {
  categoryId: string;
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
  customerName: string;
  phone: string;
  contactPerson: string;
  description: string;
  remark: string;
  status: string;
  settlementMonth: string;
  items: OrderItem[];
}

const model: FormModel = reactive(createDefaultModel());

function createDefaultModel(): FormModel {
  return {
    orderNo: '',
    shopId: '',
    orderDate: new Date().toISOString().split('T')[0],
    carModel: '',
    plateNumber: '',
    vin: '',
    customerName: '',
    phone: '',
    contactPerson: '',
    description: '',
    remark: '',
    status: 'PENDING',
    settlementMonth: '',
    items: []
  };
}

type RuleKey = Extract<keyof FormModel, 'shopId' | 'orderDate' | 'plateNumber'>;

const rules: Record<RuleKey, App.Global.FormRule> = {
  shopId: defaultRequiredRule,
  orderDate: defaultRequiredRule,
  plateNumber: defaultRequiredRule
};

async function loadShops() {
  const { data, error } = await fetchPaintShopList();
  if (!error && data) {
    shops.value = data;
  }
}
loadShops();

async function loadSpecialPaints() {
  const { data, error } = await fetchSpecialPaintList(true);
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
  if (!error && data) {
    const items = (data as any[]).filter((s: any) => Number(s.coefficient) > 0);
    if (items.length === 0 && (data as any[]).length === 0) {
      shopHasTemplate.value = false;
    } else {
      shopHasTemplate.value = true;
    }
    categories.value = items.map((s: any) => ({
      id: s.categoryId || s.category?.id,
      name: s.alias || s.category?.name || '',
      alias: s.alias || '',
      paintCount: Number(s.coefficient),
      newPartAddition: Number(s.newPartAddition) || 0
    }));
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
    .map(c => ({ label: `${c.name} (${Number(c.paintCount).toFixed(1)}幅)`, value: c.id }));
}

const canAddItem = computed(() => {
  return model.shopId && model.items.every(item => item.categoryId);
});

function removeItem(index: number) {
  model.items.splice(index, 1);
}

const itemColumns = computed(() => [
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
]);

function getCategoryName(categoryId: string) {
  const cat = categories.value.find(c => c.id === categoryId);
  return cat?.name || '';
}

function getCategoryPaintCount(categoryId: string, newPartQuantity: number, totalQuantity: number, specialPaintId?: string) {
  const cat = categories.value.find(c => c.id === categoryId);
  if (!cat) return 0;
  const base = cat.paintCount;
  const addition = cat.newPartAddition;
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
  thumbnailUrl?: string;
  imageType: string;
  status: 'finished' | 'uploading' | 'error';
  file?: File;
}

const images = ref<ImageItem[]>([]);
const uploadingImage = ref(false);
const backendOrigin = ''; // 通过Vite代理访问，无需后端根地址

// OCR 相关状态
const ocrLoading = ref(false);
const showOcrModal = ref(false);
const ocrImageIndex = ref(-1);
const ocrCanvasRef = ref<HTMLCanvasElement | null>(null);
const ocrImgRef = ref<HTMLImageElement | null>(null);
const isDrawing = ref(false);
const drawStart = ref({ x: 0, y: 0 });
const drawEnd = ref({ x: 0, y: 0 });
const hasCropRegion = ref(false);

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

// 绘制OCR画布（图片+可选框选区域）
function drawOcrCanvas() {
  const canvas = ocrCanvasRef.value;
  const imgEl = ocrImgRef.value;
  if (!canvas || !imgEl) return;

  const maxW = 600;
  const maxH = 450;
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

// 全图OCR识别（调用后端API）
async function ocrRecognizeFull() {
  const img = images.value[ocrImageIndex.value];
  if (!img?.file && !img?.url) return;

  ocrLoading.value = true;
  try {
    // 优先使用后端OCR识别
    if (img.file) {
      // 新上传的图片，直接用文件调后端
      const formData = new FormData();
      formData.append('file', img.file);
      const { data, error } = await ocrRecognizeImage(formData);
      if (!error && data) {
        const result = data;
        if (result.plateNumber) {
          model.plateNumber = result.plateNumber;
          window.$message?.success(`识别到车牌号：${result.plateNumber}`);
        }
        if (result.orderNo && !model.orderNo) {
          model.orderNo = result.orderNo;
          window.$message?.success(`识别到工单号：${result.orderNo}`);
        }
        if (!result.plateNumber && !result.orderNo) {
          window.$message?.warning('未识别到车牌号或工单号，请尝试框选标记区域识别');
        }
        showOcrModal.value = false;
      } else {
        window.$message?.error('后端OCR识别失败，尝试前端识别...');
        // 降级到前端识别
        const result = await recognizeFromCanvas(getImageCanvas());
        if (result.plateNumber) {
          model.plateNumber = result.plateNumber;
          window.$message?.success(`识别到车牌号：${result.plateNumber}`);
        }
        if (result.orderNo && !model.orderNo) {
          model.orderNo = result.orderNo;
          window.$message?.success(`识别到工单号：${result.orderNo}`);
        }
        if (!result.plateNumber && !result.orderNo) {
          window.$message?.warning('未识别到车牌号或工单号');
        }
        showOcrModal.value = false;
      }
    } else {
      // 已有图片（URL），从canvas获取数据调后端
      const imgEl = ocrImgRef.value;
      if (!imgEl) return;
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      canvas.getContext('2d')!.drawImage(imgEl, 0, 0);

      // 转为Blob发送到后端
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png');
      });
      const formData = new FormData();
      formData.append('file', blob, 'ocr_image.png');
      const { data, error } = await ocrRecognizeImage(formData);
      if (!error && data) {
        const result = data;
        if (result.plateNumber) {
          model.plateNumber = result.plateNumber;
          window.$message?.success(`识别到车牌号：${result.plateNumber}`);
        }
        if (result.orderNo && !model.orderNo) {
          model.orderNo = result.orderNo;
          window.$message?.success(`识别到工单号：${result.orderNo}`);
        }
        if (!result.plateNumber && !result.orderNo) {
          window.$message?.warning('未识别到车牌号或工单号，请尝试框选标记区域识别');
        }
        showOcrModal.value = false;
      } else {
        // 降级到前端识别
        const result = await recognizeFromCanvas(canvas);
        if (result.plateNumber) {
          model.plateNumber = result.plateNumber;
          window.$message?.success(`识别到车牌号：${result.plateNumber}`);
        }
        if (result.orderNo && !model.orderNo) {
          model.orderNo = result.orderNo;
          window.$message?.success(`识别到工单号：${result.orderNo}`);
        }
        if (!result.plateNumber && !result.orderNo) {
          window.$message?.warning('未识别到车牌号或工单号');
        }
        showOcrModal.value = false;
      }
    }
  } catch {
    window.$message?.error('OCR识别失败');
  } finally {
    ocrLoading.value = false;
  }
}

function getImageCanvas(): HTMLCanvasElement {
  const imgEl = ocrImgRef.value;
  const canvas = document.createElement('canvas');
  if (imgEl) {
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    canvas.getContext('2d')!.drawImage(imgEl, 0, 0);
  }
  return canvas;
}

// 框选区域OCR识别
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
    // 直接从原图裁剪，传入原图坐标
    const croppedCanvas = cropImageRegion(imgEl, region, imgEl.naturalWidth, imgEl.naturalHeight);
    const result = await recognizeFromCanvas(croppedCanvas);

    if (result.plateNumber) {
      model.plateNumber = result.plateNumber;
      window.$message?.success(`识别到车牌号：${result.plateNumber}`);
    }
    if (result.orderNo && !model.orderNo) {
      model.orderNo = result.orderNo;
      window.$message?.success(`识别到工单号：${result.orderNo}`);
    }
    if (!result.plateNumber && !result.orderNo) {
      window.$message?.warning('该区域未识别到有效信息');
    }
    showOcrModal.value = false;
  } catch {
    window.$message?.error('OCR识别失败');
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
      customerName: props.rowData.customerName || '',
      phone: props.rowData.phone || '',
      contactPerson: props.rowData.contactPerson || '',
      description: props.rowData.description || '',
      remark: props.rowData.remark || '',
      status: props.rowData.status || 'PENDING',
      settlementMonth: props.rowData.settlementMonth || '',
      items: (props.rowData.items || []).map((it: any) => ({
        categoryId: it.categoryId || it.category?.id || '',
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
      carModel: model.carModel,
      plateNumber: model.plateNumber,
      customerName: model.customerName,
      phone: model.phone || undefined,
      status: model.status,
      settlementMonth: model.settlementMonth || undefined,
      remark: model.remark || undefined,
      items: model.items.filter(it => it.categoryId).map(it => ({ categoryId: it.categoryId, quantity: it.quantity, newPartQuantity: it.newPartQuantity, specialPaintId: it.specialPaintId || undefined }))
    });
    if (error) return;
    window.$message?.success($t('common.updateSuccess'));
  }
  closeDrawer();
  emit('submitted');
}

watch(visible, () => {
  if (visible.value) {
    handleInitModel();
    restoreValidation();
    // 编辑时加载结算历史
    if (props.operateType === 'edit' && props.rowData?.id) {
      loadSettlementHistory(props.rowData.id);
    } else {
      settlementRecords.value = [];
    }
  }
});

async function loadSettlementHistory(orderId: string) {
  const { data, error } = await getSettlementHistory(orderId);
  if (!error && data) {
    settlementRecords.value = data;
  }
}
</script>

<template>
  <NModal v-model:show="visible" preset="card" :title="title" style="width: 800px; max-height: 85vh;" :mask-closable="false">
    <NScrollbar style="max-height: calc(85vh - 120px);">
      <NForm ref="formRef" :model="model" :rules="rules" label-placement="left" :label-width="80" class="px-4px">
        <NAlert v-if="operateType === 'edit' && images.length > 0 && !model.plateNumber" type="info" :bordered="false" class="mb-12px">
          此工单通过快速录入创建，请点击图片上的OCR识别按钮确认车牌号和工单号。
        </NAlert>

        <NDivider title-placement="left">基本信息</NDivider>

        <NGrid :cols="2" :x-gap="16">
          <NGridItem>
            <NFormItem label="工单号">
              <NInput v-model:value="model.orderNo" placeholder="不填则自动生成" />
            </NFormItem>
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
                :disabled="operateType === 'edit'"
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
          <NGridItem>
            <NFormItem v-if="operateType === 'edit'" label="状态">
              <NSelect
                v-model:value="model.status"
                :options="[
                  { label: '待处理', value: 'PENDING' },
                  { label: '进行中', value: 'IN_PROGRESS' },
                  { label: '已完成', value: 'COMPLETED' },
                  { label: '已取消', value: 'CANCELLED' }
                ]"
              />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <NGrid :cols="3" :x-gap="16">
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
          <NGridItem>
            <NFormItem label="车架号">
              <NInput v-model:value="model.vin" placeholder="请输入VIN" />
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

        <NAlert v-if="settlementRecords.length > 0" type="info" :bordered="false" class="mb-8px">
          <template #header>此工单已有 {{ settlementRecords.length }} 次结算记录</template>
          <NSpace vertical :size="4">
            <NText v-for="record in settlementRecords" :key="record.id" depth="3">
              {{ record.settlementMonth }} - 幅数: {{ Number(record.paintCount).toFixed(1) }}，项目数: {{ record.itemCount }}
              <span v-if="record.remark">（{{ record.remark }}）</span>
            </NText>
            <NText depth="3" style="font-size: 12px;">如需分次结算，修改结算月份后保存即可自动新增结算记录</NText>
          </NSpace>
        </NAlert>

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
          :row-key="(row: any, index: number) => String(index)"
        />
        <NEmpty v-else-if="model.shopId" description="暂未添加喷漆项目" />

        <NDivider title-placement="left">工单图片</NDivider>

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

        <NGrid :cols="3" :x-gap="8" :y-gap="8" class="mt-12px">
          <NGridItem v-for="(img, index) in images" :key="index">
            <NCard size="small" :bordered="true" style="position: relative; padding: 0;">
              <img :src="getImageDisplayUrl(img)" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px;" />
              <NButton
                type="error"
                quaternary
                circle
                size="tiny"
                style="position: absolute; top: 4px; right: 4px;"
                @click="handleRemoveImage(index)"
              >
                <template #icon><icon-ic-round-close /></template>
              </NButton>
              <NButton
                type="primary"
                quaternary
                circle
                size="tiny"
                style="position: absolute; top: 4px; left: 4px;"
                title="OCR识别此图片"
                @click="openOcrModal(index)"
              >
                <template #icon><icon-ic-round-search /></template>
              </NButton>
            </NCard>
          </NGridItem>
        </NGrid>

        <NText v-if="images.length > 0" depth="3" class="mt-8px" style="display: block; font-size: 12px;">
          点击图片左上角搜索按钮可进行OCR识别，支持框选标记区域精准识别
        </NText>
      </NForm>
    </NScrollbar>

    <template #footer>
      <NSpace justify="end" :size="16">
        <NButton @click="closeDrawer">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" @click="handleSubmit">{{ $t('common.confirm') }}</NButton>
      </NSpace>
    </template>
  </NModal>

  <!-- OCR 识别弹窗 -->
  <NModal v-model:show="showOcrModal" preset="card" title="OCR识别" style="width: 640px" :mask-closable="false">
    <NSpace vertical :size="12">
      <NAlert type="info" :bordered="false">
        全图识别：直接识别整张图片中的车牌号和工单号<br />
        标记识别：在图片上拖拽框选区域，精准识别指定位置的文字（推荐）
      </NAlert>

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

      <NText v-if="hasCropRegion" type="success" style="font-size: 13px;">
        已框选标记区域，点击"标记区域识别"进行精准识别
      </NText>
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
</template>

<style scoped></style>
