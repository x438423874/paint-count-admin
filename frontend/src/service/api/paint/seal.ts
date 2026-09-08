import { request } from '../../request';
import type { SealOverviewResult, SettlementMonthRecord } from './types';

// ==================== 封单管理 API ====================

export function sealSettlementMonth(shopId: string, month: string) {
  return request<SettlementMonthRecord>({
    url: '/paint/seal/seal',
    method: 'post',
    data: { shopId, month }
  });
}

export function unsealSettlementMonth(shopId: string, month: string) {
  return request<SettlementMonthRecord>({
    url: '/paint/seal/unseal',
    method: 'post',
    data: { shopId, month }
  });
}

export function getSealStatus(shopId: string, month: string) {
  return request<SettlementMonthRecord | null>({
    url: '/paint/seal/status',
    method: 'get',
    params: { shopId, month }
  });
}

// ==================== 封单管理总览 ====================

export function fetchSealOverview(params: { shopId?: string; month?: string; current?: number; size?: number }) {
  return request<SealOverviewResult>({
    url: '/paint/seal/overview',
    method: 'get',
    params
  });
}
