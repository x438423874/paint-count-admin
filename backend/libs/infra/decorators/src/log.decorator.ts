import { SetMetadata } from '@nestjs/common';

interface LogOptions {
  logParams?: boolean;
  logBody?: boolean;
  logResponse?: boolean;
}

export const LOG_KEY = 'log';
/** 方法级：强制记录该请求；类级：仅给自动记录的写操作提供模块名/描述 */
export const Log = (
  moduleName: string,
  description?: string,
  options?: LogOptions,
) => SetMetadata(LOG_KEY, { moduleName, description, ...options });

export const SKIP_LOG_KEY = 'skipLog';
/** 标记不需要记录操作日志的接口（方法级），优先于 @Log 和自动记录 */
export const SkipLog = () => SetMetadata(SKIP_LOG_KEY, true);
