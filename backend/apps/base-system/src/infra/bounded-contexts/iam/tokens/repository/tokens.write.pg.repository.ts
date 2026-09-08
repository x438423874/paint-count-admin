import { Injectable } from '@nestjs/common';

import { TokenStatus } from '@app/base-system/lib/bounded-contexts/iam/tokens/constants';
import { TokensEntity } from '@app/base-system/lib/bounded-contexts/iam/tokens/domain/tokens.entity';
import { TokensWriteRepoPort } from '@app/base-system/lib/bounded-contexts/iam/tokens/ports/tokens.write.repo-port';

import { PrismaService } from '@lib/shared/prisma/prisma.service';

@Injectable()
export class TokensWriteRepository implements TokensWriteRepoPort {
  constructor(private prisma: PrismaService) {}

  async save(tokens: TokensEntity): Promise<void> {
    await this.prisma.sysTokens.create({
      data: tokens,
    });
  }

  async consumeRefreshToken(refreshToken: string): Promise<{ count: number }> {
    const result = await this.prisma.sysTokens.updateMany({
      where: { refreshToken, status: TokenStatus.UNUSED },
      data: { status: TokenStatus.USED },
    });
    return { count: result.count };
  }

  async revokeRefreshToken(refreshToken: string): Promise<{ count: number }> {
    const result = await this.prisma.sysTokens.updateMany({
      where: { refreshToken, status: TokenStatus.UNUSED },
      data: { status: TokenStatus.REVOKED },
    });
    return { count: result.count };
  }

  async revokeTokensByUserId(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.sysTokens.updateMany({
      where: { userId, status: TokenStatus.UNUSED },
      data: { status: TokenStatus.REVOKED },
    });
    return { count: result.count };
  }

  async deleteUsedTokens(before: Date): Promise<number> {
    // 清理三类滞留记录，避免 sys_tokens 无限膨胀：
    //  - USED / REVOKED：已消费或已吊销，超过保留期（30 天）
    //  - UNUSED：从未被刷新消费，且已早于刷新令牌有效期（7 天）——记录本身已失效，
    //    此时该 refresh token 无法再通过校验，删除不影响任何在线会话
    const unusedExpireAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.sysTokens.deleteMany({
      where: {
        OR: [
          { status: TokenStatus.USED, createdAt: { lt: before } },
          { status: TokenStatus.REVOKED, createdAt: { lt: before } },
          { status: TokenStatus.UNUSED, createdAt: { lt: unusedExpireAt } },
        ],
      },
    });
    return result.count;
  }
}
