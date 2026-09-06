import { request } from '../request';

/** get role list */
export function fetchGetRoleList(params?: Api.SystemManage.RoleSearchParams) {
  return request<Api.SystemManage.RoleList>({
    url: '/role',
    method: 'get',
    params
  });
}

/**
 * get all roles
 *
 * these roles are all enabled
 */
export function fetchGetAllRoles() {
  return request<Api.SystemManage.AllRole[]>({
    url: '/systemManage/getAllRoles',
    method: 'get'
  });
}

/** get user list */
export function fetchGetUserList(params?: Api.SystemManage.UserSearchParams) {
  return request<Api.SystemManage.UserList>({
    url: '/user',
    method: 'get',
    params
  });
}

/** get menu list */
export const fetchGetMenuList = () =>
  request<Api.SystemManage.Menu[]>({
    url: '/route',
    method: 'get'
  })
    .then(response => {
      const menus = response.data || [];
      return {
        data: {
          records: menus,
          total: menus.length,
          current: 1,
          size: menus.length
        },
        error: null
      };
    })
    .catch(error => {
      return {
        data: null,
        error: error.message
      };
    });

/** get all pages */
export function fetchGetAllPages() {
  return request<string[]>({
    url: '/systemManage/getAllPages',
    method: 'get'
  });
}

/** get menu tree */
export function fetchGetMenuTree() {
  return request<Api.SystemManage.Menu[]>({
    url: '/route/tree',
    method: 'get'
  });
}

export type RoleModel = Pick<Api.SystemManage.Role, 'name' | 'code' | 'description' | 'status'>;

/**
 * 创建角色
 *
 * @param req 角色实体
 * @returns nothing
 */
export function createRole(req: RoleModel) {
  return request({
    url: '/role',
    method: 'post',
    data: {
      pid: '0',
      ...req
    }
  });
}

/**
 * 更新角色
 *
 * @param req 角色实体
 * @returns nothing
 */
export function updateRole(req: RoleModel) {
  return request({
    url: '/role',
    method: 'put',
    data: req
  });
}

/**
 * 删除角色
 *
 * @param id 删除ID
 * @returns nothing
 */
export function deleteRole(id: string) {
  return request({
    url: `/role/${id}`,
    method: 'delete'
  });
}

/**
 * 获取角色对应菜单数组集合
 *
 * @param roleId 角色ID
 * @returns 菜单数组集合
 */
export function fetchGetRoleMenuIds(roleId: string) {
  return request<number[]>({
    url: `/route/auth-route/${roleId}`,
    method: 'get'
  });
}

/**
 * 角色授权菜单
 *
 * @param req 授权角色菜单实体
 * @returns nothing
 */
export function fetchAssignRoutes(req: Api.SystemManage.RoleMenu) {
  return request<boolean>({
    url: '/authorization/assign-routes',
    method: 'post',
    data: {
      ...req,
      // eslint-disable-next-line no-warning-comments
      // TODO 超级管理员主动选择 domain管理员默认自身
      domain: 'built-in'
    }
  });
}

/**
 * 角色授权API
 *
 * @param req 授权角色API实体
 * @returns nothing
 */
export function fetchAssignPermission(req: Api.SystemManage.RolePermission) {
  return request<boolean>({
    url: '/authorization/assign-permission',
    method: 'post',
    data: {
      ...req,
      // eslint-disable-next-line no-warning-comments
      // TODO 超级管理员主动选择 domain管理员默认自身
      domain: 'built-in'
    }
  });
}

export type RouteModel = Pick<
  Api.SystemManage.Menu,
  | 'menuType'
  | 'menuName'
  | 'routeName'
  | 'routePath'
  | 'component'
  | 'order'
  | 'i18nKey'
  | 'icon'
  | 'iconType'
  | 'status'
  | 'pid'
  | 'keepAlive'
  | 'constant'
  | 'href'
  | 'hideInMenu'
  | 'activeMenu'
  | 'multiTab'
  | 'fixedIndexInTab'
>;

/**
 * 创建路由
 *
 * @param req 路由实体
 * @returns nothing
 */
export function createRoute(req: RouteModel) {
  return request({
    url: '/route',
    method: 'post',
    data: req
  });
}

/**
 * 更新路由
 *
 * @param req 路由实体
 * @returns nothing
 */
export function updateRoute(req: RouteModel) {
  return request({
    url: '/route',
    method: 'put',
    data: req
  });
}

/**
 * 删除路由
 *
 * @param id 路由ID
 * @returns nothing
 */
export function deleteRoute(id: number) {
  return request({
    url: `/route/${id}`,
    method: 'delete'
  });
}

export type UserModel = Pick<
  Api.SystemManage.User,
  'username' | 'password' | 'domain' | 'nickName' | 'phoneNumber' | 'email' | 'status'
>;

/**
 * 创建用户
 *
 * @param req 用户实体
 * @returns nothing
 */
export function createUser(req: UserModel) {
  return request({
    url: '/user',
    method: 'post',
    data: req
  });
}

/**
 * 更新用户
 *
 * @param req 用户实体
 * @returns nothing
 */
export function updateUser(req: UserModel) {
  return request({
    url: '/user',
    method: 'put',
    data: req
  });
}

/**
 * 删除用户
 *
 * @param id 删除ID
 * @returns nothing
 */
export function deleteUser(id: string) {
  return request({
    url: `/user/${id}`,
    method: 'delete'
  });
}

/**
 * 获取用户已分配的角色 ID 列表
 *
 * @param userId 用户ID
 * @returns 角色 ID 数组
 */
export function fetchUserRoleIds(userId: string) {
  return request<string[]>({
    url: `/authorization/user-roles/${userId}`,
    method: 'get'
  });
}

/**
 * 给用户分配角色（全量覆盖）
 *
 * @param userId 用户ID
 * @param roleIds 角色 ID 数组，传空数组表示清空该用户的所有角色
 * @returns nothing
 */
export function assignUserRoles(userId: string, roleIds: string[]) {
  return request({
    url: '/authorization/assign-user-roles',
    method: 'post',
    data: { userId, roleIds }
  });
}

/**
 * 获取角色列表（用于分配角色时全量拉取）
 *
 * @param size 每页条数，默认拉 100 条覆盖全部角色
 * @returns 角色分页记录
 */
export function fetchGetAssignableRoles(size = 100) {
  return request<Api.SystemManage.RoleList>({
    url: '/role',
    method: 'get',
    params: { current: 1, size }
  });
}

/** get api-endpoint tree */
export function fetchGetApiEndpointTree() {
  return request<Api.SystemManage.ApiEndpoint[]>({
    url: '/api-endpoint/tree',
    method: 'get'
  });
}

/**
 * 获取角色对应API数组集合
 *
 * @param roleCode 角色code
 * @returns API数组集合
 */
export async function fetchGetRoleApiEndpoints(roleCode: string) {
  const response = await request<any[]>({
    url: `/api-endpoint/auth-api-endpoint/${roleCode}`,
    method: 'get'
  });
  const casbinRules = response.data || [];
  return casbinRules.map(item => `${item.v1}:${item.v2}`);
}
