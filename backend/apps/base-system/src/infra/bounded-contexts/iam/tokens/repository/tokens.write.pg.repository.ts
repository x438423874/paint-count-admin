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
    const result = await this.prisma.sysTokens.deleteMany({
      where: { status: TokenStatus.USED, createdAt: { lt: before } },
    });
    return result.count;
  }
}
