import { Module, DynamicModule, Global } from '@nestjs/common';

import { AUTHZ_MODULE_OPTIONS } from './constants/authz.constants';
import { AuthZGuard } from './guards/authz.guard';
import { AuthZModuleOptions } from './interfaces';

/**
 * 授权模块（芋道式菜单权限串鉴权）。
 *
 * 历史：原基于 casbin enforcer（sys_endpoint 注册表 + casbin_rule 策略），
 * 已改为 sys_role_menu + sys_menu.permission 权限串匹配（见 AuthZGuard），
 * casbin 相关 service 文件保留但不再注册。
 */
@Global()
@Module({})
export class AuthZModule {
  static register(options: AuthZModuleOptions): DynamicModule {
    const moduleOptionsProvider = {
      provide: AUTHZ_MODULE_OPTIONS,
      useValue: options || {},
    };

    return {
      module: AuthZModule,
      providers: [moduleOptionsProvider, AuthZGuard],
      imports: options.imports || [],
      exports: [moduleOptionsProvider, AuthZGuard],
    };
  }
}
