import { request } from '../../request';
import type { PageResult, PaintPendingImage, PendingImageStatus, PendingImageStatusCounts } from './types';

// ==================== 图片池 API ====================

export function fetchPendingImagePage(params: {
  current?: number;
  size?: number;
  shopId?: string;
  settlementMonth?: string;
  status?: PendingImageStatus;
  keyword?: string;
}) {
  return request<PageResult<PaintPendingImage>>({
    url: '/paint/pending-image/page',
    method: 'get',
    params
  });
}

export function fetchPendingImageStatusCounts(shopId?: string, settlementMonth?: string) {
  return request<PendingImageStatusCounts>({
    url: '/paint/pending-image/status-counts',
    method: 'get',
    params: { shopId, settlementMonth }
  });
}

export function fetchPendingImageDetail(id: string) {
  return request<PaintPendingImage>({
    url: `/paint/pending-image/${id}`,
    method: 'get'
  });
}

export function fetchPendingImageCandidates(id: string) {
  return request<any[]>({
    url: `/paint/pending-image/${id}/candidates`,
    method: 'get'
  });
}

/** 上传单张图片到图片池（FormData: shopId, settlementMonth, file, thumbnail?） */
export function uploadPendingImage(formData: FormData, source: 'POOL' | 'CREATE' = 'POOL') {
  formData.append('source', source);
  return request<PaintPendingImage>({
    url: '/paint/pending-image/upload',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

/** 批量上传（FormData: shopId, settlementMonth, 多个 file） */
export function batchUploadPendingImage(formData: FormData) {
  return request<{
    total: number;
    results: Array<{ ok: boolean; filename?: string; data?: PaintPendingImage; error?: string }>;
  }>({
    url: '/paint/pending-image/batch-upload',
    method: 'post',
    data: formData,
    timeout: 300_000
  });
}

export function autoMatchPendingImage(id: string) {
  return request<{ status: PendingImageStatus; matchedOrderId?: string; remark?: string }>({
    url: `/paint/pending-image/${id}/auto-match`,
    method: 'post'
  });
}

export function manualMatchPendingImage(id: string, orderId: string) {
  return request<PaintPendingImage>({
    url: `/paint/pending-image/${id}/match`,
    method: 'post',
    data: { orderId }
  });
}

export function createOrderFromPending(id: string, settlementMonth?: string) {
  return request<PaintPendingImage>({
    url: `/paint/pending-image/${id}/create-order`,
    method: 'post',
    data: { settlementMonth }
  });
}

/** 人工修正图片池记录的 OCR 识别结果（rematch=true 时保存后立即重新匹配） */
export function correctPendingImageOcr(
  id: string,
  payload: {
    orderNo?: string;
    plateNumber?: string;
    vin?: string;
    carModel?: string;
    brand?: string;
    customerName?: string;
    phone?: string;
    date?: string;
    settlementMonth?: string;
  },
  rematch = true
) {
  return request<{
    id: string;
    record: PaintPendingImage | null;
    match: { status: PendingImageStatus; matchedOrderId?: string; remark?: string } | null;
  }>({
    url: `/paint/pending-image/${id}/correct-ocr`,
    method: 'post',
    data: { ...payload, rematch }
  });
}

export function retryOcrPendingImage(id: string) {
  return request<PaintPendingImage>({
    url: `/paint/pending-image/${id}/retry-ocr`,
    method: 'post',
    timeout: 120_000
  });
}

export function deletePendingImage(id: string) {
  return request({
    url: `/paint/pending-image/${id}`,
    method: 'delete'
  });
}
