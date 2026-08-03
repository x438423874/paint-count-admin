import { AggregateRoot } from '@nestjs/cqrs';

import { TokensProperties } from './tokens.read.model';

export interface ITokens {
  commit(): void;
}

export class TokensEntity extends AggregateRoot implements ITokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  status: string;
  readonly userId: string;
  readonly username: string;
  readonly domain: string;
  readonly ip: string;
  readonly address: string;
  readonly userAgent: string;
  readonly requestId: string;
  readonly type: string;
  readonly createdBy: string;
  readonly port?: number | null;

  constructor(properties: TokensProperties) {
    super();
    Object.assign(this, properties);
  }
}
