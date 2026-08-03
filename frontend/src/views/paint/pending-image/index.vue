<script setup lang="ts">
import { NCard, NGrid, NGridItem, NTag, NButton, NImage, NImageGroup, NSpace, NSelect, NInput, NPagination, NUpload, NModal, NEmpty, NPopconfirm, NStatistic, NDescriptions, NDescriptionsItem, NSpin, useMessage } from 'naive-ui';
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue';
import {
  fetchPendingImagePage,
  fetchPendingImageStatusCounts,
  fetchPendingImageCandidates,
  uploadPendingImage,
  autoMatchPendingImage,
  manualMatchPendingImage,
  createOrderFromPending,
  retryOcrPendingImage,
  deletePendingImage,
  fetchPaintShopList,
  fetchWorkOrderPage,
} from '@/service/api';
import type { PaintPendingImage, PendingImageStatus, PendingImageStatusCounts } from '@/service/api';
import { compressDualImage } from '@/utils/image-compress';
import { canEdit as canEditRole } from '@/utils/permission';

const message = useMessage();
const allowEdit = canEditRole();

// 图片URL拼接：通过Vite代理访问，避免跨域（与工单页保持一致）
function getImageUrl(url: string) {
  if (!url || url.startsWith('http') || url.startsWith('blob:')) return url;
  return `/proxy-demo${url}`;
}

// ==================== 筛选 ====================
const shops = ref<{ id: string; name: string; code: string }[]>([]);
const selectedShopId = ref<string | null>(null);
const selectedMonth = ref<string | null>(null);
const selectedStatus = ref<PendingImageStatus | null>(null);
const keyword = ref('');

const shopOptions = computed(() => shops.value.map(s => ({ label: s.name, value: s.id })));
const monthOptions = computed(() => {
  const list: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    list.push({ label: v, value: v });
  }
  return list;
});
const statusOptions: { label: string; value: PendingImageStatus }[] = [
  { label: '待匹配', value: 'PENDING' },
  { label: '已归类', value: 'MATCHED' },
  { label: '待确认', value: 'NEEDS_REVIEW' },
  { label: '人工', value: 'MANUAL' },
  { label: '失败', value: 'FAILED' },
];

const statusTagType: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  PENDING: 'warning',
  MATCHED: 'success',
  NEEDS_REVIEW: 'info',
  MANUAL: 'success',
  FAILED: 'error',
};
const statusLabel: Record<string, string> = {
  PENDING: '待匹配',
  MATCHED: '已归类',
  NEEDS_REVIEW: '待确认',
  MANUAL: '人工',
  FAILED: '失败',
};

/** OCR 生命周期：PENDING/PROCESSING 表示识别中，用户可离开页面 */
function ocrState(item: PaintPendingImage): 'processing' | 'done' | 'failed' {
  const s = item.ocrStatus
  if (s === 'PENDING' || s === 'PROCESSING') return 'processing'
  if (s === 'FAILED') return 'failed'
  return 'done'
}

// 轮询：存在“识别中”记录时每 3s 原地刷新状态，全部完成自动停止
let pollTimer: ReturnType<typeof setInterval> | null = null
const hasRecognizing = computed(() => records.value.some(item => ocrState(item) === 'processing'))

