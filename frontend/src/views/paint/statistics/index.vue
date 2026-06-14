<script setup lang="tsx">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { NCard, NGrid, NGi, NStatistic, NSelect, NSpace, NTag, NDataTable, NH3, NNumberAnimation, NDatePicker, NButton, NEmpty } from 'naive-ui';
import { fetchMonthlyStatistics, fetchShopComparison, fetchYearOverview, fetchPaintShopList, fetchCategoryBreakdown, exportStatisticsCsv, exportStatisticsExcel } from '@/service/api';
import { useEcharts } from '@/hooks/common/echarts';

const shops = ref<{ id: string; name: string; code: string }[]>([]);
const selectedShopId = ref<string | null>(null);
const selectedSettlementMonth = ref<string | null>(null);

const monthlyData = ref<any[]>([]);
const shopComparison = ref<any[]>([]);
const yearOverview = ref<any[]>([]);
const categoryBreakdown = ref<any[]>([]);
const loading = ref(false);

onMounted(async () => {
  await loadShops();
  const now = new Date();
  selectedSettlementMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await loadAllData();
});

async function loadShops() {
  const { data, error } = await fetchPaintShopList();
  if (!error && data) {
    shops.value = data;
  }
}

async function loadAllData() {
  loading.value = true;
  try {
    const params: any = {};
    if (selectedSettlementMonth.value) params.settlementMonth = selectedSettlementMonth.value;
    if (selectedShopId.value) params.shopId = selectedShopId.value;

    const [monthlyRes, comparisonRes, yearRes, categoryRes] = await Promise.all([
      fetchMonthlyStatistics(params),
      fetchShopComparison(params),
      fetchYearOverview({ year: selectedSettlementMonth.value ? parseInt(selectedSettlementMonth.value.split('-')[0]) : new Date().getFullYear(), ...(selectedShopId.value && { shopId: selectedShopId.value }) }),
      fetchCategoryBreakdown(params)
    ]);

    if (!monthlyRes.error) monthlyData.value = monthlyRes.data || [];
    if (!comparisonRes.error) shopComparison.value = comparisonRes.data || [];
    if (!yearRes.error) yearOverview.value = yearRes.data || [];
    if (!categoryRes.error) categoryBreakdown.value = categoryRes.data || [];

    // 更新图表
    await nextTick();
    updateDailyChart();
    updateShopComparisonChart();
    updateYearTrendChart();
    updateCategoryChart();
  } finally {
    loading.value = false;
  }
}

const totalStats = computed(() => {
  return {
    totalOrders: monthlyData.value.reduce((s, d) => s + (d.totalOrders || 0), 0),
    totalPaintCount: monthlyData.value.reduce((s, d) => s + Number(d.totalPaintCount || 0), 0),
    shopCount: monthlyData.value.length
  };
});

const dailyColumns = [
  { key: 'date', title: '日期', width: 110, align: 'center' as const },
  { key: 'orderCount', title: '工单数', width: 80, align: 'center' as const },
  { key: 'paintCount', title: '幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="info">{row.paintCount?.toFixed(1)}</NTag> }
];

const categoryColumns = [
  { key: 'categoryName', title: '项目名称', minWidth: 120, ellipsis: { tooltip: true } as any },
  { key: 'totalCount', title: '次数', width: 80, align: 'center' as const },
  { key: 'totalPaintCount', title: '总幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="success">{row.totalPaintCount?.toFixed(1)}</NTag> }
];

const comparisonColumns = [
  { key: 'shopName', title: '门店', minWidth: 150 },
  { key: 'totalOrders', title: '工单数', width: 90, align: 'center' as const },
  { key: 'totalPaintCount', title: '总幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="success">{row.totalPaintCount?.toFixed(1)}</NTag> },
  { key: 'avgPaintPerOrder', title: '平均幅数/单', width: 110, align: 'center' as const }
];

const yearColumns = [
  { key: 'month', title: '月份', width: 70, align: 'center' as const, render: (row: any) => `${row.month}月` },
  { key: 'totalOrders', title: '工单数', width: 90, align: 'center' as const },
  { key: 'totalPaintCount', title: '总幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="info">{row.totalPaintCount?.toFixed(1)}</NTag> }
];

function getDailyStats(shopData: any) {
  return shopData?.dailyStats || [];
}

// ===== ECharts 图表 =====

// 1. 每日幅数趋势折线图
const { domRef: dailyChartRef, updateOptions: updateDailyChartOptions } = useEcharts(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: { data: [] as string[] },
  grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
  xAxis: { type: 'category', data: [] as string[] },
  yAxis: { type: 'value', name: '幅数' },
  series: [] as any[]
}));

function updateDailyChart() {
  if (!monthlyData.value.length) return;

  // 收集所有日期
  const allDates = new Set<string>();
  monthlyData.value.forEach(shop => {
    (shop.dailyStats || []).forEach((d: any) => allDates.add(d.date));
  });
  const dates = [...allDates].sort();

  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272'];
  const series = monthlyData.value.map((shop, idx) => ({
    name: shop.shopName,
    type: 'line' as const,
    smooth: true,
    color: colors[idx % colors.length],
    data: dates.map(date => {
      const stat = (shop.dailyStats || []).find((d: any) => d.date === date);
      return stat ? Number(stat.paintCount || 0).toFixed(1) : 0;
    })
  }));

  updateDailyChartOptions(opts => {
    opts.xAxis.data = dates;
    opts.legend.data = monthlyData.value.map(s => s.shopName);
    opts.series = series;
    return opts;
  });
}

// 2. 门店对比柱状图
const { domRef: shopComparisonChartRef, updateOptions: updateShopComparisonChartOptions } = useEcharts(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: { data: ['总幅数', '工单数'] },
  grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
  xAxis: { type: 'category', data: [] as string[] },
  yAxis: [
    { type: 'value', name: '幅数' },
    { type: 'value', name: '工单数' }
  ],
  series: [
    { name: '总幅数', type: 'bar', data: [] as number[], itemStyle: { color: '#5470c6' } },
    { name: '工单数', type: 'bar', yAxisIndex: 1, data: [] as number[], itemStyle: { color: '#91cc75' } }
  ]
}));

