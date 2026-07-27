import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVehicleDto {
  @ApiProperty({ description: '车牌号（全局唯一，存储时统一大写）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  plateNumber: string;

  @ApiPropertyOptional({ description: '车架号 VIN' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vin?: string;

  @ApiPropertyOptional({ description: '车型' })
  @IsOptional()
  @IsString()
  carModel?: string;

  @ApiPropertyOptional({ description: '品牌' })
  @IsOptional()
  @IsString()
  brand?: string;

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

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateVehicleDto {
  @ApiProperty({ description: '车辆ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: '车牌号' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plateNumber?: string;

  @ApiPropertyOptional({ description: '车架号 VIN' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vin?: string;

  @ApiPropertyOptional({ description: '车型' })
  @IsOptional()
  @IsString()
  carModel?: string;

  @ApiPropertyOptional({ description: '品牌' })
  @IsOptional()
  @IsString()
  brand?: string;

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

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class PageVehicleDto {
  @ApiPropertyOptional({ description: '当前页' })
  @Type(() => Number)
  @IsOptional()
  current?: number = 1;

  @ApiPropertyOptional({ description: '每页数量' })
  @Type(() => Number)
  @IsOptional()
  size?: number = 10;

  @ApiPropertyOptional({ description: '车牌号（模糊查询）' })
  @IsOptional()
  @IsString()
  plateNumber?: string;

  @ApiPropertyOptional({ description: '客户名称（模糊查询）' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ description: '电话（模糊查询）' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '车架号 VIN（模糊查询）' })
  @IsOptional()
  @IsString()
  vin?: string;

  @ApiPropertyOptional({ description: '门店ID：仅看在该门店维修过的车辆' })
  @IsOptional()
  @IsString()
  shopId?: string;
}

/**
 * 工单保存时由 WorkOrderService 调用，按车牌 upsert 车辆主数据
 */
export class UpsertVehicleByPlateDto {
  @ApiProperty({ description: '车牌号' })
  @IsString()
  @IsNotEmpty()
  plateNumber: string;

  @ApiPropertyOptional() @IsOptional() @IsString() vin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() carModel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPerson?: string;
}
