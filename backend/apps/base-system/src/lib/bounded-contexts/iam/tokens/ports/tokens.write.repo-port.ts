import { TokensEntity } from '../domain/tokens.entity';

export interface TokensWriteRepoPort {
  save(tokens: TokensEntity): Promise<void>;

  /**
   * 原子消费 refresh token：仅当状态为 UNUSED 时才置为 USED。
   * 利用 DB 唯一约束 + 条件更新实现 CAS，避免并发重放攻击。
   * 返回受影响的行数（0 表示 token 已被使用或不存在）。
   */
  consumeRefreshToken(refreshToken: string): Promise<{ count: number }>;

  /** 吊销指定的 refresh token（仅 UNUSED 状态可吊销），用于登出。 */
  revokeRefreshToken(refreshToken: string): Promise<{ count: number }>;

  /** 吊销某用户的所有未使用 refresh token，用于登出全部会话。 */
  revokeTokensByUserId(userId: string): Promise<{ count: number }>;

  /**
   * 清理滞留的 token 记录：USED/REVOKED 早于指定时间，或 UNUSED 早于刷新令牌有效期。
   */
  deleteUsedTokens(before: Date): Promise<number>;
}
