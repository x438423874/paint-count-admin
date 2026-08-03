import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventPublisher, QueryBus } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';

import { TokensReadModel } from '@app/base-system/lib/bounded-contexts/iam/tokens/domain/tokens.read.model';
import { TokensByRefreshTokenQuery } from '@app/base-system/lib/bounded-contexts/iam/tokens/queries/tokens.by-refresh_token.query';
import { TokensWriteRepoPortToken } from '@app/base-system/lib/bounded-contexts/iam/tokens/constants';
import { TokensWriteRepoPort } from '@app/base-system/lib/bounded-contexts/iam/tokens/ports/tokens.write.repo-port';

import { ISecurityConfig, SecurityConfig } from '@lib/config';
import { CacheConstant } from '@lib/constants/cache.constant';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import { IAuthentication } from '@lib/typings/global';

import { TokenGeneratedEvent } from '../../../tokens/domain/events/token-generated.event';
import { TokensEntity } from '../../../tokens/domain/tokens.entity';
import { UserReadRepoPortToken } from '../../constants';
import { UserLoggedInEvent } from '../../domain/events/user-logged-in.event';
import { User } from '../../domain/user';
import { UserReadRepoPort } from '../../ports/user.read.repo-port';
import { PasswordIdentifierDTO } from '../dto/password-identifier.dto';
import { RefreshTokenDTO } from '../dto/refresh-token.dto';

@Injectable()
export class AuthenticationService {
  constructor(
    private jwtService: JwtService,
    private readonly publisher: EventPublisher,
    @Inject(UserReadRepoPortToken)
    private readonly repository: UserReadRepoPort,
    private queryBus: QueryBus,
    @Inject(SecurityConfig.KEY) private securityConfig: ISecurityConfig,
    @Inject(TokensWriteRepoPortToken)
    private readonly tokensWriteRepository: TokensWriteRepoPort,
  ) {}

  async refreshToken(dto: RefreshTokenDTO) {
    const tokenDetails = await this.queryBus.execute<
      TokensByRefreshTokenQuery,
      TokensReadModel | null
    >(new TokensByRefreshTokenQuery(dto.refreshToken));
    if (!tokenDetails) {
      throw new UnauthorizedException('Refresh token 不存在或已失效');
    }

    try {
      await this.jwtService.verifyAsync(tokenDetails.refreshToken, {
        secret: this.securityConfig.refreshJwtSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token 已过期或非法');
    }

    // A) 原子消费（CAS）：仅当 refresh token 仍为 UNUSED 时才置为 USED，
    // 利用 DB 条件更新消除并发重放，返回 0 表示已被使用或不存在。
    const consumeResult = await this.tokensWriteRepository.consumeRefreshToken(
      dto.refreshToken,
    );
    if (consumeResult.count === 0) {
      throw new UnauthorizedException('Refresh token 已被使用或不存在');
    }

    const tokensAggregate = new TokensEntity(tokenDetails);

    const tokens = await this.generateAccessToken(
      tokensAggregate.userId,
      tokenDetails.username,
      tokenDetails.domain,
    );

    tokensAggregate.apply(
      new TokenGeneratedEvent(
        tokens.token,
        tokens.refreshToken,
        tokensAggregate.userId,
        tokensAggregate.username,
        tokensAggregate.domain,
        dto.ip,
        dto.region,
        dto.userAgent,
        dto.requestId,
        dto.type,
        dto.port,
      ),
    );

    this.publisher.mergeObjectContext(tokensAggregate);
    tokensAggregate.commit();

    // refresh token 成功后同步刷新 Redis 中的角色缓存，避免 token 未过期但角色缓存已过期
    await this.refreshUserRolesCache(tokensAggregate.userId);

    // D) 顺带清理过期的已用 token 记录
    await this.pruneUsedTokens();

    return tokens;
  }

  /**
   * B) 登出：吊销 refresh token 并清理角色缓存。
   * 若传入 refreshToken，则只吊销该会话；否则吊销该用户所有未使用会话。
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.tokensWriteRepository.revokeRefreshToken(refreshToken);
    } else {
      await this.tokensWriteRepository.revokeTokensByUserId(userId);
    }
    await RedisUtility.instance.del(
      `${CacheConstant.AUTH_TOKEN_PREFIX}${userId}`,
    );
  }

  /**
   * D) 清理早于保留期的已用(USED) token 记录，避免 sys_tokens 无限膨胀。
   */
  private async pruneUsedTokens(): Promise<void> {
    const retentionDays = 30;
    const before = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    await this.tokensWriteRepository.deleteUsedTokens(before);
  }

  /**
   * 刷新 Redis 中用户角色缓存，保持与 token 生命周期一致
   */
  private async refreshUserRolesCache(userId: string) {
    const result = await this.repository.findRolesByUserId(userId);
    const roles = Array.from(result);
    const key = `${CacheConstant.AUTH_TOKEN_PREFIX}${userId}`;
    await RedisUtility.instance.del(key);
    if (roles.length > 0) {
      await RedisUtility.instance.sadd(key, ...roles);
    }
    await RedisUtility.instance.expire(key, this.securityConfig.jwtExpiresIn);
  }

  async execPasswordLogin(
    dto: PasswordIdentifierDTO,
  ): Promise<{ token: string; refreshToken: string }> {
    const { identifier, password } = dto;
    const user = await this.repository.findUserByIdentifier(identifier);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    const userAggregate = new User(user);
    const loginResult = await userAggregate.loginUser(password);

    if (!loginResult.success) {
      throw new BadRequestException(loginResult.message);
    }

    const tokens = await this.generateAccessToken(
      user.id,
      user.username,
      user.domain,
    );

    userAggregate.apply(
      new UserLoggedInEvent(
        user.id,
        user.username,
        user.domain,
        dto.ip,
        dto.address,
        dto.userAgent,
        dto.requestId,
        dto.type,
        dto.port,
      ),
    );
    userAggregate.apply(
      new TokenGeneratedEvent(
        tokens.token,
        tokens.refreshToken,
        user.id,
        user.username,
        user.domain,
        dto.ip,
        dto.address,
        dto.userAgent,
        dto.requestId,
        dto.type,
        dto.port,
      ),
    );
    this.publisher.mergeObjectContext(userAggregate);
    userAggregate.commit();

    await this.refreshUserRolesCache(user.id);

    // D) 登录时清理过期的已用 token 记录
    await this.pruneUsedTokens();

    return tokens;
  }

  private async generateAccessToken(
    userId: string,
    username: string,
    domain: string,
  ): Promise<{ token: string; refreshToken: string }> {
    const payload: IAuthentication = {
      uid: userId,
      username: username,
      domain: domain,
    };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.securityConfig.refreshJwtSecret,
      expiresIn: this.securityConfig.refreshJwtExpiresIn,
    });

    return { token: accessToken, refreshToken };
  }
}
