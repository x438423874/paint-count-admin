import { request } from '../request';

export function fetchPaintShopList() {
  return request<{ id: string; name: string; code: string; brand: string }[]>({
    url: '/paint/shop/list',
    method: 'get'
  });
}

export function fetchPaintShopPage(params?: { current?: number; size?: number; name?: string; brand?: string }) {
  return request<any>({
    url: '/paint/shop/page',
    method: 'get',
    params
  });
}

export function fetchPaintShopById(id: string) {
  return request<any>({
    url: `/paint/shop/${id}`,
    method: 'get'
  });
}

export function createPaintShop(data: { name: string; code: string; brand: string; address?: string; phone?: string; standardTemplateId?: string }) {
  return request({
    url: '/paint/shop',
    method: 'post',
    data
  });
}

export function updatePaintShop(data: { id: string; name: string; brand: string; address?: string; phone?: string; standardTemplateId?: string }) {
  return request({
    url: '/paint/shop',
    method: 'put',
    data
  });
}

export function deletePaintShop(id: string) {
  return request({
    url: `/paint/shop/${id}`,
    method: 'delete'
  });
}

export function fetchWorkOrderPage(params?: {
  current?: number;
  size?: number;
  shopId?: string;
  plateNumber?: string;
  customerName?: string;
  settlementMonth?: string;
  status?: string;
}) {
  return request<any>({
    url: '/paint/work-order/page',
    method: 'get',
    params
  });
}

export function fetchWorkOrderById(id: string) {
  return request<any>({
    url: `/paint/work-order/${id}`,
    method: 'get'
  });
}

export function createWorkOrder(data: any) {
  return request({
    url: '/paint/work-order',
    method: 'post',
    data
  });
}

export function quickCreateWorkOrder(shopId: string, formData: FormData) {
  return request({
    url: '/paint/work-order/quick-create',
    method: 'post',
    data: formData
  });
}

export function updateWorkOrder(data: any) {
  return request({
    url: '/paint/work-order',
    method: 'put',
    data
  });
}

export function deleteWorkOrder(id: string) {
  return request({
    url: `/paint/work-order/${id}`,
    method: 'delete'
  });
}

export function addWorkOrderItems(orderId: string, items: { categoryId: string; quantity?: number }[]) {
  return request({
    url: `/paint/work-order/${orderId}/items`,
    method: 'post',
    data: items
  });
}

export function removeWorkOrderItem(orderId: string, itemId: string) {
  return request({
    url: `/paint/work-order/${orderId}/items/${itemId}`,
    method: 'delete'
  });
}

export function uploadWorkOrderImage(orderId: string, formData: FormData) {
  return request({
    url: `/paint/work-order/${orderId}/images`,
    method: 'post',
    data: formData
  });
}

export function removeWorkOrderImage(imageId: string) {
  return request({
    url: `/paint/work-order/images/${imageId}`,
    method: 'delete'
  });
}

export function fetchMonthlyStatistics(params?: { settlementMonth?: string; shopId?: string }) {
  return request<any[]>({
    url: '/paint/statistics/monthly',
    method: 'get',
    params
  });
}

export function fetchCategoryBreakdown(params?: { settlementMonth?: string; shopId?: string }) {
  return request<any[]>({
    url: '/paint/statistics/category',
    method: 'get',
    params
  });
}

export function fetchShopComparison(params?: { settlementMonth?: string }) {
  return request<any[]>({
    url: '/paint/statistics/comparison',
    method: 'get',
    params
  });
}

export function fetchYearOverview(params?: { year?: number; shopId?: string }) {
  return request<any[]>({
    url: '/paint/statistics/year-overview',
    method: 'get',
    params
  });
}

export function fetchPaintCategoryList() {
  return request<any[]>({
    url: '/paint/standard-template/categories',
    method: 'get'
  });
}

export function fetchShopStandards(shopId: string) {
  return request<any[]>({
    url: `/paint/standard/shop/${shopId}`,
    method: 'get'
  });
}

export function fetchShopCategoriesWithStandard(shopId: string) {
  return request<any[]>({
    url: `/paint/standard/shop/${shopId}/categories`,
    method: 'get'
  });
}

export function setShopStandards(shopId: string, standards: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string }[]) {
  return request({
    url: `/paint/standard/shop/${shopId}`,
    method: 'post',
    data: { standards }
  });
}

export function updatePaintStandard(id: string, coefficient: number) {
  return request({
    url: `/paint/standard/${id}`,
    method: 'put',
    data: { coefficient }
  });
}

export function deletePaintStandard(id: string) {
  return request({
    url: `/paint/standard/${id}`,
    method: 'delete'
  });
}

// ==================== 标准模板 ====================

export function fetchStandardTemplateList() {
  return request<any[]>({
    url: '/paint/standard-template/list',
    method: 'get'
  });
}

export function fetchStandardTemplateById(id: string) {
  return request<any>({
    url: `/paint/standard-template/${id}`,
    method: 'get'
  });
}

export function createStandardTemplate(data: { name: string; description?: string; version?: string; items?: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string; specialPaintId?: string }[] }) {
  return request({
    url: '/paint/standard-template',
    method: 'post',
    data
  });
}

export function updateStandardTemplate(data: { id: string; name?: string; description?: string; version?: string; isActive?: boolean; items?: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string; specialPaintId?: string }[] }) {
  return request({
    url: '/paint/standard-template',
    method: 'put',
    data
  });
}

export function deleteStandardTemplate(id: string) {
  return request({
    url: `/paint/standard-template/${id}`,
    method: 'delete'
  });
}

export function applyTemplateToShop(templateId: string, shopId: string) {
  return request({
    url: '/paint/standard-template/apply',
    method: 'post',
    data: { templateId, shopId }
  });
}

// ==================== 特殊车漆（通过标准模板管理） ====================

export function fetchSpecialPaintList(activeOnly?: boolean) {
  return request<any[]>({
    url: '/paint/standard-template/special-paints',
    method: 'get',
    params: activeOnly ? { activeOnly: 'true' } : undefined
  });
}

export function createSpecialPaint(data: { name: string; multiplier: number; description?: string; isActive?: boolean }) {
  return request({
    url: '/paint/standard-template/special-paint',
    method: 'post',
    data
  });
}

export function updateSpecialPaint(data: { id: string; name?: string; multiplier?: number; description?: string; isActive?: boolean }) {
  return request({
    url: '/paint/standard-template/special-paint',
    method: 'put',
    data
  });
}

export function deleteSpecialPaint(id: string) {
  return request({
    url: `/paint/standard-template/special-paint/${id}`,
    method: 'delete'
  });
}

// ==================== 工单审核 ====================

export function auditWorkOrder(id: string, auditedBy?: string) {
  return request({
    url: '/paint/work-order/audit',
    method: 'post',
    data: { id, auditedBy }
  });
}

export function unauditWorkOrder(id: string) {
  return request({
    url: `/paint/work-order/unaudit/${id}`,
    method: 'post'
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
