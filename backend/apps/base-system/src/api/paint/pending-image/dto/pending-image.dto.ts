import { PendingImageStatus } from '@prisma/client';

/** 图片池分页查询 */
export class PagePendingImageDto {
  /** 门店ID（必填，受数据权限约束） */
  shopId?: string;
  /** 结算月份 YYYY-MM */
  settlementMonth?: string;
  /** 匹配状态 */
  status?: PendingImageStatus;
  /** 关键词：工单号/车牌 */
  keyword?: string;
  current?: number;
  size?: number;
}

/** 人工指派到工单 */
export class ManualMatchDto {
  orderId: string;
}

/** 补建工单时可选覆盖的字段 */
export class CreateOrderFromPendingDto {
  /** 结算月份（默认用图片池记录的月份） */
  settlementMonth?: string;
}
