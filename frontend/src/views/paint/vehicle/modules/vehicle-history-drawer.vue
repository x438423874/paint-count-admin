<script setup lang="ts">
import { ref, watch } from 'vue';
import { NButton, NCard, NEmpty, NRadioButton, NRadioGroup, NSpace, NStatistic, NTag } from 'naive-ui';
import { getPaintOrderStatusLabel, getPaintOrderStatusTagType } from '@/constants/paint';
import { fetchVehicleHistory } from '@/service/api';

defineOptions({
  name: 'VehicleHistoryDrawer'
});

interface Props {
  vehicle: any | null;
}

const props = defineProps<Props>();

const visible = defineModel<boolean>('visible', { default: false });

const loading = ref(false);
const records = ref<any[]>([]);
const total = ref(0);
const summary = ref<any>({});
const scope = ref<'current_shop' | 'all_shops'>('all_shops');
const current = ref(1);
const size = ref(20);

async function loadHistory() {
  if (!props.vehicle?.id) return;
  loading.value = true;
  try {
    const { data, error } = await fetchVehicleHistory(props.vehicle.id, {
      scope: scope.value,
      current: current.value,
      size: size.value
    });
    if (!error && data) {
      records.value = data.records || [];
      total.value = data.total || 0;
      summary.value = data.summary || {};
    }
  } finally {
    loading.value = false;
  }
}

watch(
  () => visible.value,
  v => {
    if (v && props.vehicle?.id) {
      scope.value = 'all_shops';
      current.value = 1;
      loadHistory();
    }
  }
);

watch(scope, () => {
  current.value = 1;
  loadHistory();
});

function formatDate(d: string | null) {
  if (!d) return '-';
  return d.slice(0, 10);
}

// 状态文案/颜色统一走 constants/paint（原映射 PENDING=info、SETTLED=warning 与工单列表口径漂移）
function getStatusType(status: string) {
  return getPaintOrderStatusTagType(status);
}

function getStatusLabel(status: string) {
  return getPaintOrderStatusLabel(status);
}
</script>

<template>
  <NDrawer v-model:show="visible" display-directive="show" :width="720">
    <NDrawerContent :title="`车辆历史 - ${vehicle?.plateNumber || ''}`" :native-scrollbar="false" closable>
      <!-- 车辆基本信息 -->
      <NCard size="small" :bordered="true" class="mb-12px">
        <NSpace align="center" :size="24" :wrap="true">
          <NStatistic label="客户" :value="vehicle?.customerName || '-'" />
          <NStatistic label="电话" :value="vehicle?.phone || '-'" />
          <NStatistic label="车型" :value="vehicle?.carModel || '-'" />
          <NStatistic label="品牌" :value="vehicle?.brand || '-'" />
        </NSpace>
      </NCard>

      <!-- 统计摘要 -->
      <NCard size="small" :bordered="true" class="mb-12px">
        <NSpace align="center" :size="24" :wrap="true">
          <NStatistic label="累计工单" :value="summary.totalOrders || 0" />
          <NStatistic label="累计幅数" :value="Number(summary.totalPaintCount || 0).toFixed(1)" />
          <NStatistic label="涉及门店" :value="summary.shopCount || 0" />
          <NStatistic label="返工次数" :value="summary.reworkCount || 0" />
          <NStatistic label="异常工单" :value="summary.abnormalCount || 0" />
        </NSpace>
        <div v-if="summary.firstOrderAt" class="mt-8px text-12px text-gray-500">
          首次进店：{{ formatDate(summary.firstOrderAt) }} · 最近进店：{{ formatDate(summary.lastOrderAt) }}
        </div>
      </NCard>

      <!-- 范围切换 -->
      <div class="mb-12px flex items-center justify-between">
        <NRadioGroup v-model:value="scope" size="small">
          <NRadioButton value="all_shops">全部门店</NRadioButton>
          <NRadioButton value="current_shop">当前门店</NRadioButton>
        </NRadioGroup>
        <NButton size="small" ghost type="primary" :loading="loading" @click="loadHistory">刷新</NButton>
      </div>

      <!-- 工单列表 -->
      <div v-loading="loading">
        <NEmpty v-if="!records.length" description="暂无历史工单" />
        <div v-else class="flex flex-col gap-8px">
          <div
            v-for="order in records"
            :key="order.id"
            class="border border-gray-200 rounded-6px p-12px dark:border-gray-700"
          >
            <div class="mb-6px flex items-center justify-between">
              <NSpace align="center" :size="8">
                <span class="font-bold">{{ order.orderNo || '(无工单号)' }}</span>
                <NTag :type="getStatusType(order.status)" size="small">
                  {{ getStatusLabel(order.status) }}
                </NTag>
                <NTag v-if="order.isRework" type="warning" size="small">返工</NTag>
              </NSpace>
              <span class="text-14px text-primary font-bold">{{ Number(order.totalPaintCount).toFixed(1) }} 幅</span>
            </div>
            <div class="text-12px text-gray-500">
              {{ formatDate(order.orderDate?.toString()) }} · {{ order.shop?.name || '-' }} · 部位数
              {{ order.items?.length || 0 }}
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <NButton @click="visible = false">关闭</NButton>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
