import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class AssignUserRolesDto {
  @ApiProperty({ required: true, description: '用户 ID' })
  @IsString({ message: '用户 ID 必须是字符串' })
  @IsNotEmpty({ message: '用户 ID 不能为空' })
  userId: string;

  @ApiProperty({
    type: String,
    isArray: true,
    required: true,
    description: '角色 ID 列表，全量覆盖；传空数组表示清空该用户的所有角色'
  })
  @IsArray({ message: '角色 ID 列表必须是数组' })
  @IsString({ each: true, message: '每个角色 ID 必须是字符串' })
  @IsNotEmpty({ each: true, message: '角色 ID 不能为空' })
  roleIds: string[];
}
