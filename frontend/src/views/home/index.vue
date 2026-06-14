<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  fetchMonthlyStatistics,
  fetchCategoryBreakdown,
  fetchShopComparison,
  fetchYearOverview
} from '@/service/api/paint';

defineOptions({ name: 'Home' });

const loading = ref(false);
const currentMonth = ref('');

// 初始化当前月份
function initMonth() {
  const now = new Date();
  currentMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 月份导航
function prevMonth() {
  const [y, m] = currentMonth.value.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  currentMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nextMonth() {
  const [y, m] = currentMonth.value.split('-').map(Number);
  const d = new Date(y, m, 1);
  currentMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 统计数据
const monthlyStats = ref<any[]>([]);
const categoryData = ref<any[]>([]);
const shopComparison = ref<any[]>([]);
const yearOverview = ref<any[]>([]);

// 汇总卡片
const summaryCards = computed(() => {
  const totalOrders = monthlyStats.value.reduce((s: number, m: any) => s + m.totalOrders, 0);
  const totalPaintCount = monthlyStats.value.reduce((s: number, m: any) => s + m.totalPaintCount, 0);
  const avgPaint = totalOrders > 0 ? +(totalPaintCount / totalOrders).toFixed(2) : 0;
  return [
    { title: '工单总数', value: totalOrders, icon: 'ant-design:file-text-outlined', color: '#ec4786' },
    { title: '总幅数', value: totalPaintCount, icon: 'ant-design:dashboard-outlined', color: '#56cdf3' },
    { title: '平均幅数', value: avgPaint, icon: 'ant-design:bar-chart-outlined', color: '#865ec0' },
    { title: '门店数', value: monthlyStats.value.length, icon: 'ant-design:shop-outlined', color: '#fcbc25' }
  ];
});

// 部位分布饼图数据
const pieData = computed(() => {
  return categoryData.value.slice(0, 10).map((c: any) => ({
    label: c.categoryName,
    value: +c.totalPaintCount.toFixed(2)
  }));
});

// 年度趋势数据
const yearLineData = computed(() => {
  return yearOverview.value.map((m: any) => ({
    label: `${m.month}月`,
    orders: m.totalOrders,
    paintCount: +m.totalPaintCount.toFixed(1)
  }));
});

// 门店对比数据
const barData = computed(() => {
  return shopComparison.value.map((s: any) => ({
    label: s.shopName,
    orders: s.totalOrders,
    paintCount: +s.totalPaintCount.toFixed(1)
  }));
});

async function loadData() {
  if (!currentMonth.value) return;
  loading.value = true;
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      fetchMonthlyStatistics({ settlementMonth: currentMonth.value }),
      fetchCategoryBreakdown({ settlementMonth: currentMonth.value }),
      fetchShopComparison({ settlementMonth: currentMonth.value }),
      fetchYearOverview({ year: +currentMonth.value.split('-')[0] })
    ]);
    monthlyStats.value = (r1.data || []) as any[];
    categoryData.value = (r2.data || []) as any[];
    shopComparison.value = (r3.data || []) as any[];
    yearOverview.value = (r4.data || []) as any[];
  } finally {
    loading.value = false;
  }
}

watch(currentMonth, () => loadData());
onMounted(() => {
  initMonth();
});
</script>

