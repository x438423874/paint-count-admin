import { request } from '../../request';
import type { PageResult, PaintShop, PaintShopListItem } from './types';

// ==================== 门店 API ====================

export function fetchPaintShopList() {
  return request<PaintShopListItem[]>({
    url: '/paint/shop/list',
    method: 'get'
  });
}

export function fetchPaintShopPage(params?: { current?: number; size?: number; name?: string; brand?: string }) {
  return request<PageResult<PaintShop>>({
    url: '/paint/shop/page',
    method: 'get',
    params
  });
}

export function createPaintShop(data: {
  name: string;
  code: string;
  brand: string;
  address?: string;
  phone?: string;
  standardTemplateId?: string;
}) {
  return request({
    url: '/paint/shop',
    method: 'post',
    data
  });
}

export function updatePaintShop(data: {
  id: string;
  name: string;
  brand: string;
  address?: string;
  phone?: string;
  standardTemplateId?: string;
}) {
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

export function fetchCategoryAliasMap(shopId: string) {
  return request<Record<string, string>>({
    url: `/paint/shop/${shopId}/category-alias-map`,
    method: 'get'
  });
}
