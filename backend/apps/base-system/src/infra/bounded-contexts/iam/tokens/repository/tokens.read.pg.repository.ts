import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { TokensReadModel } from '@app/base-system/lib/bounded-contexts/iam/tokens/domain/tokens.read.model';
import { TokensReadRepoPort } from '@app/base-system/lib/bounded-contexts/iam/tokens/ports/tokens.read.repo-port';

import { PrismaService } from '@lib/shared/prisma/prisma.service';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TokensReadRepository implements TokensReadRepoPort {
  constructor(private prisma: PrismaService) {}

  async findTokensByRefreshToken(
    refreshToken: string,
  ): Promise<TokensReadModel | null> {
    return this.prisma.sysTokens.findFirst({
      where: { refreshToken: hashToken(refreshToken) },
    });
  }
}
