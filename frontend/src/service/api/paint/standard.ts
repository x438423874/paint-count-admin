import { request } from '../../request';
import type { PaintItemCategory, PaintSpecialPaint, PaintStandard, PaintStandardTemplate } from './types';

// ==================== 幅数标准 API ====================

export function fetchPaintCategoryList() {
  return request<PaintItemCategory[]>({
    url: '/paint/standard-template/categories',
    method: 'get'
  });
}

export function fetchShopCategoriesWithStandard(shopId: string) {
  return request<(PaintItemCategory & { standard?: PaintStandard })[]>({
    url: `/paint/standard/shop/${shopId}/categories`,
    method: 'get'
  });
}

// ==================== 部位管理 ====================

export function createPaintCategory(data: { name: string; code: string; sortOrder?: number; isSpecial?: boolean }) {
  return request<PaintItemCategory>({
    url: '/paint/standard-template/categories',
    method: 'post',
    data
  });
}

export function updatePaintCategory(
  id: string,
  data: { name?: string; code?: string; sortOrder?: number; isSpecial?: boolean }
) {
  return request<PaintItemCategory>({
    url: `/paint/standard-template/categories/${id}`,
    method: 'put',
    data
  });
}

export function deletePaintCategory(id: string) {
  return request({
    url: `/paint/standard-template/categories/${id}`,
    method: 'delete'
  });
}

// ==================== 标准模板 ====================

export function fetchStandardTemplateList() {
  return request<PaintStandardTemplate[]>({
    url: '/paint/standard-template/list',
    method: 'get'
  });
}

export function fetchStandardTemplateById(id: string) {
  return request<PaintStandardTemplate>({
    url: `/paint/standard-template/${id}`,
    method: 'get'
  });
}

export function createStandardTemplate(data: {
  name: string;
  description?: string;
  version?: string;
  items?: {
    categoryId: string;
    coefficient: number;
    newPartAddition?: number;
    alias?: string;
    specialPaintId?: string;
  }[];
}) {
  return request<PaintStandardTemplate>({
    url: '/paint/standard-template',
    method: 'post',
    data
  });
}

export function updateStandardTemplate(data: {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  isActive?: boolean;
  items?: {
    categoryId: string;
    coefficient: number;
    newPartAddition?: number;
    alias?: string;
    specialPaintId?: string;
  }[];
}) {
  return request<PaintStandardTemplate>({
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

export function fetchSpecialPaintList(templateId?: string, activeOnly?: boolean) {
  const params: any = {};
  if (templateId) params.templateId = templateId;
  if (activeOnly) params.activeOnly = 'true';
  return request<PaintSpecialPaint[]>({
    url: '/paint/standard-template/special-paints',
    method: 'get',
    params
  });
}

export function createSpecialPaint(data: {
  templateId: string;
  name: string;
  multiplier: number;
  description?: string;
  isActive?: boolean;
}) {
  return request<PaintSpecialPaint>({
    url: '/paint/standard-template/special-paint',
    method: 'post',
    data
  });
}

export function deleteSpecialPaint(id: string) {
  return request({
    url: `/paint/standard-template/special-paint/${id}`,
    method: 'delete'
  });
}
