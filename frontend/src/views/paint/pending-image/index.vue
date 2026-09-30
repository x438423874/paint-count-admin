<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NImage,
  NImageGroup,
  NInput,
  NModal,
  NPagination,
  NPopconfirm,
  NSelect,
  NSpace,
  NSpin,
  NStatistic,
  NTag,
  NUpload,
  useMessage
} from 'naive-ui';
import {
  autoMatchPendingImage,
  correctPendingImageOcr,
  createOrderFromPending,
  deletePendingImage,
  fetchPendingImageCandidates,
  fetchPendingImagePage,
  fetchPendingImageStatusCounts,
  fetchWorkOrderPage,
  manualMatchPendingImage,
  retryOcrPendingImage,
  uploadPendingImage
} from '@/service/api';
import type { PaintPendingImage, PendingImageStatus, PendingImageStatusCounts } from '@/service/api';
import { useShopOptions } from '@/hooks/business/use-shop-options';
import { compressDualImage } from '@/utils/image-compress';
import { canEdit as canEditRole } from '@/utils/permission';
import { recentMonthOptions } from '@/utils/month-options';
import { resolveUploadUrl } from '@/utils/upload-url';

const message = useMessage();
const allowEdit = canEditRole();

// 图片URL拼接：通过Vite代理访问，避免跨域（与工单页保持一致）
function getImageUrl(url: string) {
  if (!url || url.startsWith('http') || url.startsWith('blob:')) return url;
  return resolveUploadUrl(url);
}

// ==================== 筛选 ====================
// 门店走 paint store 共享缓存，全应用只请求一次（原为每页各自 fetchPaintShopList）
const { shopOptions, ensureShops } = useShopOptions();
const selectedShopId = ref<string | null>(null);
const selectedMonth = ref<string | null>(null);
const selectedStatus = ref<PendingImageStatus | null>(null);
const keyword = ref('');

// 月份选项统一走 utils/month-options（原先本页与 reconcile 各一份重复实现）
const monthOptions = computed(() => recentMonthOptions());
const statusOptions: { label: string; value: PendingImageStatus }[] = [
  { label: '待匹配', value: 'PENDING' },
  { label: '已归类', value: 'MATCHED' },
  { label: '待确认', value: 'NEEDS_REVIEW' },
  { label: '人工', value: 'MANUAL' },
  { label: '失败', value: 'FAILED' }
];

const statusTagType: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  PENDING: 'warning',
  MATCHED: 'success',
  NEEDS_REVIEW: 'info',
  MANUAL: 'success',
  FAILED: 'error'
};
const statusLabel: Record<string, string> = {
  PENDING: '待匹配',
  MATCHED: '已归类',
  NEEDS_REVIEW: '待确认',
  MANUAL: '人工',
  FAILED: '失败'
};

/** OCR 生命周期：PENDING/PROCESSING 表示识别中，用户可离开页面 */
function ocrState(item: PaintPendingImage): 'processing' | 'done' | 'failed' {
  const s = item.ocrStatus;
  if (s === 'PENDING' || s === 'PROCESSING') return 'processing';
  if (s === 'FAILED') return 'failed';
  return 'done';
}

const records = ref<PaintPendingImage[]>([]);

// 轮询：存在“识别中”记录时每 3s 原地刷新状态，全部完成自动停止
let pollTimer: ReturnType<typeof setInterval> | null = null;
const hasRecognizing = computed(() => records.value.some(item => ocrState(item) === 'processing'));

