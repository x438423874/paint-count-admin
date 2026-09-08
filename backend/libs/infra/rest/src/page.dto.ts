import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional } from 'class-validator';

/** 通用分页查询参数基类（current 从 1 开始，size 每页条数） */
export class PageDto {
  @ApiPropertyOptional({ description: '当前页', default: 1 })
  @Type(() => Number)
  @IsOptional()
  current?: number = 1;

  @ApiPropertyOptional({ description: '每页条数', default: 10 })
  @Type(() => Number)
  @IsOptional()
  size?: number = 10;
}
