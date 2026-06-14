import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class MonthlyStatisticsDto {
  @ApiPropertyOptional({ description: '年份' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ description: '月份' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  month?: number;

  @ApiPropertyOptional({ description: '门店ID' })
  @IsOptional()
  @IsString()
  shopId?: string;
}
