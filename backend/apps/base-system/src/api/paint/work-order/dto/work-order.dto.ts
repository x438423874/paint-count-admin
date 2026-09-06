import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsInt, IsDateString, IsIn, ValidateNested, IsArray, IsBoolean, MaxLength, IsNumber } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class WorkOrderItemDto {
  @ApiProperty({ description: '项目类别ID' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ description: '数量', default: 1 })
  @Type(() => Number)
  @IsInt()
  quantity?: number = 1;

  @ApiPropertyOptional({ description: '新件数量', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  newPartQuantity?: number = 0;

  @ApiPropertyOptional({ description: '特殊车漆ID' })
  @IsOptional()
  @IsString()
  specialPaintId?: string;

  @ApiPropertyOptional({ description: '手动覆盖幅数，不传则自动计算' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  overridePaintCount?: number;
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

  @ApiPropertyOptional({ description: '工单日期，批量上传时可为空，通过OCR识别填充' })
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @ApiPropertyOptional({ description: '结算月份，格式yyyy-MM' })
  @IsOptional()
  @IsString()
  settlementMonth?: string;

  @ApiPropertyOptional({ description: '车型' })
  @IsOptional()
  @IsString()
  carModel?: string;

  @ApiPropertyOptional({ description: '车牌号' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plateNumber?: string;

  @ApiPropertyOptional({ description: '车架号' })
  @IsOptional()
  @IsString()
  vin?: string;

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

  @ApiPropertyOptional({ description: '是否幅数调整单（负幅数工单，用于抵消/订正月报，不影响源工单与车辆去重）' })
  @IsOptional()
  @IsBoolean()
  isAdjustment?: boolean;

  @ApiPropertyOptional({ description: '导入幅数汇总表时直接指定的总幅数（无明细部位列时生效）' })
  @IsOptional()
  @IsNumber()
  importTotalPaintCount?: number;
}

export class UpdateWorkOrderDto {
  @ApiProperty({ description: '工单ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: '门店ID' })
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({ description: '工单号' })
  @IsOptional()
  @IsString()
  orderNo?: string;

  @ApiPropertyOptional({ description: '工单日期' })
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @ApiPropertyOptional({ description: '车型' })
  @IsOptional()
  @IsString()
  carModel?: string;

  @ApiPropertyOptional({ description: '车牌号' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plateNumber?: string;

  @ApiPropertyOptional({ description: '车架号' })
  @IsOptional()
  @IsString()
  vin?: string;

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

  @ApiPropertyOptional({ description: '问题描述' })
  @IsOptional()
  @IsString()
  description?: string;

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

  @ApiPropertyOptional({ description: '是否返工' })
  @IsOptional()
  @IsBoolean()
  isRework?: boolean;

  @ApiPropertyOptional({ description: '返工原因' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reworkRemark?: string;

  @ApiPropertyOptional({ description: '是否幅数调整单（负幅数工单，用于抵消/订正月报，不影响源工单与车辆去重）' })
  @IsOptional()
  @IsBoolean()
  isAdjustment?: boolean;
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

export class QueryWorkOrderDto {}

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

  @ApiPropertyOptional({ description: '状态：DRAFT=草稿,PENDING=待审核,AUDITED=已审核,SETTLED=已结算,ABNORMAL=异常,VOID=作废' })
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING', 'AUDITED', 'SETTLED', 'ABNORMAL', 'VOID'])
  status?: string;

  @ApiPropertyOptional({ description: '是否返工' })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => (value === undefined || value === null ? value : value === true || value === 'true' || value === '1'))
  @IsBoolean()
  isRework?: boolean;

  @ApiPropertyOptional({ description: '部位类别ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '是否仅含新件（工单项 newPartQuantity>0）' })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => (value === undefined || value === null ? value : value === true || value === 'true' || value === '1'))
  @IsBoolean()
  isNewPart?: boolean;

  @ApiPropertyOptional({ description: '是否仅看幅数调整单' })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => (value === undefined || value === null ? value : value === true || value === 'true' || value === '1'))
  @IsBoolean()
  isAdjustment?: boolean;
}
