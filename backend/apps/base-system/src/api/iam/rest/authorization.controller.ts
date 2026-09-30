import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';


import { AuthorizationService } from '@app/base-system/lib/bounded-contexts/iam/authentication/application/service/authorization.service';
import { RoleAssignRouteCommand } from '@app/base-system/lib/bounded-contexts/iam/authentication/commands/role-assign-route.command';
import { RoleAssignUserCommand } from '@app/base-system/lib/bounded-contexts/iam/authentication/commands/role-assign-user.command';
import { UserRoute } from '@app/base-system/lib/bounded-contexts/iam/menu/application/dto/route.dto';
import { MenuService } from '@app/base-system/lib/bounded-contexts/iam/menu/application/service/menu.service';

import { CacheConstant } from '@lib/constants/cache.constant';
import { AuthZGuard, UsePermissions } from '@lib/infra/casbin';
import { Log } from '@lib/infra/decorators/log.decorator';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
import { ApiRes } from '@lib/infra/rest/res.response';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import { IAuthentication } from '@lib/typings/global';

import { AssignRouteDto } from '../dto/assign-route.dto';
import { AssignUserRolesDto } from '../dto/assign-user-roles.dto';
import { AssignUserDto } from '../dto/assign-user.dto';

@UseGuards(AuthZGuard)
@ApiTags('Authorization - Module')
@Log('权限管理')
@Controller('authorization')
export class AuthorizationController {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly menuService: MenuService,
  ) {}

  @Post('assign-routes')
  @UsePermissions({ resource: 'authorization', action: 'assign-routes' })
  @ApiOperation({
    summary: 'Assign Routes to Role',
    description: 'Assigns a set of routes to a specified role within a domain.',
  })
  async assignRoutes(@Body() dto: AssignRouteDto): Promise<ApiRes<null>> {
    await this.authorizationService.assignRoutes(
      new RoleAssignRouteCommand(dto.domain, dto.roleId, dto.routeIds),
    );
    return ApiRes.ok();
  }

  @Post('assign-users')
  @UsePermissions({ resource: 'authorization', action: 'assign-users' })
  @ApiOperation({
    summary: 'Assign Users to Role',
    description: 'Assigns a set of users to a specified role',
  })
  async assignUsers(@Body() dto: AssignUserDto): Promise<ApiRes<null>> {
    await this.authorizationService.assignUsers(
      new RoleAssignUserCommand(dto.roleId, dto.userIds),
    );
    return ApiRes.ok();
  }

  @Get('user-roles/:userId')
  @UsePermissions({ resource: 'authorization', action: 'assign-users' })
  @ApiOperation({
    summary: 'Get Role IDs of a User',
    description:
      'Retrieve the role IDs currently assigned to the specified user',
  })
  async getUserRoles(
    @Param('userId') userId: string,
  ): Promise<ApiRes<string[]>> {
    return ApiRes.success(
      await this.authorizationService.getUserRoleIds(userId),
    );
  }

  @Post('assign-user-roles')
  @UsePermissions({ resource: 'authorization', action: 'assign-users' })
  @ApiOperation({
    summary: 'Assign Roles to User',
    description:
      'Replaces all roles of the specified user with the given role IDs and refreshes the cached roles',
  })
  async assignUserRoles(
    @Body() dto: AssignUserRolesDto,
  ): Promise<ApiRes<null>> {
    await this.authorizationService.assignUserRoles(dto.userId, dto.roleIds);
    return ApiRes.ok();
  }

  @Get('getUserRoutes')
  @ApiOperation({
    summary: 'Get user routes',
    description:
      'Retrieve user-specific routes based on their roles and domain.',
  })
  async getUserRoutes(@Request() req: AuthenticatedRequest): Promise<ApiRes<UserRoute>> {
    const user: IAuthentication = req.user;
    const userRoleCode = await RedisUtility.instance.smembers(
      `${CacheConstant.AUTH_TOKEN_PREFIX}${user.uid}`,
    );
    if (!userRoleCode || userRoleCode.length === 0) {
      throw new HttpException(
        'No roles found for the user',
        HttpStatus.NOT_FOUND,
      );
    }
    const routes = await this.menuService.getUserRoutes(
      userRoleCode,
      user.domain,
    );
    return ApiRes.success(routes);
  }
}
