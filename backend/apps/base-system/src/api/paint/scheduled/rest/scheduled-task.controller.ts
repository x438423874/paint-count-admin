import { Controller, Get, Post, Param, HttpCode, HttpStatus, NotFoundException, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { Log } from '@lib/infra/decorators/log.decorator';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
import { ApiRes } from '@lib/infra/rest/res.response';

import { UserShopService } from '../../service/user-shop.service';
import { ScheduledTaskManager, ScheduledTaskInfo } from '../scheduled-task-manager.service';

@ApiTags('定时任务管理')
@Log('定时任务')
@Controller('scheduled-tasks')
export class ScheduledTaskController {
  constructor(
    private readonly taskManager: ScheduledTaskManager,
    private readonly userShopService: UserShopService,
  ) {}

  private async assertSuperAdmin(userId: string) {
    const isSuperAdmin = await this.userShopService.isSuperAdmin(userId);
    if (!isSuperAdmin) {
      throw new ForbiddenException('仅超级管理员可操作定时任务');
    }
  }

  @Get()
  @ApiOperation({ summary: '获取所有定时任务列表' })
  async getAll(@Request() req: AuthenticatedRequest): Promise<ApiRes<ScheduledTaskInfo[]>> {
    await this.assertSuperAdmin(req.user.uid);
    const data = this.taskManager.getAll();
    return ApiRes.success(data);
  }

  @Get(':name')
  @ApiOperation({ summary: '获取指定定时任务详情' })
  async get(@Param('name') name: string, @Request() req: AuthenticatedRequest): Promise<ApiRes<ScheduledTaskInfo>> {
    await this.assertSuperAdmin(req.user.uid);
    const info = this.taskManager.get(name);
    if (!info) {
      throw new NotFoundException(`定时任务 "${name}" 不存在`);
    }
    return ApiRes.success(info);
  }

  @Post(':name/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启动指定定时任务' })
  async start(@Param('name') name: string, @Request() req: AuthenticatedRequest): Promise<ApiRes<null>> {
    await this.assertSuperAdmin(req.user.uid);
    this.taskManager.start(name);
    return ApiRes.success(null, `定时任务 "${name}" 已启动`);
  }

  @Post(':name/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停止指定定时任务' })
  async stop(@Param('name') name: string, @Request() req: AuthenticatedRequest): Promise<ApiRes<null>> {
    await this.assertSuperAdmin(req.user.uid);
    this.taskManager.stop(name);
    return ApiRes.success(null, `定时任务 "${name}" 已停止`);
  }
}