<template>
  <NSpace vertical :size="16">
    <!-- 月份选择器 -->
    <NCard :bordered="false" class="card-wrapper">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-16px">
          <h3 class="text-20px font-semibold m-0">喷漆业务看板</h3>
          <NSpace align="center">
            <NButton size="small" quaternary @click="prevMonth">
              <template #icon><SvgIcon icon="ant-design:left-outlined" /></template>
            </NButton>
            <span class="text-16px font-medium" style="min-width: 100px; text-align: center">{{ currentMonth }}</span>
            <NButton size="small" quaternary @click="nextMonth">
              <template #icon><SvgIcon icon="ant-design:right-outlined" /></template>
            </NButton>
          </NSpace>
        </div>
        <NSpin v-if="loading" :size="20" />
      </div>
    </NCard>

    <!-- 汇总卡片 -->
    <NGrid cols="s:2 m:4" responsive="screen" :x-gap="16" :y-gap="16">
      <NGi v-for="card in summaryCards" :key="card.title">
        <NCard :bordered="false" size="small" class="card-wrapper">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-14px text-gray-500">{{ card.title }}</div>
              <div class="text-28px font-bold mt-4px" :style="{ color: card.color }">
                <CountTo :start-value="0" :end-value="card.value" :decimals="card.value % 1 !== 0 ? 2 : 0" />
              </div>
            </div>
            <SvgIcon :icon="card.icon" class="text-36px" :style="{ color: card.color }" />
          </div>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 门店对比 + 部位分布 -->
    <NGrid :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <NGi span="24 s:24 m:14">
        <NCard :bordered="false" class="card-wrapper" title="门店对比">
          <div v-if="barData.length === 0" class="text-center text-gray-400 py-20px">暂无数据</div>
          <div v-else class="space-y-12px">
            <div v-for="item in barData" :key="item.label" class="flex items-center gap-12px">
              <span class="text-14px w-200px shrink-0 truncate" :title="item.label">{{ item.label }}</span>
              <div class="flex-1">
                <div class="mb-2px">
                  <span class="text-12px text-gray-500">工单 {{ item.orders }}</span>
                </div>
                <NProgress
                  type="line"
                  :percentage="barData.length > 0 ? (item.paintCount / Math.max(...barData.map(d => d.paintCount))) * 100 : 0"
                  :show-indicator="false"
                  :height="16"
                  :color="'#56cdf3'"
                  rail-color="#f0f0f0"
                />
              </div>
              <span class="text-14px font-medium w-80px text-right">{{ item.paintCount }} 幅</span>
            </div>
          </div>
        </NCard>
      </NGi>
      <NGi span="24 s:24 m:10">
        <NCard :bordered="false" class="card-wrapper" title="部位分布 (Top 10)">
          <div v-if="pieData.length === 0" class="text-center text-gray-400 py-20px">暂无数据</div>
          <div v-else class="space-y-8px">
            <div v-for="(item, idx) in pieData" :key="item.label" class="flex items-center gap-8px">
              <span class="text-12px w-8px" style="min-width: 8px">{{ idx + 1 }}</span>
              <span class="text-13px flex-1 truncate" :title="item.label">{{ item.label }}</span>
              <NProgress
                type="line"
                :percentage="pieData.length > 0 ? (item.value / Math.max(...pieData.map(d => d.value))) * 100 : 0"
                :show-indicator="false"
                :height="10"
                :color="['#ec4786','#56cdf3','#865ec0','#fcbc25','#56d48f','#f68057','#719de3','#b955a4','#5144b4','#fcbc25'][idx % 10]"
                rail-color="#f0f0f0"
                style="max-width: 120px"
              />
              <span class="text-13px font-medium w-60px text-right">{{ item.value }}</span>
            </div>
          </div>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 年度趋势 -->
    <NCard :bordered="false" class="card-wrapper" title="年度趋势">
      <div v-if="yearLineData.length === 0" class="text-center text-gray-400 py-20px">暂无数据</div>
      <div v-else>
        <div class="flex items-end gap-8px" style="height: 200px; padding-top: 20px">
          <div
            v-for="item in yearLineData"
            :key="item.label"
            class="flex-1 flex flex-col items-center justify-end"
            style="height: 100%"
          >
            <div
              class="w-full rd-4px-t"
              :style="{
                height: yearLineData.length > 0 ? Math.max((item.paintCount / Math.max(...yearLineData.map(d => d.paintCount || 1))) * 160, 2) + 'px' : '2px',
                background: 'linear-gradient(to top, #56cdf3, #719de3)',
                minHeight: '2px'
              }"
            />
            <div class="text-11px text-gray-400 mt-4px">{{ item.label }}</div>
          </div>
        </div>
        <div class="flex gap-8px mt-8px">
          <div v-for="item in yearLineData" :key="item.label" class="flex-1 text-center">
            <div class="text-11px text-gray-500">{{ item.paintCount }}</div>
            <div class="text-10px text-gray-400">{{ item.orders }}单</div>
          </div>
        </div>
      </div>
    </NCard>
  </NSpace>
</template>

<style scoped>
.card-wrapper {
  transition: box-shadow 0.2s;
}
</style>
