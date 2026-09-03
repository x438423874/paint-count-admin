<script setup lang="tsx">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { NCard, NGrid, NGi, NStatistic, NSelect, NSpace, NTag, NDataTable, NH3, NNumberAnimation, NDatePicker, NButton, NEmpty } from 'naive-ui';
import { fetchStatisticsDashboard, fetchPaintShopList, fetchLatestSettlementMonth, exportStatisticsCsv, exportStatisticsExcel, exportStatisticsPdf } from '@/service/api';
import { useEcharts } from '@/hooks/common/echarts';
import { getChartPalette, primaryGradient } from '@/utils/chart';

const palette = getChartPalette();

const shops = ref<{ id: string; name: string; code: string }[]>([]);
const selectedShopId = ref<string | null>(null);
const selectedSettlementMonth = ref<string | null>(null);

const monthlyData = ref<any[]>([]);
const shopComparison = ref<any[]>([]);
const yearOverview = ref<any[]>([]);
const categoryBreakdown = ref<any[]>([]);
const overview = ref<any>(null);
const loading = ref(false);

onMounted(async () => {
  await loadShops();
  const { data: latestMonth } = await fetchLatestSettlementMonth();
  selectedSettlementMonth.value = latestMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
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
    if (selectedSettlementMonth.value) {
      params.settlementMonth = selectedSettlementMonth.value;
      params.year = parseInt(selectedSettlementMonth.value.split('-')[0], 10);
    }
    if (selectedShopId.value) params.shopId = selectedShopId.value;

    // 单次请求拿齐全部统计：原先是 5 个并发请求，
    // 且 comparison / overview 在服务端还会各自再跑一遍完整月度聚合
    const { data, error } = await fetchStatisticsDashboard(params);

    monthlyData.value = !error && data ? data.monthly || [] : [];
    shopComparison.value = !error && data ? data.comparison || [] : [];
    yearOverview.value = !error && data ? data.yearOverview || [] : [];
    categoryBreakdown.value = !error && data ? data.category || [] : [];
    overview.value = !error && data ? data.overview || null : null;

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
  const totalOrders = monthlyData.value.reduce((s, d) => s + Number(d.totalOrders || 0), 0);
  const totalPaintCount = monthlyData.value.reduce((s, d) => s + Number(d.totalPaintCount || 0), 0);
  const totalVehicles = monthlyData.value.reduce((s, d) => s + Number(d.totalVehicles || 0), 0);
  const pendingOrders = monthlyData.value.reduce((s, d) => s + Number(d.pendingOrders || 0), 0);
  const pendingPaintCount = monthlyData.value.reduce((s, d) => s + Number(d.pendingPaintCount || 0), 0);
  const pendingVehicles = monthlyData.value.reduce((s, d) => s + Number(d.pendingVehicles || 0), 0);
  const auditedOrders = monthlyData.value.reduce((s, d) => s + Number(d.auditedOrders || 0), 0);
  const auditedPaintCount = monthlyData.value.reduce((s, d) => s + Number(d.auditedPaintCount || 0), 0);
  const auditedVehicles = monthlyData.value.reduce((s, d) => s + Number(d.auditedVehicles || 0), 0);
  const reworkOrders = monthlyData.value.reduce((s, d) => s + Number(d.reworkOrders || 0), 0);
  const reworkPaintCount = monthlyData.value.reduce((s, d) => s + Number(d.reworkPaintCount || 0), 0);
  const reworkVehicles = monthlyData.value.reduce((s, d) => s + Number(d.reworkVehicles || 0), 0);
  const local = {
    totalOrders,
    totalPaintCount,
    totalVehicles,
    shopCount: monthlyData.value.length,
    avgPaintPerVehicle: totalVehicles > 0 ? +(totalPaintCount / totalVehicles).toFixed(2) : 0,
    avgPaintPerOrder: totalOrders > 0 ? +(totalPaintCount / totalOrders).toFixed(2) : 0,
    pendingOrders,
    pendingPaintCount,
    pendingVehicles,
    auditedOrders,
    auditedPaintCount,
    auditedVehicles,
    reworkOrders,
    reworkPaintCount,
    reworkVehicles
  };
  // 服务端 overview 已提供派生指标（审核率、结算率等），避免前端再算一遍
  return overview.value ? { ...local, ...overview.value } : local;
});

