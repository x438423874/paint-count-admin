import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: '旧密码' })
  @IsString()
  @IsNotEmpty({ message: '请输入旧密码' })
  oldPassword: string;

  @ApiProperty({ description: '新密码', minLength: 6 })
  @IsString()
  @IsNotEmpty({ message: '请输入新密码' })
  @MinLength(6, { message: '新密码至少 6 位' })
  newPassword: string;
}