function updateShopComparisonChart() {
  if (!shopComparison.value.length) return;

  const shopNames = shopComparison.value.map(s => s.shopName);
  const paintCounts = shopComparison.value.map(s => Number(s.totalPaintCount || 0));
  const orderCounts = shopComparison.value.map(s => Number(s.totalOrders || 0));

  updateShopComparisonChartOptions(opts => {
    opts.xAxis.data = shopNames;
    opts.series[0].data = paintCounts;
    opts.series[1].data = orderCounts;
    return opts;
  });
}

// 3. 年度趋势折线图
const { domRef: yearTrendChartRef, updateOptions: updateYearTrendChartOptions } = useEcharts(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['总幅数', '工单数'] },
  grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
  xAxis: { type: 'category', data: [] as string[], name: '月份' },
  yAxis: [
    { type: 'value', name: '幅数' },
    { type: 'value', name: '工单数' }
  ],
  series: [
    { name: '总幅数', type: 'line', smooth: true, data: [] as number[], itemStyle: { color: '#5470c6' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(84,112,198,0.3)' }, { offset: 1, color: 'rgba(84,112,198,0.05)' }] } } },
    { name: '工单数', type: 'line', smooth: true, yAxisIndex: 1, data: [] as number[], itemStyle: { color: '#91cc75' } }
  ]
}));

function updateYearTrendChart() {
  if (!yearOverview.value.length) return;

  const months = yearOverview.value.map(d => `${d.month}月`);
  const paintCounts = yearOverview.value.map(d => Number(d.totalPaintCount || 0));
  const orderCounts = yearOverview.value.map(d => Number(d.totalOrders || 0));

  updateYearTrendChartOptions(opts => {
    opts.xAxis.data = months;
    opts.series[0].data = paintCounts;
    opts.series[1].data = orderCounts;
    return opts;
  });
}

// 4. 项目类别饼图
const { domRef: categoryChartRef, updateOptions: updateCategoryChartOptions } = useEcharts(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c}幅 ({d}%)' },
  legend: { orient: 'vertical', left: 'left', type: 'scroll' },
  series: [{
    type: 'pie',
    radius: ['40%', '70%'],
    avoidLabelOverlap: true,
    itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
    label: { show: true, formatter: '{b}\n{d}%' },
    data: [] as { name: string; value: number }[]
  }]
}));

function updateCategoryChart() {
  if (!categoryBreakdown.value.length) return;

  const pieData = categoryBreakdown.value.map(d => ({
    name: d.categoryName,
    value: Number(d.totalPaintCount || 0)
  })).filter(d => d.value > 0);

  updateCategoryChartOptions(opts => {
    opts.series[0].data = pieData;
    return opts;
  });
}

// ===== 导出 =====

const exporting = ref(false);

