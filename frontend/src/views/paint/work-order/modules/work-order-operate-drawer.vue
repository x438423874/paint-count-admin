<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NGrid,
  NGridItem,
  NImage,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NTag,
  NText,
  NTooltip
} from 'naive-ui';
import {
  createWorkOrder,
  fetchOrderNoRules,
  fetchShopCategoriesWithStandard,
  fetchSpecialPaintList,
  fetchVehicleByPlate,
  removeWorkOrderImage,
  updateWorkOrder,
  uploadWorkOrderImage
} from '@/service/api';
import type { OrderNoRule, PaintOrderStatus } from '@/service/api/paint';
import { useThemeStore } from '@/store/modules/theme';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';
import { useShopOptions } from '@/hooks/business/use-shop-options';
import { compressDualImage } from '@/utils/image-compress';
import { analyzeOrderNoErrors } from '@/utils/order-no-rule';
import { phoneRegex, plateNumberRegex, vinRegex } from '@/utils/validators';
import { formatPaintCount } from '@/utils/paint-count';
import { applyOcrFields } from '@/utils/ocr-fields';
import { resolveUploadUrl } from '@/utils/upload-url';
import { $t } from '@/locales';
import OcrCanvasModal from './ocr-canvas-modal.vue';

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

const themeStore = useThemeStore();

const { formRef, validate, restoreValidation } = useNaiveForm();
const { defaultRequiredRule } = useFormRules();

// 门店走 paint store 共享缓存，全应用只请求一次（原为每次打开抽屉各请求一次）
const { shops, ensureShops } = useShopOptions();
const categories = ref<{ id: string; name: string; alias: string; paintCount: number; newPartAddition: number }[]>([]);
const specialPaints = ref<{ id: string; name: string; multiplier: number }[]>([]);
const loadingCategories = ref(false);
const shopHasTemplate = ref(true);
const orderNoRules = ref<OrderNoRule[]>([]);
const ocrOrderNoCandidates = ref<string[]>([]);
const ocrOrderNoOriginal = ref('');
const ocrOrderNoCorrectionMsg = ref('');
const ocrVinCorrectionMsg = ref('');

// 车辆主数据自动填充
const vehicleLookingUp = ref(false);
const vehicleFound = ref<any>(null);
const vehicleMatchedFields = ref<string[]>([]);

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
  overridePaintCount?: number;
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

type RuleKey = Extract<keyof FormModel, 'shopId' | 'plateNumber' | 'vin' | 'phone'>;

// 校验正则统一维护在 utils/validators（车牌/手机号/车架号）

const rules: Record<RuleKey, App.Global.FormRule> = {
  shopId: defaultRequiredRule,
  plateNumber: {
    required: true,
    validator: (_rule, value) => {
      if (!value || !value.trim()) return new Error('请输入车牌号');
      const v = value.trim().toUpperCase();
      if (!plateNumberRegex.test(v)) {
        return new Error('车牌号格式不正确（普通7位/新能源8位/旧6位，临牌以"临"结尾）');
      }
      return true;
    }
  },
  vin: {
    validator: (_rule, value) => {
      if (!value || !value.trim()) return true; // 非必填
      if (!vinRegex.test(value.trim().toUpperCase())) {
        return new Error('车架号应为17位字母数字（不含I、O、Q）');
      }
      return true;
    }
  },
  phone: {
    validator: (_rule, value) => {
      if (!value || !value.trim()) return true; // 非必填
      if (!phoneRegex.test(value.trim())) {
        return new Error('手机号应为11位数字，以1开头');
      }
      return true;
    }
  }
};

const orderNoValidation = computed(() => {
  if (!model.orderNo || orderNoRules.value.length === 0)
    return { valid: true, message: '', candidates: [] as string[] };
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
  const errors = analyzeOrderNoErrors(upper, orderNoRules.value);
  const message =
    errors.length > 0
      ? errors.join('；') + (candidates.length > 0 ? '，点击候选值一键修正' : '')
      : `工单号不符合门店规则（长度应为 ${orderNoRules.value.map(r => r.length).join('/')}）`;
  return {
    valid: false,
    message,
    candidates
  };
});

