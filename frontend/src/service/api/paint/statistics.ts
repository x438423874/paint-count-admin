import { request } from '../../request';
import type {
  CategoryBreakdown,
  MonthlyStat,
  ShopComparison,
  StatisticsDashboard,
  StatisticsOverview,
  YearOverview
} from './types';

// ==================== 统计 API ====================

export function fetchLatestSettlementMonth() {
  return request<string | null>({
    url: '/paint/statistics/latest-month',
    method: 'get'
  });
}

export function fetchMonthlyStatistics(params?: { settlementMonth?: string; shopId?: string }) {
  return request<MonthlyStat[]>({
    url: '/paint/statistics/monthly',
    method: 'get',
    params
  });
}

export function fetchCategoryBreakdown(params?: { settlementMonth?: string; shopId?: string }) {
  return request<CategoryBreakdown[]>({
    url: '/paint/statistics/category',
    method: 'get',
    params
  });
}

export function fetchShopComparison(params?: { settlementMonth?: string }) {
  return request<ShopComparison[]>({
    url: '/paint/statistics/comparison',
    method: 'get',
    params
  });
}

export function fetchYearOverview(params?: { year?: number; shopId?: string }) {
  return request<YearOverview[]>({
    url: '/paint/statistics/year-overview',
    method: 'get',
    params
  });
}

export function fetchStatisticsOverview(params?: { settlementMonth?: string; shopId?: string }) {
  return request<StatisticsOverview>({
    url: '/paint/statistics/overview',
    method: 'get',
    params
  });
}

export function fetchStatisticsDashboard(params?: { settlementMonth?: string; shopId?: string; year?: number }) {
  return request<StatisticsDashboard>({
    url: '/paint/statistics/dashboard',
    method: 'get',
    params
  });
}

// ==================== 导出 ====================

export function exportStatisticsCsv(settlementMonth: string, shopId?: string) {
  return request({
    url: '/paint/statistics/export/csv',
    method: 'get',
    params: { settlementMonth, ...(shopId && { shopId }) },
    responseType: 'blob'
  });
}

export function exportStatisticsExcel(settlementMonth: string, shopId?: string) {
  return request({
    url: '/paint/statistics/export/excel',
    method: 'get',
    params: { settlementMonth, ...(shopId && { shopId }) },
    responseType: 'blob'
  });
}

export function exportStatisticsPdf(settlementMonth: string, shopId?: string) {
  return request({
    url: '/paint/statistics/export/pdf',
    method: 'get',
    params: { settlementMonth, ...(shopId && { shopId }) },
    responseType: 'blob'
  });
}