// 调试：方便在浏览器控制台核对原始数据
watch(
  () => monthlyData.value,
  val => {
    console.log('[statistics] monthlyData', JSON.parse(JSON.stringify(val)));
    console.log('[statistics] totalStats', JSON.parse(JSON.stringify(totalStats.value)));
  },
  { deep: true }
);

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
  { key: 'totalVehicles', title: '车辆数', width: 90, align: 'center' as const },
  { key: 'totalPaintCount', title: '总幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="success">{row.totalPaintCount?.toFixed(1)}</NTag> },
  { key: 'pendingOrders', title: '待审核工单', width: 100, align: 'center' as const, render: (row: any) => <NTag type="warning">{row.pendingOrders || 0}</NTag> },
  { key: 'pendingVehicles', title: '待审核车牌', width: 100, align: 'center' as const },
  { key: 'pendingPaintCount', title: '待审核幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="warning">{(row.pendingPaintCount || 0).toFixed(1)}</NTag> },
  { key: 'auditedOrders', title: '已审核工单', width: 100, align: 'center' as const, render: (row: any) => <NTag type="success">{row.auditedOrders || 0}</NTag> },
  { key: 'auditedVehicles', title: '已审核车牌', width: 100, align: 'center' as const },
  { key: 'auditedPaintCount', title: '已审核幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="success">{(row.auditedPaintCount || 0).toFixed(1)}</NTag> },
  { key: 'reworkOrders', title: '返工工单', width: 100, align: 'center' as const, render: (row: any) => <NTag type="error">{row.reworkOrders || 0}</NTag> },
  { key: 'reworkVehicles', title: '返工车牌', width: 100, align: 'center' as const },
  { key: 'reworkPaintCount', title: '返工幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="error">{(row.reworkPaintCount || 0).toFixed(1)}</NTag> },
  { key: 'avgPaintPerVehicle', title: '台均幅数', width: 100, align: 'center' as const },
  { key: 'avgPaintPerOrder', title: '单均幅数', width: 100, align: 'center' as const }
];

const yearColumns = [
  { key: 'month', title: '月份', width: 70, align: 'center' as const, render: (row: any) => `${row.month}月` },
  { key: 'totalOrders', title: '工单数', width: 90, align: 'center' as const },
  { key: 'totalPaintCount', title: '总幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="info">{row.totalPaintCount?.toFixed(1)}</NTag> },
  { key: 'pendingOrders', title: '待审核工单', width: 100, align: 'center' as const, render: (row: any) => <NTag type="warning">{row.pendingOrders || 0}</NTag> },
  { key: 'pendingVehicles', title: '待审核车牌', width: 100, align: 'center' as const },
  { key: 'pendingPaintCount', title: '待审核幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="warning">{(row.pendingPaintCount || 0).toFixed(1)}</NTag> },
  { key: 'auditedOrders', title: '已审核工单', width: 100, align: 'center' as const, render: (row: any) => <NTag type="success">{row.auditedOrders || 0}</NTag> },
  { key: 'auditedVehicles', title: '已审核车牌', width: 100, align: 'center' as const },
  { key: 'auditedPaintCount', title: '已审核幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="success">{(row.auditedPaintCount || 0).toFixed(1)}</NTag> },
  { key: 'reworkOrders', title: '返工工单', width: 100, align: 'center' as const, render: (row: any) => <NTag type="error">{row.reworkOrders || 0}</NTag> },
  { key: 'reworkVehicles', title: '返工车牌', width: 100, align: 'center' as const },
  { key: 'reworkPaintCount', title: '返工幅数', width: 100, align: 'center' as const, render: (row: any) => <NTag type="error">{(row.reworkPaintCount || 0).toFixed(1)}</NTag> }
];

function getDailyStats(shopData: any) {
  return shopData?.dailyStats || [];
}

// ===== ECharts 图表 =====

// 1. 每日幅数趋势折线图
const { domRef: dailyChartRef, updateOptions: updateDailyChartOptions } = useEcharts(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'cross' },
    valueFormatter: (val: any) => `${Number(val).toFixed(1)} 幅`
  },
  legend: { data: [] as string[], top: 5 },
  grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
  toolbox: {
    show: true,
    right: 10,
    feature: {
      dataZoom: { yAxisIndex: 'none' },
      saveAsImage: { name: '每日幅数趋势' }
    }
  },
  dataZoom: [
    { type: 'inside', start: 0, end: 100 },
    { type: 'slider', height: 18, bottom: 8, start: 0, end: 100 }
  ],
  xAxis: { type: 'category', boundaryGap: false, data: [] as string[] },
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

  const palette = getChartPalette();
  const colors = palette.series;
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
const { domRef: shopComparisonChartRef, updateOptions: updateShopComparisonChartOptions } = useEcharts(() => {
  const palette = getChartPalette();

  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['总幅数', '工单数', '车辆数'], top: 5 },
    grid: { left: '3%', right: '4%', bottom: '8%', containLabel: true },
    toolbox: {
      show: true,
      right: 10,
      feature: { saveAsImage: { name: '门店对比' } }
    },
    xAxis: { type: 'category', data: [] as string[], axisLabel: { interval: 0, rotate: 0 } },
    yAxis: [
      { type: 'value', name: '幅数' },
      { type: 'value', name: '数量' }
    ],
    series: [
      { name: '总幅数', type: 'bar', data: [] as number[], itemStyle: { color: palette.series[0] }, label: { show: true, position: 'top', formatter: '{c}' } },
      { name: '工单数', type: 'bar', yAxisIndex: 1, data: [] as number[], itemStyle: { color: palette.series[2] } },
      { name: '车辆数', type: 'bar', yAxisIndex: 1, data: [] as number[], itemStyle: { color: palette.series[3] } }
    ]
  };
});

function updateShopComparisonChart() {
  if (!shopComparison.value.length) return;

  const shopNames = shopComparison.value.map(s => s.shopName);
  const paintCounts = shopComparison.value.map(s => Number(s.totalPaintCount || 0));
  const orderCounts = shopComparison.value.map(s => Number(s.totalOrders || 0));
  const vehicleCounts = shopComparison.value.map(s => Number(s.totalVehicles || 0));

  updateShopComparisonChartOptions(opts => {
    opts.xAxis.data = shopNames;
    opts.series[0].data = paintCounts;
    opts.series[1].data = orderCounts;
    opts.series[2].data = vehicleCounts;
    return opts;
  });
}

// 3. 年度趋势折线图
const { domRef: yearTrendChartRef, updateOptions: updateYearTrendChartOptions } = useEcharts(() => {
  const palette = getChartPalette();

  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['总幅数', '工单数', '待审核幅数', '已审核幅数'], top: 5 },
    grid: { left: '3%', right: '4%', bottom: '8%', containLabel: true },
    toolbox: {
      show: true,
      right: 10,
      feature: { saveAsImage: { name: '年度趋势' } }
    },
    xAxis: { type: 'category', data: [] as string[], name: '月份' },
    yAxis: [
      { type: 'value', name: '幅数' },
      { type: 'value', name: '工单数' }
    ],
    series: [
      { name: '总幅数', type: 'line', smooth: true, data: [] as number[], itemStyle: { color: palette.primary }, areaStyle: primaryGradient(0.3, 0.05) },
      { name: '工单数', type: 'line', smooth: true, yAxisIndex: 1, data: [] as number[], itemStyle: { color: palette.series[1] } },
      { name: '待审核幅数', type: 'bar', stack: 'audit', data: [] as number[], itemStyle: { color: palette.series[3] }, barWidth: 16 },
      { name: '已审核幅数', type: 'bar', stack: 'audit', data: [] as number[], itemStyle: { color: palette.series[2] }, barWidth: 16 }
    ]
  };
});

function updateYearTrendChart() {
  if (!yearOverview.value.length) return;

  const months = yearOverview.value.map(d => `${d.month}月`);
  const paintCounts = yearOverview.value.map(d => Number(d.totalPaintCount || 0));
  const orderCounts = yearOverview.value.map(d => Number(d.totalOrders || 0));
  const pendingPaintCounts = yearOverview.value.map(d => Number(d.pendingPaintCount || 0));
  const auditedPaintCounts = yearOverview.value.map(d => Number(d.auditedPaintCount || 0));

  updateYearTrendChartOptions(opts => {
    opts.xAxis.data = months;
    opts.series[0].data = paintCounts;
    opts.series[1].data = orderCounts;
    opts.series[2].data = pendingPaintCounts;
    opts.series[3].data = auditedPaintCounts;
    return opts;
  });
}

// 4. 项目类别饼图
const { domRef: categoryChartRef, updateOptions: updateCategoryChartOptions } = useEcharts(() => {
  const palette = getChartPalette();

  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c}幅 ({d}%)' },
    legend: { orient: 'vertical', left: 'left', type: 'scroll', top: 20 },
    toolbox: {
      show: true,
      right: 10,
      feature: { saveAsImage: { name: '项目类别分布' } }
    },
    series: [{
      type: 'pie',
      color: palette.series,
      radius: ['40%', '70%'],
      center: ['60%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 8, borderColor: palette.border, borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{d}%' },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold' },
        itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' }
      },
      data: [] as { name: string; value: number }[]
    }]
  };
});

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

