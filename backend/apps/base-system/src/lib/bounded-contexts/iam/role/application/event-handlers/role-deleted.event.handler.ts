import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { RoleWriteRepoPortToken } from '../../constants';
import { RoleDeletedEvent } from '../../domain/events/role-deleted.event';
import { RoleWriteRepoPort } from '../../ports/role.write.repo-port';

@EventsHandler(RoleDeletedEvent)
export class RoleDeletedHandler implements IEventHandler<RoleDeletedEvent> {
  @Inject(RoleWriteRepoPortToken)
  private readonly roleWriteRepository: RoleWriteRepoPort;

  async handle(event: RoleDeletedEvent) {
    // 角色删除：级联清理 sys_role_menu（含按钮型绑定）；casbin 已废弃
    await this.roleWriteRepository.deleteRoleMenuByRoleId(event.roleId);
    Logger.log(
      `RoleMenu deleted, RoleDeleted Event is ${JSON.stringify(event)}`,
      '[role] RoleDeletedHandler',
    );
  }
}
