import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

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
import { UserReadRepoPortToken, UserWriteRepoPortToken } from '../../constants';
import { UserLoggedInEvent } from '../../domain/events/user-logged-in.event';
import { Password } from '../../domain/password.value-object';
import { User } from '../../domain/user';
import { UserReadRepoPort } from '../../ports/user.read.repo-port';
import { UserWriteRepoPort } from '../../ports/user.write.repo-port';
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
    @Inject(UserWriteRepoPortToken)
    private readonly userWriteRepository: UserWriteRepoPort,
  ) {}

  async refreshToken(dto: RefreshTokenDTO) {
    const tokenDetails = await this.queryBus.execute<
      TokensByRefreshTokenQuery,
      TokensReadModel | null
    >(new TokensByRefreshTokenQuery(dto.refreshToken));
    if (!tokenDetails) {
      throw new UnauthorizedException('Refresh token 不存在或已失效');
    }

    // 验签用客户端传入的原始 refresh token（库里存的是哈希，不可直接验签）
    try {
      await this.jwtService.verifyAsync(dto.refreshToken, {
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
  async logout(userId: string, refreshToken?: string, accessJti?: string): Promise<void> {
    if (refreshToken) {
      await this.tokensWriteRepository.revokeRefreshToken(refreshToken);
    } else {
      await this.tokensWriteRepository.revokeTokensByUserId(userId);
    }
    await RedisUtility.instance.del(
      `${CacheConstant.AUTH_TOKEN_PREFIX}${userId}`,
    );
    // 登出即吊销当前访问令牌（删会话键后，JwtStrategy 会拒绝该 access token）
    if (accessJti) {
      await RedisUtility.instance.del(
        `${CacheConstant.ACCESS_SESSION_PREFIX}${accessJti}`,
      );
    }
  }

  /**
   * 查询用户角色：优先 Redis 缓存，Redis 故障时回退数据库。
   */
  async getUserRoles(userId: string): Promise<string[]> {
    try {
      const roles = await RedisUtility.instance.smembers(
        `${CacheConstant.AUTH_TOKEN_PREFIX}${userId}`,
      );
      if (roles.length > 0) return roles;
    } catch {
      // Redis 故障，走数据库
    }
    const codes = await this.repository.findRolesByUserId(userId);
    return Array.from(codes);
  }

  /** 查询个人资料（自助） */
  async getProfile(userId: string) {
    const user = await this.repository.findUserById(userId);
    if (!user) throw new NotFoundException('用户不存在');
    return {
      userId: user.id,
      username: user.username,
      realName: user.realName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      avatar: user.avatar,
    };
  }

  /** 修改个人资料（自助）：仅昵称/手机号/邮箱，用户名与角色状态不可自改 */
  async updateProfile(
    userId: string,
    dto: { realName?: string; phoneNumber?: string; email?: string },
  ) {
    const user = await this.repository.findUserById(userId);
    if (!user) throw new NotFoundException('用户不存在');

    const realName = dto.realName !== undefined ? dto.realName.trim() : user.realName;
    const phoneNumber = dto.phoneNumber !== undefined ? dto.phoneNumber.trim() : user.phoneNumber;
    const email = dto.email !== undefined ? dto.email.trim() : user.email;

    try {
      await this.userWriteRepository.update(
        new User({
          id: user.id,
          username: user.username,
          password: user.password,
          domain: user.domain,
          status: user.status,
          createdAt: new Date(),
          createdBy: userId,
          realName: realName || null,
          avatar: user.avatar,
          email,
          phoneNumber,
        }),
      );
    } catch (e: any) {
      // 手机号/邮箱有唯一约束，撞车时给出可读提示
      if (e?.code === 'P2002') throw new BadRequestException('手机号或邮箱已被其他账号使用');
      throw e;
    }
    return this.getProfile(userId);
  }

  /** 修改密码（自助）：校验旧密码 → 哈希新密码 → 吊销全部刷新令牌（所有设备重新登录） */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.repository.findUserById(userId);
    if (!user) throw new NotFoundException('用户不存在');

    const current = Password.fromHashed(user.password);
    if (!(await current.compare(oldPassword))) {
      throw new BadRequestException('旧密码不正确');
    }
    if (oldPassword === newPassword) {
      throw new BadRequestException('新密码不能与旧密码相同');
    }

    const newPasswordHashed = await Password.hash(newPassword);
    await this.userWriteRepository.updatePassword(userId, newPasswordHashed.getValue(), userId);

    // 安全：改密后吊销该用户所有刷新令牌并清理角色缓存，全部设备回到登录页
    await this.logout(userId);
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
    try {
      await RedisUtility.instance.del(key);
      if (roles.length > 0) {
        await RedisUtility.instance.sadd(key, ...roles);
      }
      await RedisUtility.instance.expire(key, this.securityConfig.jwtExpiresIn);
    } catch {
      // 角色缓存写入失败不阻断登录/刷新：鉴权守卫在 Redis 故障时会回退数据库查角色
    }
  }

  async execPasswordLogin(
    dto: PasswordIdentifierDTO,
  ): Promise<{ token: string; refreshToken: string }> {
    const { identifier, password } = dto;
    const user = await this.repository.findUserByIdentifier(identifier);
    if (!user) {
      // 与密码错误统一口径：不暴露账号是否存在
      throw new BadRequestException('账号或密码错误');
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
    const jti = randomUUID();
    const payload: IAuthentication = {
      uid: userId,
      username: username,
      domain: domain,
      jti,
    };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.securityConfig.refreshJwtSecret,
      expiresIn: this.securityConfig.refreshJwtExpiresIn,
    });

    // 登出即吊销：记录访问令牌会话（TTL 与 access 有效期一致），登出时删除该键
    try {
      await RedisUtility.instance.set(
        `${CacheConstant.ACCESS_SESSION_PREFIX}${jti}`,
        userId,
        'EX',
        this.securityConfig.jwtExpiresIn,
      );
    } catch {
      // Redis 故障时跳过会话登记（JwtStrategy 对 Redis 故障降级放行），不影响登录
    }

    return { token: accessToken, refreshToken };
  }
}