function generateOrderNoCandidates(orderNo: string, rules: OrderNoRule[]): string[] {
  const substitutions: Record<string, string[]> = {
    '0': ['O'],
    O: ['0'],
    o: ['0'],
    '1': ['I', 'l'],
    I: ['1', 'l'],
    i: ['1', 'l'],
    l: ['1', 'I'],
    '2': ['Z'],
    Z: ['2'],
    z: ['2'],
    '5': ['S'],
    S: ['5'],
    s: ['5'],
    '8': ['B'],
    B: ['8'],
    b: ['8'],
    '6': ['G'],
    G: ['6'],
    g: ['6']
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

// 打开抽屉时确保门店缓存就绪（命中缓存不发请求）
ensureShops();

async function loadSpecialPaints() {
  const { data, error } = await fetchSpecialPaintList(undefined, true);
  if (!error && data) {
    specialPaints.value = data.map((sp: any) => ({ id: sp.id, name: sp.name, multiplier: Number(sp.multiplier) }));
  }
}
loadSpecialPaints();

// 车辆主数据：按车牌号查询历史车辆并自动填充空字段
async function lookupVehicle(plate: string) {
  if (!plate || !plateNumberRegex.test(plate.toUpperCase())) {
    vehicleFound.value = null;
    vehicleMatchedFields.value = [];
    return;
  }
  // 已匹配到同一车牌则不重复查询
  if (vehicleFound.value?.plateNumber === plate.toUpperCase()) return;
  vehicleLookingUp.value = true;
  try {
    const { data, error } = await fetchVehicleByPlate(plate);
    if (!error && data) {
      vehicleFound.value = data;
      // 仅填充表单中为空的字段，不覆盖用户已填值（与 OCR 策略一致）
      const fieldMap: Array<{ key: keyof FormModel; vehicleKey: string; label: string }> = [
        { key: 'vin', vehicleKey: 'vin', label: '车架号' },
        { key: 'carModel', vehicleKey: 'carModel', label: '车型' },
        { key: 'brand', vehicleKey: 'brand', label: '品牌' },
        { key: 'customerName', vehicleKey: 'customerName', label: '客户名称' },
        { key: 'phone', vehicleKey: 'phone', label: '电话' },
        { key: 'contactPerson', vehicleKey: 'contactPerson', label: '联系人' }
      ];
      const filled: string[] = [];
      for (const { key, vehicleKey, label } of fieldMap) {
        const currentValue = ((model[key] as string) || '').trim();
        const vehicleValue = (((data as any)[vehicleKey] as string) || '').trim();
        if (!vehicleValue) continue;
        if (key === 'carModel') {
          // 车型以车辆主数据为准：主数据更完整（更长）或表单为空时覆盖，避免"宋"不更新为"宋PLUS DM-i"
          if (!currentValue || vehicleValue.length > currentValue.length) {
            (model as any)[key] = vehicleValue;
            filled.push(label);
          }
        } else if (!currentValue) {
          // 其余字段（车架号/客户/电话等）仅填空，避免误覆盖用户已填值
          (model as any)[key] = vehicleValue;
          filled.push(label);
        }
      }
      vehicleMatchedFields.value = filled;
    } else {
      vehicleFound.value = null;
      vehicleMatchedFields.value = [];
    }
  } finally {
    vehicleLookingUp.value = false;
  }
}

function onPlateNumberBlur() {
  const plate = (model.plateNumber || '').trim().toUpperCase();
  if (!plate) {
    vehicleFound.value = null;
    vehicleMatchedFields.value = [];
    return;
  }
  lookupVehicle(plate);
}

function onPlateNumberInput() {
  // 车牌号被修改时清除匹配状态（下次 blur 时重新查询）
  if (vehicleFound.value) {
    const currentPlate = (model.plateNumber || '').trim().toUpperCase();
    if (vehicleFound.value.plateNumber !== currentPlate) {
      vehicleFound.value = null;
      vehicleMatchedFields.value = [];
    }
  }
}

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

    // 编辑初始化时：若 categoryId 找不到对应系统部位，但保存了名字，则按名字自动匹配
    if (isInit) {
      model.items.forEach(item => {
        if (item.categoryId && categories.value.some(c => c.id === item.categoryId)) return;
        const nameHint = item.categoryName;
        if (!nameHint) return;
        const match = categories.value.find(c => c.name === nameHint || c.alias === nameHint);
        if (match) item.categoryId = match.id;
      });

      // 清理与自动计算值一致的 overridePaintCount（编辑时暂存了已有 paintCount，
      // 如果它与自动计算值一致，则不需要覆盖标记）
      model.items.forEach(item => {
        if (item.overridePaintCount !== undefined && item.overridePaintCount !== null && item.categoryId) {
          const autoCount = getCategoryPaintCount(
            item.categoryId,
            item.newPartQuantity,
            item.quantity,
            item.specialPaintId
          );
          if (Math.abs(item.overridePaintCount - autoCount) < 0.01) {
            item.overridePaintCount = undefined;
          }
        }
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
  const selectedIds = new Set(
    model.items.filter(i => i.categoryId && i.categoryId !== currentCategoryId).map(i => i.categoryId)
  );
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
  const itemDependency = model.items
    .map(i => `${i.categoryId}:${i.quantity}:${i.newPartQuantity}:${i.specialPaintId}`)
    .join('|');
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
          onUpdateValue: (val: string) => {
            item.categoryId = val;
          }
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
          onUpdateValue: (val: number | null) => {
            if (val !== null) item.quantity = val;
          }
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
          onUpdateValue: (val: number | null) => {
            if (val !== null) item.newPartQuantity = val;
          }
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
          options: [
            { label: '无', value: '' },
            ...specialPaints.value.map(sp => ({ label: `${sp.name} x${sp.multiplier}`, value: sp.id }))
          ],
          placeholder: '无',
          size: 'small',
          clearable: true,
          onUpdateValue: (val: string) => {
            item.specialPaintId = val || '';
          }
        });
      }
    },
    {
      key: 'paintCount',
      title: '幅数',
      width: 90,
      align: 'center' as const,
      render: (_row: any, index: number) => {
        const item = model.items[index];
        const autoCount = getCategoryPaintCount(
          item.categoryId,
          item.newPartQuantity,
          item.quantity,
          item.specialPaintId
        );
        const hasOverride = item.overridePaintCount !== undefined && item.overridePaintCount !== null;
        const displayCount = hasOverride ? item.overridePaintCount! : autoCount;

        if (hasOverride) {
          // 手动覆盖模式：显示输入框 + 标记
          return h(NSpace, { align: 'center', size: 4, justify: 'center' }, () => [
            h(NInputNumber, {
              value: item.overridePaintCount,
              size: 'small',
              min: 0,
              max: 99,
              step: 0.1,
              style: 'width: 60px',
              onUpdateValue: (val: number | null) => {
                item.overridePaintCount = val !== null ? val : undefined;
              }
            }),
            h(
              NTooltip,
              {},
              {
                trigger: () => h(NText, { type: 'warning', style: 'cursor: pointer; font-size: 12px' }, () => '*'),
                default: () => `手动覆盖（自动计算值: ${formatPaintCount(autoCount)}）`
              }
            ),
            h(
              NButton,
              {
                size: 'tiny',
                quaternary: true,
                type: 'error',
                onClick: () => {
                  item.overridePaintCount = undefined;
                }
              },
              { icon: () => h('span', { class: 'i-ic-round-close', style: 'font-size: 12px' }) }
            )
          ]);
        }

        // 自动计算模式：显示计算值，可点击手动覆盖
        return h(NSpace, { align: 'center', size: 4, justify: 'center' }, () => [
          h(NText, { depth: 3 }, () => `${formatPaintCount(displayCount)}`),
          h(
            NButton,
            {
              size: 'tiny',
              quaternary: true,
              type: 'primary',
              onClick: () => {
                item.overridePaintCount = autoCount;
              }
            },
            { icon: () => h('span', { class: 'i-ic-round-edit', style: 'font-size: 12px' }) }
          )
        ]);
      }
    },
    {
      key: 'operate',
      title: '操作',
      width: 50,
      align: 'center' as const,
      render: (_row: any, index: number) => {
        return h(
          NButton,
          {
            type: 'error',
            quaternary: true,
            size: 'small',
            onClick: () => removeItem(index)
          },
          { icon: () => h('span', { class: 'i-ic-round-delete' }) }
        );
      }
    }
  ];
});

