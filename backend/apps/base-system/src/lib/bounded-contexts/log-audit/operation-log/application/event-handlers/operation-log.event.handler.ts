import { Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { EVENT_OPERATION_LOG_CREATED } from '@lib/constants/event-emitter-token.constant';

import { OperationLogWriteRepoPortToken } from '../../constants';
import { OperationLog } from '../../domain/operation-log.model';
import { OperationLogProperties } from '../../domain/operation-log.read.model';
import { OperationLogWriteRepoPort } from '../../ports/operation-log.write.repo-port';

export class OperationLogEventHandler {
  private readonly logger = new Logger(OperationLogEventHandler.name);

  constructor(
    @Inject(OperationLogWriteRepoPortToken)
    private readonly operationLogWriteRepo: OperationLogWriteRepoPort,
  ) {}

  @OnEvent(EVENT_OPERATION_LOG_CREATED)
  async handle(operationLogProperties: OperationLogProperties) {
    try {
      const operationLog = new OperationLog(operationLogProperties);
      await this.operationLogWriteRepo.save(operationLog);
    } catch (error) {
      // 审计日志写失败只记录告警，不允许影响业务请求
      this.logger.error(
        `保存操作日志失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
