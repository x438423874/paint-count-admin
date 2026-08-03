<script setup lang="ts">
import { watch } from 'vue';
import { useAppStore } from '@/store/modules/app';
import { useEcharts } from '@/hooks/common/echarts';
import { $t } from '@/locales';
import { getChartPalette } from '@/utils/chart';
import { addColorAlpha } from '@sa/color';

defineOptions({
  name: 'LineChart'
});

const appStore = useAppStore();

const { domRef, updateOptions } = useEcharts(() => {
  const palette = getChartPalette();
  const cyan = palette.series[6];

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: palette.axis
        }
      }
    },
    legend: {
      data: [$t('page.home.downloadCount'), $t('page.home.registerCount')]
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: [] as string[],
      axisLabel: { color: palette.axis },
      axisLine: { lineStyle: { color: palette.axis } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: palette.axis },
      splitLine: { lineStyle: { color: palette.splitLine } }
    },
    series: [
      {
        color: palette.primary,
        name: $t('page.home.downloadCount'),
        type: 'line',
        smooth: true,
        stack: 'Total',
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              {
                offset: 0.25,
                color: addColorAlpha(palette.primary, 0.45)
              },
              {
                offset: 1,
                color: addColorAlpha(palette.primary, 0.05)
              }
            ]
          }
        },
        emphasis: {
          focus: 'series'
        },
        data: [] as number[]
      },
      {
        color: cyan,
        name: $t('page.home.registerCount'),
        type: 'line',
        smooth: true,
        stack: 'Total',
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              {
                offset: 0.25,
                color: addColorAlpha(cyan, 0.45)
              },
              {
                offset: 1,
                color: addColorAlpha(cyan, 0.05)
              }
            ]
          }
        },
        emphasis: {
          focus: 'series'
        },
        data: []
      }
    ]
  };
});

async function mockData() {
  await new Promise(resolve => {
    setTimeout(resolve, 1000);
  });

  updateOptions(opts => {
    opts.xAxis.data = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '24:00'];
    opts.series[0].data = [4623, 6145, 6268, 6411, 1890, 4251, 2978, 3880, 3606, 4311];
    opts.series[1].data = [2208, 2016, 2916, 4512, 8281, 2008, 1963, 2367, 2956, 678];

    return opts;
  });
}

function updateLocale() {
  updateOptions((opts, factory) => {
    const originOpts = factory();

    opts.legend.data = originOpts.legend.data;
    opts.series[0].name = originOpts.series[0].name;
    opts.series[1].name = originOpts.series[1].name;

    return opts;
  });
}

async function init() {
  mockData();
}

watch(
  () => appStore.locale,
  () => {
    updateLocale();
  }
);

// init
init();
</script>

<template>
  <NCard :bordered="false" class="card-wrapper">
    <div ref="domRef" class="h-360px overflow-hidden"></div>
  </NCard>
</template>

<style scoped></style>