function getCategoryName(categoryId: string) {
  const cat = categories.value.find(c => c.id === categoryId);
  return cat?.name || '';
}

function getCategoryPaintCount(
  categoryId: string,
  newPartQuantity: number,
  totalQuantity: number,
  specialPaintId?: string
) {
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

// 幅数显示格式统一走 utils/paint-count 的 formatPaintCount（原先本页与列表/详情各一份）

const totalPaintCount = computed(() => {
  return model.items.reduce((sum, item) => {
    if (item.overridePaintCount !== undefined && item.overridePaintCount !== null) {
      return sum + item.overridePaintCount;
    }
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

// OCR 相关状态（画布交互与识别调用已抽至 ocr-canvas-modal 子组件）
const ocrMode = ref<'all' | 'basic' | 'items'>('basic');
const showOcrModal = ref(false);
const ocrImageIndex = ref(-1);
/** 快速识别入口：打开弹窗后自动执行全图识别 */
const ocrAutoRecognize = ref(false);

/** 智能选择OCR模式：根据已填字段决定识别范围，节省token */
const smartOcrMode = computed<'all' | 'basic' | 'items'>(() => {
  const basicFields = [
    model.plateNumber,
    model.orderNo,
    model.customerName,
    model.phone,
    model.carModel,
    model.vin,
    model.brand,
    model.orderDate
  ];
  const basicFilled = basicFields.some(v => v && String(v).trim());
  const itemsFilled = model.items.some(it => it.categoryId && it.quantity > 0);

  if (basicFilled && itemsFilled) return 'all'; // 都有部分填写，仍需全量识别补全
  if (basicFilled && !itemsFilled) return 'items'; // 基础资料已填，只识别部位
  if (!basicFilled && itemsFilled) return 'basic'; // 部位已填，只识别基础资料
  return 'all'; // 都未填，全量识别
});
// OCR 填充结果反馈
const ocrFilledFields = ref<string[]>([]);
const ocrFilledVisible = ref(false);
let ocrFilledTimer: ReturnType<typeof setTimeout> | null = null;

// 获取图片的显示URL
// 列表展示用缩略图（加载快），OCR用高清图
function getImageDisplayUrl(img: ImageItem): string {
  if (img.url.startsWith('blob:')) return img.url;
  // 优先使用缩略图展示
  if (img.thumbnailUrl) return resolveUploadUrl(img.thumbnailUrl);
  return resolveUploadUrl(img.url);
}

// 打开OCR识别弹窗（画布交互与识别调用在子组件内完成）
function openOcrModal(index: number) {
  ocrImageIndex.value = index;
  ocrAutoRecognize.value = false;
  showOcrModal.value = true;
}

// 快速OCR识别：直接对第一张图片进行全图识别，跳过弹窗
function ocrQuickRecognize() {
  if (images.value.length === 0) {
    window.$message?.warning('请先上传工单图片');
    return;
  }
  ocrImageIndex.value = 0;
  ocrAutoRecognize.value = true;
  showOcrModal.value = true;
}

// 将OCR识别结果应用到表单（基础字段统一走 applyOcrFields，仅填充空白字段）
function applyOcrResult(result: Record<string, any>) {
  const { filledMessages, orderNoCorrected, vinCorrected } = applyOcrFields(model as Record<string, any>, result);

  // 记录 OCR 工单号纠正信息
  ocrOrderNoOriginal.value = result.orderNo || '';
  ocrOrderNoCandidates.value = result.orderNoCandidates || [];

  // 工单号自动修正提示（显示在输入框下方）
  if (orderNoCorrected !== null) {
    ocrOrderNoCorrectionMsg.value = `OCR识别工单号格式不正确，已自动修正为「${orderNoCorrected}」，可点击候选值切换`;
  } else {
    ocrOrderNoCorrectionMsg.value = '';
  }

  // VIN 车架号自动修正提示
  if (vinCorrected) {
    ocrVinCorrectionMsg.value = `OCR识别车架号含易混淆字符，已自动修正：「${vinCorrected.original}」→「${vinCorrected.corrected}」`;
  } else {
    ocrVinCorrectionMsg.value = '';
  }

  if (filledMessages.length > 0) {
    // 展示 OCR 填充反馈条
    ocrFilledFields.value = filledMessages;
    ocrFilledVisible.value = true;
    if (ocrFilledTimer) clearTimeout(ocrFilledTimer);
    ocrFilledTimer = setTimeout(() => {
      ocrFilledVisible.value = false;
    }, 5000);
  } else {
    window.$message?.warning('未识别到有效信息或所有字段已填写');
  }

  // OCR 填充完成后，若车牌号有效，触发车辆主数据查询
  const plate = (model.plateNumber || '').trim().toUpperCase();
  if (plate && plateNumberRegex.test(plate)) {
    lookupVehicle(plate);
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
      items: (props.rowData.items || []).map((it: any) => {
        const item: OrderItem = {
          categoryId: it.categoryId || it.category?.id || '',
          categoryName: it.category?.name || it.categoryName || '',
          quantity: it.quantity || 1,
          newPartQuantity: it.newPartQuantity || 0,
          specialPaintId: it.specialPaintId || ''
        };
        // 如果已有的 paintCount 与自动计算值不同，标记为手动覆盖
        // 注意：这里无法立即检测，因为 categories 可能还没加载
        // 将 paintCount 暂存到 overridePaintCount，等 categories 加载后对比
        if (it.paintCount !== undefined && it.paintCount !== null) {
          item.overridePaintCount = Number(it.paintCount);
        }
        return item;
      })
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
      images.value.push({
        id: data.id,
        url: data.url,
        thumbnailUrl: data.thumbnailUrl,
        imageType: data.imageType || 'BEFORE',
        status: 'finished'
      });
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

/** 构建提交的 items 数据，包含 overridePaintCount */
function buildItemsData() {
  return model.items
    .filter(it => it.categoryId)
    .map(it => {
      const item: any = {
        categoryId: it.categoryId,
        quantity: it.quantity,
        newPartQuantity: it.newPartQuantity,
        specialPaintId: it.specialPaintId || undefined
      };
      // 如果有手动覆盖幅数，传递给后端
      if (it.overridePaintCount !== undefined && it.overridePaintCount !== null) {
        item.overridePaintCount = it.overridePaintCount;
      }
      return item;
    });
}

function closeDrawer() {
  visible.value = false;
}

async function handleSubmit() {
  await validate();

  // 工单号规则校验：不符合规则则阻止提交
  if (!orderNoValidation.value.valid) {
    window.$message?.warning(orderNoValidation.value.message);
    return;
  }

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
      items: buildItemsData()
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
      items: buildItemsData()
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

watch(
  () => model.shopId,
  shopId => {
    if (shopId) loadOrderNoRules(shopId);
    else orderNoRules.value = [];
  }
);

// 用户手动修改工单号时，清空 OCR 纠正候选（避免与实时规则候选重复显示）
watch(
  () => model.orderNo,
  () => {
    ocrOrderNoCandidates.value = [];
    ocrOrderNoOriginal.value = '';
    ocrOrderNoCorrectionMsg.value = '';
  }
);
</script>

<template>
  <NModal
    v-model:show="visible"
    preset="card"
    :title="title"
    style="width: 90vw; max-width: 1200px; max-height: 90vh"
    :mask-closable="false"
  >
    <div class="operate-modal-body">
      <NScrollbar class="form-panel">
        <NForm
          ref="formRef"
          :model="model"
          :rules="rules"
          label-placement="left"
          :label-width="80"
          class="px-4px pr-12px"
        >
          <NAlert
            v-if="operateType === 'edit' && images.length > 0 && !model.plateNumber"
            type="info"
            :bordered="false"
            class="mb-12px"
          >
            此工单通过快速录入创建，请点击图片上的OCR识别按钮确认工单信息。
          </NAlert>

          <NDivider title-placement="left">基本信息</NDivider>

          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem
                label="工单号"
                :validation-status="
                  model.orderNo && !orderNoValidation.valid
                    ? 'warning'
                    : ocrOrderNoCorrectionMsg
                      ? 'warning'
                      : undefined
                "
                :feedback="ocrOrderNoCorrectionMsg || orderNoValidation.message"
              >
                <NInput
                  v-model:value="model.orderNo"
                  placeholder="不填则自动生成"
                  @update:value="ocrOrderNoCorrectionMsg = ''"
                />
              </NFormItem>
              <NSpace
                v-if="orderNoValidation.candidates.length > 0 || ocrOrderNoCandidates.length > 0"
                class="mb-8px"
                :size="6"
              >
                <NText depth="3">候选修正：</NText>
                <NTag
                  v-for="candidate in ocrOrderNoCandidates.length > 0
                    ? ocrOrderNoCandidates
                    : orderNoValidation.candidates"
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
                  :options="
                    shops.map(s => ({
                      label: `${s.name} (${s.brand})${s.standardTemplateId ? '' : ' [未关联模板]'}`,
                      value: s.id
                    }))
                  "
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
                  type="date"
                  value-format="yyyy-MM-dd"
                  style="width: 100%"
                  clearable
                  @update:formatted-value="(val: string | undefined) => (model.orderDate = val || '')"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="结算月份">
                <NDatePicker
                  :formatted-value="model.settlementMonth || undefined"
                  type="month"
                  value-format="yyyy-MM"
                  style="width: 100%"
                  clearable
                  @update:formatted-value="(val: string | undefined) => (model.settlementMonth = val || '')"
                />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NGrid :cols="2" :x-gap="16">
            <NGridItem>
              <NFormItem label="车牌号" path="plateNumber">
                <NInput
                  v-model:value="model.plateNumber"
                  placeholder="请输入车牌号"
                  :loading="vehicleLookingUp"
                  @blur="onPlateNumberBlur"
                  @update:value="onPlateNumberInput"
                >
                  <template v-if="vehicleFound" #suffix>
                    <NTooltip>
                      <template #trigger>
                        <icon-ic-round-check-circle
                          class="text-18px"
                          style="color: var(--color-success); cursor: pointer"
                        />
                      </template>
                      已匹配历史车辆：{{ vehicleFound.customerName || '客户' }} / 累计
                      {{ vehicleFound.totalOrderCount }} 单
                    </NTooltip>
                  </template>
                </NInput>
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem label="车型">
                <NInput v-model:value="model.carModel" placeholder="请输入车型" />
              </NFormItem>
            </NGridItem>
            <NGridItem v-if="vehicleFound" span="2">
              <NAlert type="success" :bordered="false" closable @close="vehicleFound = null">
                <NSpace align="center" :size="8" :wrap="false">
                  <span>
                    已匹配历史车辆，
                    <template v-if="vehicleMatchedFields.length">
                      已自动填充：{{ vehicleMatchedFields.join('、') }}
                    </template>
                    <template v-else>所有字段已有值</template>
                  </span>
                  <span class="text-gray-400">·</span>
                  <span class="text-12px text-gray-500">
                    累计 {{ vehicleFound.totalOrderCount }} 单 / {{ formatPaintCount(vehicleFound.totalPaintCount) }} 幅
                  </span>
                </NSpace>
              </NAlert>
            </NGridItem>
            <NGridItem span="2">
              <NFormItem
                label="车架号"
                path="vin"
                :validation-status="ocrVinCorrectionMsg ? 'warning' : undefined"
                :feedback="ocrVinCorrectionMsg"
              >
                <NInput v-model:value="model.vin" placeholder="请输入VIN" @update:value="ocrVinCorrectionMsg = ''" />
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
              <NFormItem label="电话" path="phone">
                <NInput v-model:value="model.phone" placeholder="请输入电话" />
              </NFormItem>
            </NGridItem>
          </NGrid>

          <NFormItem label="备注">
            <NInput v-model:value="model.remark" type="textarea" placeholder="请输入备注" :rows="2" />
          </NFormItem>

          <NDivider title-placement="left">
            喷漆项目
            <NTag type="info" size="small" round style="margin-left: 8px">
              总幅数: {{ formatPaintCount(totalPaintCount) }}
            </NTag>
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
            <NText v-else-if="!shopHasTemplate" type="error" class="ml-8px">
              该门店未关联幅数标准模板，请先在门店管理中绑定标准模板
            </NText>
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
          <NButton v-if="images.length > 0" type="primary" size="small" dashed @click="ocrQuickRecognize">
            <template #icon><icon-ic-round-search /></template>
            OCR识别填充
          </NButton>
        </div>
        <!-- OCR 填充结果反馈条 -->
        <Transition name="ocr-filled-fade">
          <div v-if="ocrFilledVisible" class="ocr-filled-bar">
            <icon-ic-round-check-circle class="ocr-filled-icon" />
            <span>已填充：{{ ocrFilledFields.join('、') }}</span>
          </div>
        </Transition>
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
          <NText v-if="images.length > 0" depth="3" style="font-size: 12px">
            点击"OCR识别填充"一键识别第一张图，或点击图片左上角搜索图标进行框选识别
          </NText>
        </NSpace>

        <div class="image-list">
          <div v-for="(img, index) in images" :key="index" class="image-card">
            <NImage
              :src="getImageDisplayUrl(img)"
              :preview-src="img.url.startsWith('blob:') ? img.url : resolveUploadUrl(img.url)"
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

  <!-- OCR 识别弹窗（画布交互与识别调用内聚在子组件） -->
  <OcrCanvasModal
    v-model:visible="showOcrModal"
    v-model:ocr-mode="ocrMode"
    :image="ocrImageIndex >= 0 ? images[ocrImageIndex] : null"
    :shop-id="model.shopId"
    :smart-mode="smartOcrMode"
    :auto-recognize="ocrAutoRecognize"
    @recognized="applyOcrResult"
  />
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
  border-left: 1px solid var(--neutral-150);
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
  color: var(--text-strong);
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
  border: 1px solid var(--neutral-150);
  border-radius: 6px;
  overflow: hidden;
  background: var(--neutral-50);
}

.image-card-img {
  width: 100%;
  height: auto;
  min-height: 120px;
  display: block;
  object-fit: contain;
  background: var(--neutral-100);
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
    border-top: 1px solid var(--neutral-150);
    padding-left: 0;
    padding-top: 16px;
    max-height: 40vh;
  }

  .form-panel {
    max-height: 50vh;
  }
}

.ocr-fields-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ocr-fields-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ocr-filled-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  margin-bottom: 8px;
  background: linear-gradient(135deg, var(--color-success-bg-strong), var(--color-success-bg));
  border: 1px solid var(--color-success-border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-success-deep);
}

.ocr-filled-icon {
  color: var(--color-success);
  font-size: 18px;
}

.ocr-filled-fade-enter-active,
.ocr-filled-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.ocr-filled-fade-enter-from,
.ocr-filled-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
