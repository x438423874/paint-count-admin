<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NGrid,
  NGridItem,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NTag,
  NText,
  NTooltip
} from 'naive-ui';
import { ocrRecognizeImage } from '@/service/api';
import { useThemeStore } from '@/store/modules/theme';

defineOptions({
  name: 'OcrCanvasModal'
});

interface OcrImage {
  /** 图片地址（已有图片为相对路径，新上传为 blob: 地址） */
  url: string;
  /** 新上传的本地文件；已有图片为空 */
  file?: File;
}

interface Props {
  /** 待识别图片 */
  image: OcrImage | null;
  /** 门店 id（OCR 接口参数） */
  shopId?: string;
  /** 打开后自动执行全图识别（快速识别入口用） */
  autoRecognize?: boolean;
  /** 智能推荐的识别范围（由调用方根据表单已填字段计算，传入后显示推荐按钮） */
  smartMode?: 'all' | 'basic' | 'items';
}

const props = withDefaults(defineProps<Props>(), {
  shopId: '',
  autoRecognize: false,
  smartMode: undefined
});

const emit = defineEmits<{
  (e: 'recognized', result: Record<string, any>): void;
}>();

const visible = defineModel<boolean>('visible', {
  default: false
});

const themeStore = useThemeStore();

/** OCR 识别模式：basic 仅基础资料 / items 仅部位 / all 全部 */
const ocrMode = defineModel<'all' | 'basic' | 'items'>('ocrMode', {
  default: 'basic'
});

const ocrLoading = ref(false);
const ocrCanvasRef = ref<HTMLCanvasElement | null>(null);
const ocrImgRef = ref<HTMLImageElement | null>(null);
const isDrawing = ref(false);
const drawStart = ref({ x: 0, y: 0 });
const drawEnd = ref({ x: 0, y: 0 });
const hasCropRegion = ref(false);

// 获取高清图URL（用于OCR识别）
function getHdUrl(img: OcrImage): string {
  if (img.url.startsWith('blob:')) return img.url;
  return `/proxy-demo${img.url}`;
}

// 打开时加载图片并绘制画布；autoRecognize 时直接全图识别
watch(visible, v => {
  if (!v) return;
  hasCropRegion.value = false;
  drawStart.value = { x: 0, y: 0 };
  drawEnd.value = { x: 0, y: 0 };

  nextTick(async () => {
    const img = props.image;
    if (!img) return;
    // 预加载图片到 ocrImgRef，以防 fetch 失败时降级到 canvas 方式
    if (!img.file) {
      await new Promise<void>(resolve => {
        const imgEl = new Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
          ocrImgRef.value = imgEl;
          resolve();
        };
        imgEl.onerror = () => resolve();
        imgEl.src = getHdUrl(img);
      });
    }
    drawOcrCanvas();
    if (props.autoRecognize) {
      await ocrRecognizeFull();
    }
  });
});

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
    ctx.strokeStyle = themeStore.themeColors.success;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
  }
}

// 鼠标事件：框选区域
function onMouseDown(e: MouseEvent) {
  const canvas = ocrCanvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  isDrawing.value = true;
  drawStart.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  drawEnd.value = { ...drawStart.value };
  hasCropRegion.value = false;
}

function onMouseMove(e: MouseEvent) {
  if (!isDrawing.value) return;
  const canvas = ocrCanvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  drawEnd.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  hasCropRegion.value = true;
  drawOcrCanvas();
}

function onMouseUp() {
  isDrawing.value = false;
}

// 调用后端 OCR 识别（blob 来源：本地文件 / fetch 高清图 / canvas 降级）
async function recognize(initialBlob: Blob | null, fallbackCanvas?: () => Promise<Blob | null>) {
  ocrLoading.value = true;
  try {
    let blob = initialBlob;
    if (!blob && fallbackCanvas) {
      blob = await fallbackCanvas();
    }
    if (!blob) {
      window.$message?.error('无法获取图片');
      return;
    }

    const formData = new FormData();
    formData.append('file', blob, 'ocr_image.png');
    if (props.shopId) formData.append('shopId', props.shopId);
    formData.append('ocrMode', ocrMode.value);
    const { data, error } = await ocrRecognizeImage(formData);
    if (!error && data) {
      emit('recognized', data as Record<string, any>);
      visible.value = false;
    } else {
      const errMsg = (error as any)?.message || 'OCR识别失败，请稍后重试';
      window.$message?.error(errMsg);
    }
  } catch {
    window.$message?.error('OCR识别失败，请检查网络后重试');
  } finally {
    ocrLoading.value = false;
  }
}

// 全图OCR识别
async function ocrRecognizeFull() {
  const img = props.image;
  if (!img?.file && !img?.url) return;

  if (img.file) {
    // 新上传的图片，直接用文件
    await recognize(img.file);
    return;
  }

  // 已有图片（URL），优先通过 fetch 下载原始图片（避免 canvas 跨域污染和质量损失）
  let blob: Blob | null = null;
  try {
    const response = await fetch(getHdUrl(img), { mode: 'cors' });
    if (response.ok) {
      blob = await response.blob();
    }
  } catch {
    console.warn('fetch 图片失败，降级到 canvas 方式');
  }

  // fetch 失败，降级使用已预载的 canvas 方式
  await recognize(blob, async () => {
    const imgEl = ocrImgRef.value;
    if (!imgEl) return null;
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    canvas.getContext('2d')!.drawImage(imgEl, 0, 0);
    return new Promise<Blob>(resolve => {
      canvas.toBlob(b => resolve(b!), 'image/png');
    });
  });
}

