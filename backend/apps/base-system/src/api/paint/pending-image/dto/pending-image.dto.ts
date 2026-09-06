import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
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

/**
 * 人工修正 OCR 识别结果。
 * 传入的字段（含空串）会覆盖原识别值，未传入的字段保持不变。
 */
export class CorrectPendingImageOcrDto {
  @ApiPropertyOptional({ description: '工单号' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  orderNo?: string;

  @ApiPropertyOptional({ description: '车牌号' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plateNumber?: string;

  @ApiPropertyOptional({ description: '车架号 VIN' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  vin?: string;

  @ApiPropertyOptional({ description: '车型' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  carModel?: string;

  @ApiPropertyOptional({ description: '品牌' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiPropertyOptional({ description: '客户名称' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  @ApiPropertyOptional({ description: '电话' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ description: '工单日期 YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  date?: string;

  @ApiPropertyOptional({ description: '结算月份 YYYY-MM，影响匹配范围' })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  settlementMonth?: string;

  @ApiPropertyOptional({ description: '是否保存后立即重新匹配，默认 true' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === undefined || value === null ? undefined : value === true || value === 'true' || value === '1')
  rematch?: boolean;
}