async function handleExportPdf() {
  if (!selectedSettlementMonth.value) {
    window.$message?.warning('请先选择结算月');
    return;
  }
  exporting.value = true;
  try {
    const { data, error } = await exportStatisticsPdf(selectedSettlementMonth.value, selectedShopId.value || undefined);
    if (error) return;
    if (data) {
      const blob = data instanceof Blob ? data : new Blob([data as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `幅数统计_${selectedSettlementMonth.value}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      window.$message?.success('PDF导出成功');
    }
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-auto">
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
        <NButton type="warning" :loading="exporting" @click="handleExportPdf">
          <template #icon><icon-ic-outline-picture-as-pdf /></template>
          导出PDF
        </NButton>
      </NSpace>
    </NCard>

    <NGrid :cols="6" :x-gap="16" :y-gap="16">
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="门店数量" :value="totalStats.shopCount">
            <template #prefix><icon-ic-outline-store /></template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="车辆总数" :value="totalStats.totalVehicles">
            <template #prefix><icon-ic-outline-directions-car /></template>
            <template #suffix>台</template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="工单总数" :value="totalStats.totalOrders">
            <template #prefix><icon-ic-baseline-description /></template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="总喷漆幅数" :value="totalStats.totalPaintCount" :precision="1">
            <template #prefix><icon-ic-outline-format-paint /></template>
            <template #suffix>幅</template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="台均幅数" :value="totalStats.avgPaintPerVehicle" :precision="2">
            <template #prefix><icon-ic-outline-calculate /></template>
            <template #suffix>幅/台</template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small">
          <NStatistic label="单均幅数" :value="totalStats.avgPaintPerOrder" :precision="2">
            <template #prefix><icon-ic-outline-calculate /></template>
            <template #suffix>幅/单</template>
          </NStatistic>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 返工统计 -->
    <NGrid :cols="3" :x-gap="16" :y-gap="16">
      <NGi>
        <NCard :bordered="true" size="small" :style="{ borderLeft: '3px solid ' + palette.error }">
          <NStatistic label="返工工单数" :value="totalStats.reworkOrders">
            <template #prefix><icon-ic-round-warning /></template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small" :style="{ borderLeft: '3px solid ' + palette.error }">
          <NStatistic label="返工车辆数" :value="totalStats.reworkVehicles">
            <template #prefix><icon-ic-outline-directions-car /></template>
            <template #suffix>台</template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard :bordered="true" size="small" :style="{ borderLeft: '3px solid ' + palette.error }">
          <NStatistic label="返工幅数" :value="totalStats.reworkPaintCount" :precision="1">
            <template #prefix><icon-ic-outline-format-paint /></template>
            <template #suffix>幅</template>
          </NStatistic>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 待审核/已审核统计 -->
    <NGrid :cols="2" :x-gap="16">
      <NGi>
        <NCard title="待审核" :bordered="true" size="small" :style="{ borderLeft: `3px solid ${palette.series[3]}` }">
          <NGrid :cols="3" :x-gap="12">
            <NGi>
              <NStatistic label="工单数">
                <NNumberAnimation :value="totalStats.pendingOrders" />
              </NStatistic>
            </NGi>
            <NGi>
              <NStatistic label="车牌数">
                <NNumberAnimation :value="totalStats.pendingVehicles" />
                <template #suffix>台</template>
              </NStatistic>
            </NGi>
            <NGi>
              <NStatistic label="幅数">
                <NNumberAnimation :value="totalStats.pendingPaintCount" :precision="1" />
                <template #suffix>幅</template>
              </NStatistic>
            </NGi>
          </NGrid>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="已审核" :bordered="true" size="small" :style="{ borderLeft: `3px solid ${palette.series[2]}` }">
          <NGrid :cols="3" :x-gap="12">
            <NGi>
              <NStatistic label="工单数">
                <NNumberAnimation :value="totalStats.auditedOrders" />
              </NStatistic>
            </NGi>
            <NGi>
              <NStatistic label="车牌数">
                <NNumberAnimation :value="totalStats.auditedVehicles" />
                <template #suffix>台</template>
              </NStatistic>
            </NGi>
            <NGi>
              <NStatistic label="幅数">
                <NNumberAnimation :value="totalStats.auditedPaintCount" :precision="1" />
                <template #suffix>幅</template>
              </NStatistic>
            </NGi>
          </NGrid>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 异常 / 结算 / 审核率统计 -->
    <NGrid v-if="overview" :cols="4" :x-gap="16">
      <NGi>
        <NCard title="异常工单" :bordered="true" size="small" :style="{ borderLeft: '3px solid ' + palette.error }">
          <NGrid :cols="2" :x-gap="12">
            <NGi>
              <NStatistic label="工单数">
                <NNumberAnimation :value="overview.abnormalOrders" />
              </NStatistic>
            </NGi>
            <NGi>
              <NStatistic label="幅数">
                <NNumberAnimation :value="overview.abnormalPaintCount" :precision="1" />
                <template #suffix>幅</template>
              </NStatistic>
            </NGi>
          </NGrid>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="已结算" :bordered="true" size="small" :style="{ borderLeft: '3px solid ' + palette.info }">
          <NGrid :cols="2" :x-gap="12">
            <NGi>
              <NStatistic label="工单数">
                <NNumberAnimation :value="overview.settledOrders" />
              </NStatistic>
            </NGi>
            <NGi>
              <NStatistic label="幅数">
                <NNumberAnimation :value="overview.settledPaintCount" :precision="1" />
                <template #suffix>幅</template>
              </NStatistic>
            </NGi>
          </NGrid>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="审核率" :bordered="true" size="small" :style="{ borderLeft: `3px solid ${palette.series[2]}` }">
          <NStatistic label="已审占比">
            <NNumberAnimation :value="overview.auditRate" :precision="1" />
            <template #suffix>%</template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="结算率" :bordered="true" size="small" :style="{ borderLeft: '3px solid ' + palette.info }">
          <NStatistic label="已结占比">
            <NNumberAnimation :value="overview.settlementRate" :precision="1" />
            <template #suffix>%</template>
          </NStatistic>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 每日幅数趋势图 + 门店对比图 -->
    <NGrid :cols="2" :x-gap="16">
      <NGi>
        <NCard title="每日幅数趋势" :bordered="false" size="small" class="brand-card">
          <div ref="dailyChartRef" class="h-360px overflow-hidden"></div>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="门店对比" :bordered="false" size="small" class="brand-card">
          <div ref="shopComparisonChartRef" class="h-360px overflow-hidden"></div>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 年度趋势图 + 类别分布饼图 -->
    <NGrid :cols="2" :x-gap="16">
      <NGi>
        <NCard title="年度趋势 (按结算月)" :bordered="false" size="small" class="brand-card">
          <div ref="yearTrendChartRef" class="h-360px overflow-hidden"></div>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="项目类别分布" :bordered="false" size="small" class="brand-card">
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
            :scroll-x="1300"
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
            :scroll-x="900"
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

<style scoped>
.brand-card {
  box-shadow: var(--brand-shadow-1);
  transition: box-shadow 0.2s;
}

.brand-card:hover {
  box-shadow: var(--brand-shadow-2);
}
</style>