async function handleExportCsv() {
  if (!selectedSettlementMonth.value) {
    window.$message?.warning('请先选择结算月');
    return;
  }
  exporting.value = true;
  try {
    const { data, error } = await exportStatisticsCsv(selectedSettlementMonth.value, selectedShopId.value || undefined);
    if (error) return;
    if (data) {
      const blob = data instanceof Blob ? data : new Blob([data as any], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `幅数统计_${selectedSettlementMonth.value}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      window.$message?.success('CSV导出成功');
    }
  } finally {
    exporting.value = false;
  }
}

async function handleExportExcel() {
  if (!selectedSettlementMonth.value) {
    window.$message?.warning('请先选择结算月');
    return;
  }
  exporting.value = true;
  try {
    const { data, error } = await exportStatisticsExcel(selectedSettlementMonth.value, selectedShopId.value || undefined);
    if (error) return;
    if (data) {
      const blob = data instanceof Blob ? data : new Blob([data as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `幅数统计_${selectedSettlementMonth.value}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      window.$message?.success('Excel导出成功');
    }
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <NCard :bordered="false" size="small">
      <NSpace align="end" :wrap="true" :size="[16, 12]">
        <NSelect
          v-model:value="selectedShopId"
          placeholder="全部门店"
          :options="shops.map(s => ({ label: s.name, value: s.id }))"
          clearable
          style="width: 200px"
          @update:value="loadAllData"
        />
        <NDatePicker
          :formatted-value="selectedSettlementMonth || undefined"
          @update:formatted-value="(val: string | undefined) => { selectedSettlementMonth = val || null; loadAllData(); }"
          type="month"
          value-format="yyyy-MM"
          placeholder="选择结算月"
          clearable
          style="width: 160px"
        />
        <NButton type="primary" :loading="loading" @click="loadAllData">查询</NButton>
        <NButton type="info" :loading="exporting" @click="handleExportCsv">
          <template #icon><icon-ic-outline-file-download /></template>
          导出CSV
        </NButton>
        <NButton type="success" :loading="exporting" @click="handleExportExcel">
          <template #icon><icon-ic-outline-file-download /></template>
          导出Excel
        </NButton>
      </NSpace>
    </NCard>

    <NGrid :cols="4" :x-gap="16" :y-gap="16">
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="门店数量" :value="totalStats.shopCount">
            <template #prefix><icon-ic-outline-store /></template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="工单总数">
            <NNumberAnimation :value="totalStats.totalOrders" />
            <template #prefix><icon-ic-baseline-description /></template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="总喷漆幅数">
            <NNumberAnimation :value="totalStats.totalPaintCount" :precision="1" />
            <template #prefix><icon-ic-outline-format-paint /></template>
            <template #suffix>幅</template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="平均每单幅数" :value="totalStats.totalOrders > 0 ? +(totalStats.totalPaintCount / totalStats.totalOrders).toFixed(2) : 0" :precision="2">
            <template #prefix><icon-ic-outline-calculate /></template>
            <template #suffix>幅/单</template>
          </NStatistic>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 每日幅数趋势图 + 门店对比图 -->
    <NGrid :cols="2" :x-gap="16">
      <NGi>
        <NCard title="每日幅数趋势" :bordered="false" size="small">
          <div ref="dailyChartRef" class="h-360px overflow-hidden"></div>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="门店对比" :bordered="false" size="small">
          <div ref="shopComparisonChartRef" class="h-360px overflow-hidden"></div>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 年度趋势图 + 类别分布饼图 -->
    <NGrid :cols="2" :x-gap="16">
      <NGi>
        <NCard title="年度趋势 (按结算月)" :bordered="false" size="small">
          <div ref="yearTrendChartRef" class="h-360px overflow-hidden"></div>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="项目类别分布" :bordered="false" size="small">
          <div ref="categoryChartRef" class="h-360px overflow-hidden"></div>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 明细表格 -->
    <NGrid :cols="2" :x-gap="16">
      <NGi>
        <NCard title="结算月每日明细" :bordered="false" size="small" class="h-full">
          <template v-for="shop in monthlyData" :key="shop.shopId">
            <NH3 prefix="bar" class="mb-8px mt-16px">{{ shop.shopName }} ({{ shop.shopCode }})</NH3>
            <NDataTable
              :columns="dailyColumns"
              :data="getDailyStats(shop)"
              size="small"
              :bordered="true"
              :max-height="300"
              :scroll-x="320"
            />
          </template>
          <NEmpty v-if="!monthlyData.length && !loading" description="暂无数据" />
        </NCard>
      </NGi>

      <NGi>
        <NCard title="门店对比明细" :bordered="false" size="small" class="h-full">
          <NDataTable
            :columns="comparisonColumns"
            :data="shopComparison"
            size="small"
            :bordered="true"
            :max-height="400"
            :scroll-x="500"
          />
          <NEmpty v-if="!shopComparison.length && !loading" description="暂无数据" />
        </NCard>
      </NGi>
    </NGrid>

    <NGrid :cols="2" :x-gap="16">
      <NGi>
        <NCard title="年度趋势明细" :bordered="false" size="small" class="h-full">
          <NDataTable
            :columns="yearColumns"
            :data="yearOverview"
            size="small"
            :bordered="true"
            :max-height="400"
            :scroll-x="280"
          />
          <NEmpty v-if="!yearOverview.length && !loading" description="暂无数据" />
        </NCard>
      </NGi>

      <NGi>
        <NCard title="项目类别明细" :bordered="false" size="small" class="h-full">
          <NDataTable
            :columns="categoryColumns"
            :data="categoryBreakdown"
            size="small"
            :bordered="true"
            :max-height="400"
            :scroll-x="350"
          />
          <NEmpty v-if="!categoryBreakdown.length && !loading" description="暂无数据" />
        </NCard>
      </NGi>
    </NGrid>
  </div>
</template>

<style scoped></style>