// 框选区域OCR识别
async function ocrRecognizeCrop() {
  const imgEl = ocrImgRef.value;
  const canvas = ocrCanvasRef.value;
  if (!imgEl || !hasCropRegion.value || !canvas) return;

  // CSS 显示尺寸（不含 dpr）
  const cssWidth = Number.parseFloat(canvas.style.width);
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
    // 从原图裁剪区域，转为 blob 发送给后端
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
      cropCanvas.toBlob(b => {
        if (b) resolve(b);
        else reject(new Error('裁剪失败'));
      }, 'image/png');
    });
    ocrLoading.value = false;
    await recognize(blob);
  } catch {
    window.$message?.error('OCR识别失败，请检查网络后重试');
    ocrLoading.value = false;
  }
}
</script>

<template>
  <NModal v-model:show="visible" preset="card" title="OCR 智能识别" style="width: 900px" :mask-closable="false">
    <NSpace vertical :size="12">
      <!-- 操作说明：两列卡片 -->
      <NGrid :cols="2" :x-gap="12">
        <NGridItem>
          <NCard size="small" :bordered="true" style="background: var(--color-info-bg)">
            <NSpace align="center" :size="8">
              <NText style="font-size: 18px">🔍</NText>
              <NSpace vertical :size="2">
                <NText strong style="font-size: 13px">全图识别</NText>
                <NText depth="3" style="font-size: 12px">识别整张工单，快速填充所有空白字段</NText>
              </NSpace>
            </NSpace>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard size="small" :bordered="true" style="background: var(--color-success-bg)">
            <NSpace align="center" :size="8">
              <NText style="font-size: 18px">✂️</NText>
              <NSpace vertical :size="2">
                <NText strong style="font-size: 13px">标记识别</NText>
                <NText depth="3" style="font-size: 12px">框选图片区域精准识别，适合局部修正</NText>
              </NSpace>
            </NSpace>
          </NCard>
        </NGridItem>
      </NGrid>

      <!-- 可识别字段：分组展示 -->
      <div class="ocr-fields-group">
        <div class="ocr-fields-row">
          <NText depth="3" style="font-size: 12px; white-space: nowrap">基础资料：</NText>
          <NSpace :size="6" wrap>
            <NTag
              v-for="field in ['工单号', '车牌号', '客户名称', '联系电话', '车型', '车架号', '品牌', '日期']"
              :key="field"
              size="small"
              type="info"
              round
            >
              {{ field }}
            </NTag>
          </NSpace>
        </div>
        <div class="ocr-fields-row">
          <NText depth="3" style="font-size: 12px; white-space: nowrap">部位项目：</NText>
          <NSpace :size="6" wrap>
            <NTag size="small" type="success" round>喷漆部位×数量</NTag>
          </NSpace>
        </div>
      </div>

      <!-- 识别范围选择 -->
      <NCard size="small" :bordered="true">
        <NSpace vertical :size="8">
          <NText strong style="font-size: 13px">识别范围</NText>
          <NSpace align="center" :size="12" wrap>
            <NRadioGroup v-model:value="ocrMode" size="small">
              <NRadioButton value="basic">仅基础资料</NRadioButton>
              <NRadioButton value="items">仅部位</NRadioButton>
              <NRadioButton value="all">全部识别</NRadioButton>
            </NRadioGroup>
            <NTooltip v-if="smartMode">
              <template #trigger>
                <NButton type="primary" size="small" ghost @click="ocrMode = smartMode">智能推荐</NButton>
              </template>
              根据已填字段自动选择最省 token 的识别范围（当前推荐：{{
                smartMode === 'all' ? '全部' : smartMode === 'basic' ? '基础资料' : '部位'
              }}）
            </NTooltip>
          </NSpace>
          <NText depth="3" style="font-size: 12px">
            <template v-if="ocrMode === 'basic'">仅识别车牌号、工单号、客户名称等基础字段</template>
            <template v-else-if="ocrMode === 'items'">仅识别喷漆部位项目明细</template>
            <template v-else>同时识别基础字段和部位项目</template>
          </NText>
        </NSpace>
      </NCard>

      <div style="position: relative; display: inline-block; cursor: crosshair">
        <canvas
          ref="ocrCanvasRef"
          style="border: 1px solid var(--neutral-300); border-radius: 4px; display: block"
          @mousedown="onMouseDown"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
          @mouseleave="onMouseUp"
        />
      </div>

      <NAlert v-if="hasCropRegion" type="success" :bordered="false" style="padding: 8px 12px">
        <NSpace align="center" :size="8">
          <NText type="success" style="font-size: 13px; font-weight: 500">已框选标记区域</NText>
          <NText depth="3" style="font-size: 12px">点击"标记区域识别"进行精准识别</NText>
        </NSpace>
      </NAlert>
      <NAlert v-else type="default" :bordered="false" style="padding: 8px 12px">
        <NText depth="3" style="font-size: 12px">提示：按住鼠标左键在图片上拖拽，可框选需要识别的文字区域</NText>
      </NAlert>
    </NSpace>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="visible = false">取消</NButton>
        <NButton type="default" :loading="ocrLoading" @click="ocrRecognizeFull">全图识别</NButton>
        <NButton type="primary" :loading="ocrLoading" :disabled="!hasCropRegion" @click="ocrRecognizeCrop">
          标记区域识别
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.ocr-fields-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ocr-fields-row {
  display: flex;
  align-items: center;
}
</style>
