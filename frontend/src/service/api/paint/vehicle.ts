import { request } from '../../request';
import type { PaintVehicle, VehicleHistorySummary } from './types';

// ==================== 车辆/客户主数据 API ====================

export function fetchPaintVehiclePage(params: {
  current?: number;
  size?: number;
  plateNumber?: string;
  customerName?: string;
  phone?: string;
  vin?: string;
  shopId?: string;
}) {
  return request<Api.Common.PaginatingQueryRecord<PaintVehicle>>({
    url: '/paint/vehicle/page',
    method: 'get',
    params
  });
}

export function fetchVehicleList(keyword?: string) {
  return request<Partial<PaintVehicle>[]>({
    url: '/paint/vehicle/list',
    method: 'get',
    params: { keyword }
  });
}

export function fetchVehicleByPlate(plateNumber: string) {
  return request<PaintVehicle | null>({
    url: `/paint/vehicle/by-plate/${encodeURIComponent(plateNumber)}`,
    method: 'get'
  });
}

export function fetchVehicleById(id: string) {
  return request<PaintVehicle>({
    url: `/paint/vehicle/${id}`,
    method: 'get'
  });
}

export function createPaintVehicle(data: {
  plateNumber: string;
  vin?: string;
  carModel?: string;
  brand?: string;
  customerName?: string;
  phone?: string;
  contactPerson?: string;
  remark?: string;
}) {
  return request<PaintVehicle>({
    url: '/paint/vehicle',
    method: 'post',
    data
  });
}

export function updatePaintVehicle(data: {
  id: string;
  plateNumber?: string;
  vin?: string;
  carModel?: string;
  brand?: string;
  customerName?: string;
  phone?: string;
  contactPerson?: string;
  remark?: string;
}) {
  return request<PaintVehicle & { syncedOrderCount?: number }>({
    url: '/paint/vehicle',
    method: 'put',
    data
  });
}

export function deletePaintVehicle(id: string) {
  return request({
    url: `/paint/vehicle/${id}`,
    method: 'delete'
  });
}

export function fetchVehicleHistory(
  id: string,
  params: {
    scope?: 'current_shop' | 'all_shops';
    shopId?: string;
    current?: number;
    size?: number;
  }
) {
  return request<{ records: any[]; total: number; summary: VehicleHistorySummary }>({
    url: `/paint/vehicle/${id}/history-orders`,
    method: 'get',
    params
  });
}
