import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { PrismaService } from '@lib/shared/prisma/prisma.service';

import { MenuDeletedEvent } from '../../domain/events/menu-deleted.event';

@EventsHandler(MenuDeletedEvent)
export class MenuDeletedHandler implements IEventHandler<MenuDeletedEvent> {
  constructor(private readonly prisma: PrismaService) {}

  async handle(event: MenuDeletedEvent) {
    // 级联清理该菜单（含按钮行）在所有角色上的绑定，避免孤儿数据
    const removed = await this.prisma.sysRoleMenu.deleteMany({
      where: { menuId: event.menuId },
    });
    Logger.log(
      `Menu deleted (id=${event.menuId}), cleaned ${removed.count} role bindings`,
      '[menu] MenuDeletedHandler',
    );
  }
}
