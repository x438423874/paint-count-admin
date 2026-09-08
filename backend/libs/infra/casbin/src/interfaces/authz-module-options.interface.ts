import {
  ExecutionContext,
  Provider,
  DynamicModule,
  ForwardReference,
  Type,
} from '@nestjs/common';

import { IAuthentication } from '@lib/typings/global';

export interface AuthZModuleOptions<T = any> {
  model?: string;
  policy?: string | Promise<T>;
  userFromContext: (context: ExecutionContext) => IAuthentication;
  /**
   * 可选：Redis 角色缓存不可用/为空时的兜底角色解析（通常回退查数据库）。
   * 不提供时，Redis 故障将导致鉴权请求失败（fail-closed）。
   */
  resolveUserRolesFallback?: (uid: string) => Promise<string[]>;
  enforcerProvider?: Provider<any>;
  /**
   * Optional list of imported modules that export the providers which are
   * required in this module.
   */
  imports?: Array<
    Type<any> | DynamicModule | Promise<DynamicModule> | ForwardReference
  >;
}