function startPollingIfNeeded() {
  if (hasRecognizing.value && !pollTimer) {
    pollTimer = setInterval(() => loadList(), 3000)
  } else if (!hasRecognizing.value && pollTimer) {
    stopPolling()
  }
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ==================== 列表 ====================
const records = ref<PaintPendingImage[]>([]);
const total = ref(0);
const current = ref(1);
const size = ref(24);
const loading = ref(false);
const counts = reactive<PendingImageStatusCounts>({ PENDING: 0, MATCHED: 0, NEEDS_REVIEW: 0, MANUAL: 0, FAILED: 0, total: 0 });

async function loadShops() {
  try {
    const { data, error } = await fetchPaintShopList();
    shops.value = !error && Array.isArray(data) ? data : [];
    if (shops.value.length > 0 && !selectedShopId.value) {
      selectedShopId.value = shops.value[0].id;
    }
  } catch {
    shops.value = [];
  }
}

async function loadCounts() {
  try {
    const { data, error } = await fetchPendingImageStatusCounts(selectedShopId.value || undefined, selectedMonth.value || undefined);
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
      keyword: keyword.value || undefined,
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
  searching: false,
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
      plateNumber: matchModal.searchKeyword.trim(),
    } as any);
    searchResults.value = res?.records || [];
    // 同时搜工单号
    const { data: res2 }: any = await fetchWorkOrderPage({
      shopId: selectedShopId.value || undefined,
      settlementMonth: selectedMonth.value || undefined,
      current: 1,
      size: 20,
      customerName: matchModal.searchKeyword.trim(),
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
    message.error(e?.message || '操作失败');
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
          :options="[{ label: '匹配', value: 'POOL' }, { label: '新建', value: 'CREATE' }]"
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
                  <NImage
                    :src="getImageUrl(item.thumbnailUrl || item.url)"
                    :preview-src="getImageUrl(item.url)"
                    object-fit="cover"
                    height="160"
                    width="100%"
                  />
                </template>
                <div class="mt-2">
                  <NSpace justify="space-between" align="center">
                    <NSpace size="small">
                      <NTag v-if="ocrState(item) === 'processing'" type="info" size="small" :bordered="false">识别中</NTag>
                      <NTag v-else :type="statusTagType[item.status]" size="small">{{ statusLabel[item.status] }}</NTag>
                      <NTag v-if="item.source" :type="item.source === 'CREATE' ? 'success' : 'default'" size="small" :bordered="false">{{ item.source === 'CREATE' ? '新建' : '匹配' }}</NTag>
                    </NSpace>
                    <span class="text-xs text-gray-400">{{ item.settlementMonth || '未指定月份' }}</span>
                  </NSpace>
                  <NDescriptions :column="1" size="small" label-placement="left" class="mt-1">
                    <NDescriptionsItem label="工单号">{{ item.ocrOrderNo || '-' }}</NDescriptionsItem>
                    <NDescriptionsItem label="车牌">{{ item.ocrPlateNumber || '-' }}</NDescriptionsItem>
                    <NDescriptionsItem v-if="item.ocrVin" label="VIN">{{ item.ocrVin }}</NDescriptionsItem>
                    <NDescriptionsItem label="车型">{{ item.ocrCarModel || '-' }}</NDescriptionsItem>
                  </NDescriptions>
                  <div v-if="item.matchRemark" class="text-xs text-gray-500 mt-1" :title="item.matchRemark">
                    {{ item.matchRemark }}
                  </div>
                  <div v-if="item.matchedOrderId && item.order" class="text-xs text-blue-500 mt-1">
                    已归类: {{ item.order.orderNo || item.order.plateNumber || item.order.id }}
                  </div>
                </div>
                <template #action>
                  <NSpace size="small" :wrap="false">
                    <NButton v-if="allowEdit && ocrState(item) !== 'processing'" size="tiny" @click="onAutoMatch(item)">匹配</NButton>
                    <NButton v-if="allowEdit && ocrState(item) !== 'processing' && (item.status === 'NEEDS_REVIEW' || item.status === 'PENDING')" size="tiny" type="primary" @click="openMatchModal(item)">指派</NButton>
                    <NButton v-if="allowEdit && ocrState(item) !== 'processing' && item.status !== 'MATCHED' && item.status !== 'MANUAL'" size="tiny" @click="onCreateOrder(item)">补建</NButton>
                    <NButton v-if="allowEdit && item.status === 'FAILED'" size="tiny" @click="onRetryOcr(item)">重试</NButton>
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

    <!-- 人工指派弹窗 -->
    <NModal v-model:show="matchModal.show" preset="card" title="人工指派到工单" style="width: 720px; max-width: 95vw">
      <NSpace vertical>
        <div class="text-sm text-gray-500">候选工单（按 OCR 识别的工单号/车牌匹配）</div>
        <NCard v-if="matchModal.candidates.length" size="small" :bordered="true">
          <NSpace vertical size="small">
            <div v-for="o in matchModal.candidates" :key="o.id" class="flex items-center justify-between p-2 rounded hover:bg-gray-50">
              <div>
                <NTag size="small" :type="o.status === 'SETTLED' ? 'info' : o.status === 'AUDITED' ? 'success' : 'warning'">{{ o.status }}</NTag>
                <span class="ml-2 font-medium">{{ o.orderNo || '(无工单号)' }}</span>
                <span class="ml-2 text-gray-500">{{ o.plateNumber || '-' }}</span>
                <span class="ml-2 text-gray-400 text-xs">{{ o.carModel || '' }} {{ o.settlementMonth || '' }}</span>
              </div>
              <NButton size="small" type="primary" @click="confirmMatch(o.id)">归类到此</NButton>
            </div>
          </NSpace>
        </NCard>
        <NEmpty v-else description="无候选工单" />

        <div class="text-sm text-gray-500 mt-2">手动搜索工单</div>
        <NSpace>
          <NInput v-model:value="matchModal.searchKeyword" placeholder="工单号/车牌/客户名" style="width: 260px" @keyup.enter="searchOrders" />
          <NButton :loading="matchModal.searching" @click="searchOrders">搜索</NButton>
        </NSpace>
        <NCard v-if="searchResults.length" size="small" :bordered="true">
          <NSpace vertical size="small">
            <div v-for="o in searchResults" :key="o.id" class="flex items-center justify-between p-2 rounded hover:bg-gray-50">
              <div>
                <span class="font-medium">{{ o.orderNo || '(无工单号)' }}</span>
                <span class="ml-2 text-gray-500">{{ o.plateNumber || '-' }}</span>
                <span class="ml-2 text-gray-400 text-xs">{{ o.carModel || '' }} {{ o.settlementMonth || '' }}</span>
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
.text-gray-400 { color: #9ca3af; }
.text-gray-500 { color: #6b7280; }
.text-blue-500 { color: #3b82f6; }
.hover\:bg-gray-50:hover { background: #f9fafb; }
</style>