function startPollingIfNeeded() {
  if (hasRecognizing.value && !pollTimer) {
    pollTimer = setInterval(() => loadList(), 3000);
  } else if (!hasRecognizing.value && pollTimer) {
    stopPolling();
  }
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ==================== 列表 ====================
const total = ref(0);
const current = ref(1);
const size = ref(24);
const loading = ref(false);
const counts = reactive<PendingImageStatusCounts>({
  PENDING: 0,
  MATCHED: 0,
  NEEDS_REVIEW: 0,
  MANUAL: 0,
  FAILED: 0,
  total: 0
});

async function loadShops() {
  try {
    const list = await ensureShops();
    if (list.length > 0 && !selectedShopId.value) {
      selectedShopId.value = list[0].id;
    }
  } catch {
    // 门店加载失败不阻断页面（列表内已有空态提示）
  }
}

async function loadCounts() {
  try {
    const { data, error } = await fetchPendingImageStatusCounts(
      selectedShopId.value || undefined,
      selectedMonth.value || undefined
    );
    if (!error && data) Object.assign(counts, data);
  } catch {
    // ignore
  }
}

async function loadList(reset = false) {
  if (!selectedShopId.value) {
    message.warning('请先选择门店');
    return;
  }
  if (reset) current.value = 1;
  loading.value = true;
  try {
    const { data }: any = await fetchPendingImagePage({
      current: current.value,
      size: size.value,
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      status: selectedStatus.value || undefined,
      keyword: keyword.value || undefined
    });
    records.value = data?.records || [];
    total.value = data?.total || 0;
    loadCounts();
  } catch {
    records.value = [];
  } finally {
    loading.value = false;
    startPollingIfNeeded();
  }
}

function onFilterChange() {
  loadList(true);
}

// ==================== 上传 ====================
const uploading = ref(false);
const uploadProgress = reactive({ done: 0, total: 0 });
// 上传来源：POOL=匹配(图片池直接上传) / CREATE=新建(OCR 后自动建单)，对齐 h5 上传模式
const uploadSource = ref<'POOL' | 'CREATE'>('POOL');

async function handleUploadFile({ file, onFinish, onError }: any) {
  const ori = file.file as File;
  if (!selectedShopId.value) {
    message.warning('请先选择门店');
    onError();
    return;
  }
  try {
    const { hd, thumbnail } = await compressDualImage(ori);
    const fd = new FormData();
    fd.append('file', hd, ori.name);
    fd.append('thumbnail', thumbnail);
    fd.append('shopId', selectedShopId.value);
    if (selectedMonth.value) fd.append('settlementMonth', selectedMonth.value);
    await uploadPendingImage(fd, uploadSource.value);
    onFinish();
    uploadProgress.done++;
    if (uploadProgress.done >= uploadProgress.total) {
      uploading.value = false;
      message.success(`上传完成 ${uploadProgress.done} 张，正在后台识别…`);
      loadList();
    }
  } catch (e: any) {
    onError();
    message.error(`上传失败: ${e?.message || e}`);
  }
}

function onUploadChange({ fileList }: any) {
  if (fileList.length > 0 && !uploading.value) {
    uploading.value = true;
    uploadProgress.done = 0;
    uploadProgress.total = fileList.length;
  }
}

// ==================== 操作 ====================
async function onAutoMatch(item: PaintPendingImage) {
  try {
    const { data: res }: any = await autoMatchPendingImage(item.id);
    if (res?.status === 'MATCHED' || res?.status === 'MANUAL') {
      message.success(`已归类到工单 ${item.order?.orderNo || ''}`);
    } else if (res?.status === 'NEEDS_REVIEW') {
      message.info('命中多个候选，请人工确认');
    } else {
      message.info(res?.remark || '暂无匹配');
    }
    loadList();
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  }
}

async function onRetryOcr(item: PaintPendingImage) {
  try {
    await retryOcrPendingImage(item.id);
    message.success('已提交重试，正在后台识别…');
    loadList();
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  }
}

async function onCreateOrder(item: PaintPendingImage) {
  try {
    await createOrderFromPending(item.id, selectedMonth.value || undefined);
    message.success('已补建工单并归类');
    loadList();
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  }
}

async function onDelete(item: PaintPendingImage) {
  try {
    await deletePendingImage(item.id);
    message.success('已删除');
    loadList();
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  }
}

// ==================== 人工指派弹窗 ====================
const matchModal = reactive({
  show: false,
  pendingId: '',
  candidates: [] as any[],
  searchKeyword: '',
  searching: false
});
const searchResults = ref<any[]>([]);

function openMatchModal(item: PaintPendingImage) {
  matchModal.pendingId = item.id;
  matchModal.searchKeyword = '';
  searchResults.value = [];
  matchModal.show = true;
  loadCandidates(item.id);
}

async function loadCandidates(id: string) {
  try {
    const { data }: any = await fetchPendingImageCandidates(id);
    matchModal.candidates = data || [];
  } catch {
    matchModal.candidates = [];
  }
}

async function searchOrders() {
  if (!matchModal.searchKeyword.trim() || !selectedShopId.value) return;
  matchModal.searching = true;
  try {
    const { data: res }: any = await fetchWorkOrderPage({
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      current: 1,
      size: 20,
      // 复用 plateNumber/customerName 字段做关键词搜索
      plateNumber: matchModal.searchKeyword.trim()
    } as any);
    searchResults.value = res?.records || [];
    // 同时搜工单号
    const { data: res2 }: any = await fetchWorkOrderPage({
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      current: 1,
      size: 20,
      customerName: matchModal.searchKeyword.trim()
    } as any);
    const merged = [...(res?.records || []), ...(res2?.records || [])];
    const seen = new Set<string>();
    searchResults.value = merged.filter((o: any) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
  } catch {
    searchResults.value = [];
  } finally {
    matchModal.searching = false;
  }
}

async function confirmMatch(orderId: string) {
  try {
    await manualMatchPendingImage(matchModal.pendingId, orderId);
    message.success('已归类');
    matchModal.show = false;
    loadList();
  } catch (e: any) {
    message.error(e?.response?.data?.message || e?.message || '操作失败');
  }
}

// ==================== 修正识别结果 ====================
// 待匹配(PENDING)/待确认(NEEDS_REVIEW)/失败(FAILED) 均可修正后重新匹配
function canCorrect(item: PaintPendingImage) {
  return allowEdit && ocrState(item) !== 'processing' && item.status !== 'MATCHED' && item.status !== 'MANUAL';
}

const correctModal = reactive({
  show: false,
  submitting: false,
  pendingId: '',
  previewUrl: ''
});
const correctForm = reactive<Record<string, string>>({
  orderNo: '',
  plateNumber: '',
  vin: '',
  carModel: '',
  brand: '',
  customerName: '',
  phone: '',
  date: ''
});
const correctMonth = ref<string | null>(null);

const correctFields: { key: string; label: string; placeholder: string }[] = [
  { key: 'orderNo', label: '工单号', placeholder: '用于匹配工单的关键字段' },
  { key: 'plateNumber', label: '车牌号', placeholder: '工单号缺失时按车牌匹配' },
  { key: 'vin', label: '车架号', placeholder: 'VIN' },
  { key: 'carModel', label: '车型', placeholder: '如 别克君威' },
  { key: 'brand', label: '品牌', placeholder: '如 别克' },
  { key: 'customerName', label: '客户名称', placeholder: '客户姓名' },
  { key: 'phone', label: '电话', placeholder: '联系电话' },
  { key: 'date', label: '工单日期', placeholder: 'YYYY-MM-DD' }
];

function openCorrectModal(item: PaintPendingImage) {
  correctModal.pendingId = item.id;
  correctModal.previewUrl = getImageUrl(item.url);
  correctForm.orderNo = item.ocrOrderNo || '';
  correctForm.plateNumber = item.ocrPlateNumber || '';
  correctForm.vin = item.ocrVin || '';
  correctForm.carModel = item.ocrCarModel || '';
  correctForm.brand = item.ocrBrand || '';
  correctForm.customerName = item.ocrCustomerName || '';
  correctForm.phone = item.ocrPhone || '';
  correctForm.date = item.ocrDate || '';
  correctMonth.value = item.settlementMonth || null;
  correctModal.show = true;
}

async function submitCorrect(rematch: boolean) {
  if (!correctModal.pendingId) return;
  correctModal.submitting = true;
  try {
    const { data }: any = await correctPendingImageOcr(
      correctModal.pendingId,
      {
        orderNo: correctForm.orderNo,
        plateNumber: correctForm.plateNumber,
        vin: correctForm.vin,
        carModel: correctForm.carModel,
        brand: correctForm.brand,
        customerName: correctForm.customerName,
        phone: correctForm.phone,
        date: correctForm.date,
        settlementMonth: correctMonth.value || ''
      },
      rematch
    );
    const res = data?.match;
    if (!rematch) {
      message.success('识别结果已保存');
    } else if (res?.status === 'MATCHED' || res?.status === 'MANUAL') {
      message.success('已修正并归类到工单');
    } else if (res?.status === 'NEEDS_REVIEW') {
      message.info('已修正，命中多个候选，请人工指派');
    } else {
      message.info(res?.remark || '已修正，仍未匹配到工单');
    }
    correctModal.show = false;
    loadList();
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  } finally {
    correctModal.submitting = false;
  }
}

// ==================== 图片预览 ====================
onMounted(async () => {
  await loadShops();
  if (selectedShopId.value) loadList(true);
});

onUnmounted(() => stopPolling());
</script>

<template>
  <div class="p-3">
    <!-- 筛选栏 -->
    <NCard size="small" class="mb-3">
      <NSpace align="center" :wrap="true">
        <span>门店</span>
        <NSelect
          v-model:value="selectedShopId"
          :options="shopOptions"
          placeholder="选择门店"
          style="width: 200px"
          @update:value="onFilterChange"
        />
        <span>月份</span>
        <NSelect
          v-model:value="selectedMonth"
          :options="monthOptions"
          placeholder="选择月份"
          clearable
          style="width: 140px"
          @update:value="onFilterChange"
        />
        <span>状态</span>
        <NSelect
          v-model:value="selectedStatus"
          :options="statusOptions"
          placeholder="全部状态"
          clearable
          style="width: 140px"
          @update:value="onFilterChange"
        />
        <NInput
          v-model:value="keyword"
          placeholder="工单号/车牌"
          clearable
          style="width: 180px"
          @update:value="onFilterChange"
        />
        <NSelect
          v-if="allowEdit"
          v-model:value="uploadSource"
          :options="[
            { label: '匹配', value: 'POOL' },
            { label: '新建', value: 'CREATE' }
          ]"
          style="width: 110px"
        />
        <NUpload
          v-if="allowEdit"
          :show-file-list="false"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp"
          :custom-request="handleUploadFile"
          @change="onUploadChange"
        >
          <NButton type="primary" :loading="uploading">
            {{ uploading ? `上传中 ${uploadProgress.done}/${uploadProgress.total}` : '上传图片到池' }}
          </NButton>
        </NUpload>
      </NSpace>
    </NCard>

    <!-- 状态统计 -->
    <NCard size="small" class="mb-3">
      <NSpace :wrap="true">
        <NStatistic label="总数" :value="counts.total" />
        <NStatistic label="待匹配" :value="counts.PENDING" />
        <NStatistic label="待确认" :value="counts.NEEDS_REVIEW" />
        <NStatistic label="已归类" :value="counts.MATCHED + counts.MANUAL" />
        <NStatistic label="失败" :value="counts.FAILED" />
      </NSpace>
    </NCard>

    <!-- 列表 -->
    <NCard size="small">
      <NSpin :show="loading">
        <NEmpty v-if="records.length === 0" description="暂无图片" />
        <NImageGroup v-else>
          <NGrid :x-gap="12" :y-gap="12" cols="2 s:3 m:4 l:5 xl:6" responsive="screen">
            <NGridItem v-for="item in records" :key="item.id">
              <NCard size="small" :bordered="true" hoverable>
                <template #cover>
                  <div class="img-cover">
                    <NImage
                      :src="getImageUrl(item.thumbnailUrl || item.url)"
                      :preview-src="getImageUrl(item.url)"
                      object-fit="cover"
                      height="160"
                      width="100%"
                    />
                  </div>
                </template>
                <div class="mt-2">
                  <NSpace justify="space-between" align="center">
                    <NSpace size="small">
                      <NTag v-if="ocrState(item) === 'processing'" type="info" size="small" :bordered="false">
                        识别中
                      </NTag>
                      <NTag v-else :type="statusTagType[item.status]" size="small">{{ statusLabel[item.status] }}</NTag>
                      <NTag
                        v-if="item.source"
                        :type="item.source === 'CREATE' ? 'success' : 'default'"
                        size="small"
                        :bordered="false"
                      >
                        {{ item.source === 'CREATE' ? '新建' : '匹配' }}
                      </NTag>
                    </NSpace>
                    <span class="text-xs text-gray-400">{{ item.settlementMonth || '未指定月份' }}</span>
                  </NSpace>
                  <NDescriptions :column="1" size="small" label-placement="left" class="mt-1 desc-wrap">
                    <NDescriptionsItem label="工单号">{{ item.ocrOrderNo || '-' }}</NDescriptionsItem>
                    <NDescriptionsItem label="车牌">{{ item.ocrPlateNumber || '-' }}</NDescriptionsItem>
                    <NDescriptionsItem v-if="item.ocrVin" label="VIN">{{ item.ocrVin }}</NDescriptionsItem>
                    <NDescriptionsItem label="车型">{{ item.ocrCarModel || '-' }}</NDescriptionsItem>
                  </NDescriptions>
                  <div v-if="item.matchRemark" class="mt-1 text-xs text-gray-500" :title="item.matchRemark">
                    {{ item.matchRemark }}
                  </div>
                  <div v-if="item.matchedOrderId && item.order" class="mt-1 text-xs text-blue-500">
                    已归类: {{ item.order.orderNo || item.order.plateNumber || item.order.id }}
                  </div>
                </div>
                <template #action>
                  <NSpace size="small" :wrap="true" class="card-action">
                    <NButton v-if="canCorrect(item)" size="tiny" @click="openCorrectModal(item)">修正</NButton>
                    <NButton v-if="allowEdit && ocrState(item) !== 'processing'" size="tiny" @click="onAutoMatch(item)">
                      匹配
                    </NButton>
                    <NButton
                      v-if="
                        allowEdit &&
                        ocrState(item) !== 'processing' &&
                        (item.status === 'NEEDS_REVIEW' || item.status === 'PENDING')
                      "
                      size="tiny"
                      type="primary"
                      @click="openMatchModal(item)"
                    >
                      指派
                    </NButton>
                    <NButton
                      v-if="
                        allowEdit &&
                        ocrState(item) !== 'processing' &&
                        item.status !== 'MATCHED' &&
                        item.status !== 'MANUAL'
                      "
                      size="tiny"
                      @click="onCreateOrder(item)"
                    >
                      补建
                    </NButton>
                    <NButton v-if="allowEdit && item.status === 'FAILED'" size="tiny" @click="onRetryOcr(item)">
                      重试
                    </NButton>
                    <span v-if="ocrState(item) === 'processing'" class="text-xs text-blue-500">识别中，请稍候…</span>
                    <NPopconfirm v-if="allowEdit" @positive-click="onDelete(item)">
                      <template #trigger>
                        <NButton size="tiny" type="error" ghost>删除</NButton>
                      </template>
                      确定删除该图片？
                    </NPopconfirm>
                  </NSpace>
                </template>
              </NCard>
            </NGridItem>
          </NGrid>
        </NImageGroup>
      </NSpin>

      <div class="mt-3 flex justify-end">
        <NPagination
          v-model:page="current"
          :item-count="total"
          :page-size="size"
          show-quick-jumper
          @update:page="loadList()"
        />
      </div>
    </NCard>

    <!-- 修正识别结果弹窗 -->
    <NModal v-model:show="correctModal.show" preset="card" title="修正识别结果" style="width: 780px; max-width: 95vw">
      <NGrid :x-gap="16" cols="1 m:2" responsive="screen">
        <NGridItem>
          <NImage :src="correctModal.previewUrl" object-fit="contain" height="260" width="100%" />
          <div class="mt-2 text-xs text-gray-500">结算月份用于限定匹配范围，留空则在该门店全部月份中匹配。</div>
          <NSelect
            v-model:value="correctMonth"
            :options="monthOptions"
            placeholder="结算月份（不限）"
            clearable
            class="mt-1"
          />
        </NGridItem>
        <NGridItem>
          <NForm label-placement="top" size="small">
            <NGrid :x-gap="12" cols="1 s:2" responsive="screen">
              <NGridItem v-for="f in correctFields" :key="f.key">
                <NFormItem :label="f.label">
                  <NInput v-model:value="correctForm[f.key]" :placeholder="f.placeholder" clearable />
                </NFormItem>
              </NGridItem>
            </NGrid>
          </NForm>
        </NGridItem>
      </NGrid>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="correctModal.show = false">取消</NButton>
          <NButton :loading="correctModal.submitting" @click="submitCorrect(false)">仅保存</NButton>
          <NButton type="primary" :loading="correctModal.submitting" @click="submitCorrect(true)">
            保存并重新匹配
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 人工指派弹窗 -->
    <NModal v-model:show="matchModal.show" preset="card" title="人工指派到工单" style="width: 720px; max-width: 95vw">
      <NSpace vertical>
        <div class="text-sm text-gray-500">候选工单（按 OCR 识别的工单号/车牌匹配）</div>
        <NCard v-if="matchModal.candidates.length" size="small" :bordered="true">
          <NSpace vertical size="small">
            <div
              v-for="o in matchModal.candidates"
              :key="o.id"
              class="flex items-center justify-between rounded p-2 hover:bg-gray-50"
            >
              <div>
                <NTag
                  size="small"
                  :type="o.status === 'SETTLED' ? 'info' : o.status === 'AUDITED' ? 'success' : 'warning'"
                >
                  {{ o.status }}
                </NTag>
                <span class="ml-2 font-medium">{{ o.orderNo || '(无工单号)' }}</span>
                <span class="ml-2 text-gray-500">{{ o.plateNumber || '-' }}</span>
                <span class="ml-2 text-xs text-gray-400">{{ o.carModel || '' }} {{ o.settlementMonth || '' }}</span>
              </div>
              <NButton size="small" type="primary" @click="confirmMatch(o.id)">归类到此</NButton>
            </div>
          </NSpace>
        </NCard>
        <NEmpty v-else description="无候选工单" />

        <div class="mt-2 text-sm text-gray-500">手动搜索工单</div>
        <NSpace>
          <NInput
            v-model:value="matchModal.searchKeyword"
            placeholder="工单号/车牌/客户名"
            style="width: 260px"
            @keyup.enter="searchOrders"
          />
          <NButton :loading="matchModal.searching" @click="searchOrders">搜索</NButton>
        </NSpace>
        <NCard v-if="searchResults.length" size="small" :bordered="true">
          <NSpace vertical size="small">
            <div
              v-for="o in searchResults"
              :key="o.id"
              class="flex items-center justify-between rounded p-2 hover:bg-gray-50"
            >
              <div>
                <span class="font-medium">{{ o.orderNo || '(无工单号)' }}</span>
                <span class="ml-2 text-gray-500">{{ o.plateNumber || '-' }}</span>
                <span class="ml-2 text-xs text-gray-400">{{ o.carModel || '' }} {{ o.settlementMonth || '' }}</span>
              </div>
              <NButton size="small" type="primary" @click="confirmMatch(o.id)">归类到此</NButton>
            </div>
          </NSpace>
        </NCard>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.text-gray-400 {
  color: #9ca3af;
}
.text-gray-500 {
  color: #6b7280;
}
.text-blue-500 {
  color: #3b82f6;
}
.hover\:bg-gray-50:hover {
  background: #f9fafb;
}

/* 封面图裁剪，防止溢出卡片 */
.img-cover {
  height: 160px;
  overflow: hidden;
  background: #f5f5f5;
}
.img-cover :deep(.n-image),
.img-cover :deep(.n-image img) {
  width: 100%;
  height: 100%;
  display: block;
}

/* 操作按钮区允许换行，避免窄卡片下超出父级 */
.card-action {
  flex-wrap: wrap;
  row-gap: 6px;
}

/* 描述长文本（VIN/工单号）自动换行，避免溢出 */
.desc-wrap :deep(.n-descriptions-table-content__content),
.desc-wrap :deep(.n-descriptions-table-content),
.desc-wrap :deep(.n-descriptions-table) {
  word-break: break-all;
  overflow-wrap: anywhere;
}
</style>
