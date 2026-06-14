import { Controller, Get, Post, Param, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiRes } from '@lib/infra/rest/res.response';
import { ScheduledTaskManager, ScheduledTaskInfo } from '../scheduled-task-manager.service';

@ApiTags('定时任务管理')
@Controller('scheduled-tasks')
export class ScheduledTaskController {
  constructor(private readonly taskManager: ScheduledTaskManager) {}

  @Get()
  @ApiOperation({ summary: '获取所有定时任务列表' })
  getAll(): ApiRes<ScheduledTaskInfo[]> {
    const data = this.taskManager.getAll();
    return ApiRes.success(data);
  }

  @Get(':name')
  @ApiOperation({ summary: '获取指定定时任务详情' })
  get(@Param('name') name: string): ApiRes<ScheduledTaskInfo> {
    const info = this.taskManager.get(name);
    if (!info) {
      throw new NotFoundException(`定时任务 "${name}" 不存在`);
    }
    return ApiRes.success(info);
  }

  @Post(':name/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启动指定定时任务' })
  start(@Param('name') name: string): ApiRes<null> {
    this.taskManager.start(name);
    return ApiRes.success(null, `定时任务 "${name}" 已启动`);
  }

  @Post(':name/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停止指定定时任务' })
  stop(@Param('name') name: string): ApiRes<null> {
    this.taskManager.stop(name);
    return ApiRes.success(null, `定时任务 "${name}" 已停止`);
  }
}
