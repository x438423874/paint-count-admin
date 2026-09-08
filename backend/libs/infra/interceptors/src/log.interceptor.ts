import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { OperationLogProperties } from '@app/base-system/lib/bounded-contexts/log-audit/operation-log/domain/operation-log.read.model';

import { EVENT_OPERATION_LOG_CREATED } from '@lib/constants/event-emitter-token.constant';
import { USER_AGENT } from '@lib/constants/rest.constant';
import { LOG_KEY, SKIP_LOG_KEY } from '@lib/infra/decorators/log.decorator';
import { IAuthentication } from '@lib/typings/global';

interface LogMetadata {
  moduleName: string;
  description?: string;
  logParams?: boolean;
  logBody?: boolean;
  logResponse?: boolean;
}

/** 未标注 @Log 的接口只自动记录写操作，GET 查询不记录 */
const AUTO_LOG_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 日志中需要脱敏的敏感字段 */
const SENSITIVE_KEY_PATTERN = /password|secret|token|authorization/i;
const SANITIZE_MAX_DEPTH = 6;

/** 深拷贝并脱敏：遮盖敏感字段、截断过深结构、非普通对象（Buffer/Date 等）转字符串 */
function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= SANITIZE_MAX_DEPTH) return '[MaxDepth]';
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }
  const proto = Object.getPrototypeOf(value);
  // Fastify 的 query 对象无原型（getPrototypeOf 返回 undefined），与普通对象一样按字面量展开
  if (proto !== Object.prototype && proto != null) {
    try {
      return String(value);
    } catch {
      // 无 Symbol.toPrimitive/valueOf/toString 的对象无法转字符串
      return '[Unserializable]';
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '******'
      : sanitize(val, depth + 1);
  }
  return result;
}

@Injectable()
export class LogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (this.reflector.get(SKIP_LOG_KEY, context.getHandler())) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user: IAuthentication | undefined = request.user;

    // 方法级 @Log：强制记录（含 GET 与未认证请求）；类级 @Log：仅给自动记录的写操作
    // 提供中文模块名。未标注时只自动记录已登录用户的写操作，未认证请求（登录/刷新
    // 令牌等）交给登录日志，避免把请求体里的明文凭证写进日志
    const methodMeta = this.reflector.get<LogMetadata>(
      LOG_KEY,
      context.getHandler(),
    );
    const classMeta = this.reflector.get<LogMetadata>(
      LOG_KEY,
      context.getClass(),
    );
    if (!methodMeta && (!user || !AUTO_LOG_METHODS.has(request.method))) {
      return next.handle();
    }

    const { moduleName, description, logParams, logBody, logResponse } =
      this.resolveMetadata(context, methodMeta ?? classMeta);
    const startTime = new Date();

    return next.handle().pipe(
      tap((data) => {
        try {
          const endTime = new Date();
          const duration = endTime.getTime() - startTime.getTime();
          const operationLog: OperationLogProperties = {
            userId: user?.uid ?? '',
            username: user?.username ?? '',
            domain: user?.domain ?? '',
            moduleName,
            description,
            requestId: request.id ?? '',
            method: request.method,
            url: request.routeOptions?.url ?? request.url,
            ip: request.ip,
            userAgent: (request.headers[USER_AGENT] as string) ?? null,
            params: logParams ? (sanitize(request.query) ?? null) : null,
            body:
              logBody && !this.isMultipart(request)
                ? (sanitize(request.body) ?? null)
                : null,
            response: logResponse ? (sanitize(data) ?? null) : null,
            startTime,
            endTime,
            duration,
          };

          setImmediate(() => {
            this.eventEmitter.emit(EVENT_OPERATION_LOG_CREATED, operationLog);
          });
        } catch (error) {
          // 组装日志失败只告警，绝不影响业务响应
          this.logger.error(
            `组装操作日志失败: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
          );
        }
      }),
    );
  }

  private resolveMetadata(
    context: ExecutionContext,
    metadata?: LogMetadata,
  ): Required<LogMetadata> {
    const request = context.switchToHttp().getRequest();
    const controllerName = context.getClass().name.replace(/Controller$/, '');
    return {
      moduleName: metadata?.moduleName ?? controllerName,
      description:
        metadata?.description ??
        `${request.method} ${request.routeOptions?.url ?? request.url}`,
      logParams: metadata?.logParams ?? true,
      logBody: metadata?.logBody ?? true,
      logResponse: metadata?.logResponse ?? false,
    };
  }

  /** multipart 请求体含文件片段，不能序列化进 JSON 字段 */
  private isMultipart(request: {
    headers: Record<string, string | string[] | undefined>;
  }): boolean {
    return String(request.headers['content-type'] ?? '').startsWith(
      'multipart/',
    );
  }
}
