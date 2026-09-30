import { Body, Controller, Get, Post, Put, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';

import { PasswordIdentifierDTO } from '@app/base-system/lib/bounded-contexts/iam/authentication/application/dto/password-identifier.dto';
import { RefreshTokenDTO } from '@app/base-system/lib/bounded-contexts/iam/authentication/application/dto/refresh-token.dto';
import { AuthenticationService } from '@app/base-system/lib/bounded-contexts/iam/authentication/application/service/authentication.service';

import { USER_AGENT } from '@lib/constants/rest.constant';
import { Log } from '@lib/infra/decorators/log.decorator';
import { Public } from '@lib/infra/decorators/public.decorator';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
import { ApiRes } from '@lib/infra/rest/res.response';
import { Ip2regionService } from '@lib/shared/ip2region/ip2region.service';
import { IAuthentication } from '@lib/typings/global';
import { getClientIpAndPort } from '@lib/utils/ip.util';

import { ChangePasswordDto } from '../dto/change-password.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { PasswordLoginDto } from '../dto/password-login.dto';

@ApiTags('Authentication - Module')
@Controller('auth')
export class AuthenticationController {
  constructor(private readonly authenticationService: AuthenticationService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 每 IP 每分钟 10 次：防口令爆破
  @Post('login')
  @ApiOperation({
    summary: 'Password-based User Authentication',
    description:
      'Authenticates a user by verifying provided password credentials and issues a JSON Web Token (JWT) upon successful authentication.',
  })
  async login(
    @Body() dto: PasswordLoginDto,
    @Request() request: FastifyRequest,
  ): Promise<ApiRes<any>> {
    const { ip, port } = getClientIpAndPort(request);
    let region = 'Unknown';

    try {
      const ip2regionResult = await Ip2regionService.getSearcher().search(ip);
      region = ip2regionResult.region || region;
    } catch (_) {}
    const token = await this.authenticationService.execPasswordLogin(
      new PasswordIdentifierDTO(
        dto.identifier,
        dto.password,
        ip,
        region,
        // 微信等内置浏览器 UA 超长（380+），超列宽会导致 token 记录落库失败 → 半小时后续期 401 被登出
        String(request.headers[USER_AGENT] ?? '').slice(0, 500),
        String(request.id),
        'PC',
        port,
      ),
    );
    return ApiRes.success(token);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 刷新令牌：正常使用远低于此阈值
  @Post('refreshToken')
  async refreshToken(
    @Body('refreshToken') refreshToken: string,
    @Request() request: FastifyRequest,
  ): Promise<ApiRes<any>> {
    const { ip, port } = getClientIpAndPort(request);
    let region = 'Unknown';

    try {
      const ip2regionResult = await Ip2regionService.getSearcher().search(ip);
      region = ip2regionResult.region || region;
    } catch (_) {}
    const token = await this.authenticationService.refreshToken(
      new RefreshTokenDTO(
        refreshToken,
        ip,
        region,
        String(request.headers[USER_AGENT] ?? '').slice(0, 500),
        String(request.id),
        'PC',
        port,
      ),
    );
    return ApiRes.success(token);
  }

  @Post('logout')
  @Log('认证', '退出登录', { logBody: false })
  @ApiOperation({
    summary: 'User logout - revoke refresh tokens',
    description:
      'Revokes the current refresh token (or all sessions of the user) and clears the role cache.',
  })
  async logout(
    @Request() req: AuthenticatedRequest,
    @Body('refreshToken') refreshToken?: string,
  ): Promise<ApiRes<any>> {
    const user: IAuthentication = req.user;
    await this.authenticationService.logout(user.uid, refreshToken, user.jti);
    return ApiRes.success(null);
  }

  @Get('profile')
  @ApiOperation({ summary: '查询个人资料（昵称/手机号/邮箱）' })
  async getSelfProfile(@Request() req: AuthenticatedRequest): Promise<ApiRes<any>> {
    const data = await this.authenticationService.getProfile(req.user.uid);
    return ApiRes.success(data);
  }

  @Put('profile')
  @Log('认证', '修改个人资料', { logBody: false })
  @ApiOperation({ summary: '修改个人资料（仅昵称/手机号/邮箱）' })
  async updateSelfProfile(@Body() dto: UpdateProfileDto, @Request() req: AuthenticatedRequest): Promise<ApiRes<any>> {
    const data = await this.authenticationService.updateProfile(req.user.uid, dto);
    return ApiRes.success(data);
  }

  @Put('password')
  @Log('认证', '修改密码', { logBody: false })
  @ApiOperation({ summary: '修改密码（成功后所有设备需重新登录）' })
  async changeSelfPassword(@Body() dto: ChangePasswordDto, @Request() req: AuthenticatedRequest): Promise<ApiRes<null>> {
    await this.authenticationService.changePassword(req.user.uid, dto.oldPassword, dto.newPassword);
    await this.authenticationService.logout(req.user.uid);
    return ApiRes.success(null);
  }

  @Get('getUserInfo')
  async getProfile(@Request() req: AuthenticatedRequest): Promise<ApiRes<any>> {
    const user: IAuthentication = req.user;
    const userRoles = await this.authenticationService.getUserRoles(user.uid);
    return ApiRes.success({
      userId: user.uid,
      userName: user.username,
      roles: userRoles,
    });
  }
}
