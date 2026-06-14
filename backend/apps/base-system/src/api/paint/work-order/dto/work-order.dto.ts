import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsInt, IsDateString, IsEnum, ValidateNested, IsArray, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { PaintOrderStatus } from '@prisma/client';

export class WorkOrderItemDto {
  @ApiProperty({ description: '项目类别ID' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ description: '数量', default: 1 })
  @Type(() => Number)
  @IsInt()
  quantity?: number = 1;

  @ApiPropertyOptional({ description: '是否新件', default: false })
  @IsOptional()
  @IsBoolean()
  isNewPart?: boolean = false;

  @ApiPropertyOptional({ description: '特殊车漆ID' })
  @IsOptional()
  @IsString()
  specialPaintId?: string;
}

export class CreateWorkOrderDto {
  @ApiPropertyOptional({ description: '工单号，不填则自动生成' })
  @IsOptional()
  @IsString()
  orderNo?: string;

  @ApiProperty({ description: '门店ID' })
  @IsString()
  @IsNotEmpty()
  shopId: string;

  @ApiProperty({ description: '工单日期' })
  @IsDateString()
  @IsNotEmpty()
  orderDate: string;

  @ApiPropertyOptional({ description: '结算月份，格式yyyy-MM' })
  @IsOptional()
  @IsString()
  settlementMonth?: string;

  @ApiPropertyOptional({ description: '车型' })
  @IsOptional()
  @IsString()
  carModel?: string;

  @ApiProperty({ description: '车牌号' })
  @IsString()
  @IsNotEmpty()
  plateNumber: string;

  @ApiPropertyOptional({ description: '车架号' })
  @IsOptional()
  @IsString()
  vin?: string;

  @ApiPropertyOptional({ description: '客户名称' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ description: '电话' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '联系人' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ description: '问题描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '喷漆项目列表' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderItemDto)
  @IsOptional()
  items?: WorkOrderItemDto[];

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateWorkOrderDto {
  @ApiProperty({ description: '工单ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: '车型' })
  @IsOptional()
  @IsString()
  carModel?: string;

  @ApiPropertyOptional({ description: '车牌号' })
  @IsOptional()
  @IsString()
  plateNumber?: string;

  @ApiPropertyOptional({ description: '客户名称' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ description: '电话' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsOptional()
  @IsEnum(PaintOrderStatus)
  status?: PaintOrderStatus;

  @ApiPropertyOptional({ description: '结算月份，格式yyyy-MM' })
  @IsOptional()
  @IsString()
  settlementMonth?: string;

  @ApiPropertyOptional({ description: '喷漆项目列表，传入则整体替换' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderItemDto)
  @IsOptional()
  items?: WorkOrderItemDto[];

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class AuditWorkOrderDto {
  @ApiProperty({ description: '工单ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: '审核人' })
  @IsOptional()
  @IsString()
  auditedBy?: string;
}

export class PageWorkOrderDto {
  @ApiPropertyOptional({ description: '当前页' })
  @Type(() => Number)
  @IsOptional()
  current?: number = 1;

  @ApiPropertyOptional({ description: '每页数量' })
  @Type(() => Number)
  @IsOptional()
  size?: number = 10;

  @ApiPropertyOptional({ description: '门店ID' })
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({ description: '车牌号' })
  @IsOptional()
  @IsString()
  plateNumber?: string;

  @ApiPropertyOptional({ description: '客户名称' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ description: '结算月份，格式yyyy-MM' })
  @IsOptional()
  @IsString()
  settlementMonth?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsOptional()
  @IsEnum(PaintOrderStatus)
  status?: PaintOrderStatus;

  @ApiPropertyOptional({ description: '是否已审核' })
  @IsOptional()
  @IsBoolean()
  isAudited?: boolean;
}
