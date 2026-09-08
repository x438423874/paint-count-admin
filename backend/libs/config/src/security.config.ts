import { ConfigType, registerAs } from '@nestjs/config';

import { getEnvNumber, getEnvString, isDevEnvironment } from '@lib/utils/env';

export const securityRegToken = 'security';

/**
 * 生产环境必须显式配置 JWT 密钥，禁止使用默认弱密钥。
 * 开发环境允许使用临时默认值，但会有日志警告。
 */
function getJwtSecret(envKey: string): string {
  const value = process.env[envKey];
  if (value) return value;

  if (isDevEnvironment) {
    // eslint-disable-next-line no-console
    console.warn(`[Security] ${envKey} 未设置，开发环境使用临时默认值，生产环境必须配置！`);
    return `${envKey}-dev-only-change-in-production-${Date.now()}`;
  }

  throw new Error(
    `[Security] ${envKey} 必须在生产环境配置文件中设置，且长度不少于 32 个字符。`,
  );
}

export const SecurityConfig = registerAs(securityRegToken, () => ({
  casbinModel: getEnvString('CASBIN_MODEL', 'model.conf'),
  jwtSecret: getJwtSecret('JWT_SECRET'),
  jwtExpiresIn: getEnvNumber('JWT_EXPIRE_IN', 60 * 30),
  refreshJwtSecret: getJwtSecret('REFRESH_TOKEN_SECRET'),
  refreshJwtExpiresIn: getEnvNumber('REFRESH_TOKEN_EXPIRE_IN', 60 * 60 * 24 * 7),
  signReqTimestampDisparity: getEnvNumber(
    'SIGN_REQ_TIMESTAMP_DISPARITY',
    5 * 60 * 1000,
  ),
  signReqNonceTTL: getEnvNumber('SIGN_REQ_NONCE_TTL', 300),
}));

export type ISecurityConfig = ConfigType<typeof SecurityConfig>;
