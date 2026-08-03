import { useThemeStore } from '@/store/modules/theme';
import { addColorAlpha, getPaletteColorByNumber } from '@sa/color';

export interface ChartPalette {
  /** 品牌主色 */
  primary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** 多系列分类色板：品牌主色打头，语义色次之，末尾为文档化的装饰强调色 */
  series: string[];
  /** 坐标轴文字/轴线 */
  axis: string;
  /** 网格分割线 */
  splitLine: string;
  /** 饼图扇区描边 */
  border: string;
  /** 通用文字 */
  text: string;
}

/**
 * 读取品牌设计令牌，生成 ECharts 统一色板。
 *
 * 所有颜色均来源于主题令牌（settings.ts 的 themeColor / otherColor），
 * 因此「改色只改一处」：调整主色后，所有图表会自动同步。
 * 该函数在图表工厂函数内调用，随暗色模式切换重新求值。
 */
export function getChartPalette(): ChartPalette {
  const themeStore = useThemeStore();
  const { primary, info, success, warning, error } = themeStore.themeColors;
  const dark = themeStore.darkMode;

  const series = [
    primary,
    info,
    success,
    warning,
    error,
    getPaletteColorByNumber(primary, 300),
    '#38bdf8', // 品牌青蓝（装饰强调色，见 DESIGN_TOKENS.md）
    '#a78bfa', // 紫（装饰强调色）
    '#fb7185' // 玫红（装饰强调色）
  ];

  return {
    primary,
    success,
    warning,
    error,
    info,
    series,
    axis: dark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)',
    splitLine: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    border: dark ? '#1f1f1f' : '#ffffff',
    text: dark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.85)'
  };
}

/**
 * 用品牌主色生成纵向渐变（areaStyle / 柱状渐变）
 *
 * @param topAlpha 顶部透明度
 * @param bottomAlpha 底部透明度
 */
export function primaryGradient(topAlpha = 0.4, bottomAlpha = 0.05) {
  const { primary } = getChartPalette();

  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: addColorAlpha(primary, topAlpha) },
      { offset: 1, color: addColorAlpha(primary, bottomAlpha) }
    ]
  };
}
