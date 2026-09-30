import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ISecurityConfig, SecurityConfig } from '@lib/config';
import { CacheConstant } from '@lib/constants/cache.constant';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import { IAuthentication } from '@lib/typings/global';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(SecurityConfig.KEY)
    private readonly securityConfig: ISecurityConfig,
  ) {
    super({
      // <img> 等资源请求无法携带 Authorization 头，允许通过 ?access_token= 查询参数鉴权
      // （仅用于 /uploads 受控下载；token 会进入访问日志，主接口仍以 Header 为准）
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('access_token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: securityConfig.jwtSecret,
    });
  }

  async validate(payload: any) {
    await this.validateAuthenticationPayload(payload);
    await this.validateSessionAlive(payload);
    return payload;
  }

  /**
   * 会话存活校验（登出即吊销）：
   * 登录/刷新时会在 Redis 写入 soybean:cache:access:{jti}（TTL=access 有效期），
   * 登出删除该键。键不存在 = 令牌已被登出吊销。
   * Redis 故障时降级放行（与工单号生成的可用性取舍一致），键明确不存在才拒绝。
   */
  private async validateSessionAlive(payload: IAuthentication) {
    if (!payload.jti) {
      // 无会话标识的令牌视为非法（旧版本签发，随密钥轮换已全部失效）
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }
    try {
      const alive = await RedisUtility.instance.exists(
        `${CacheConstant.ACCESS_SESSION_PREFIX}${payload.jti}`,
      );
      if (!alive) {
        throw new UnauthorizedException('登录状态已失效，请重新登录');
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      // Redis 故障降级：放行（令牌本身已通过签名与有效期校验）
    }
  }

  //TODO 此处可用class-validator验证处理
  assertIsIAuthentication(payload: any): asserts payload is IAuthentication {
    if (typeof payload.uid !== 'string') {
      throw new UnauthorizedException('登录状态异常，请重新登录');
    }
    if (typeof payload.username !== 'string') {
      throw new UnauthorizedException('登录状态异常，请重新登录');
    }
    if (typeof payload.domain !== 'string') {
      throw new UnauthorizedException('登录状态异常，请重新登录');
    }
  }

  async validateAuthenticationPayload(payload: any): Promise<IAuthentication> {
    this.assertIsIAuthentication(payload);
    return payload;
  }
}
