import request from '@/utils/request'

export interface ApiResult<T> {
  code: number
  msg: string
  data: T
}

export interface LoginData {
  identifier: string
  password: string
}

export interface LoginRes {
  token: string
  refreshToken: string
}

export interface UserState {
  uid?: number
  userId?: string
  username?: string
  userName?: string
  nickname?: string
  avatar?: string
  roles?: string[]
}

export function login(data: LoginData) {
  return request.post<LoginRes>('/auth/login', data)
}

export function logout(refreshToken?: string) {
  return request.post('/auth/logout', { refreshToken })
}

export function getUserInfo() {
  return request.get<UserState>('/auth/getUserInfo')
}

export function refreshTokenApi(refreshToken: string) {
  return request.post<LoginRes>('/auth/refreshToken', { refreshToken })
}

// ==================== 个人资料与密码（自助） ====================

export interface UserProfile {
  userId: string
  username: string
  nickName?: string
  phoneNumber?: string
  email?: string
  avatar?: string
}

/** 查询个人资料 */
export function getUserProfile() {
  return request.get<UserProfile>('/auth/profile')
}

/** 修改个人资料（仅昵称/手机号/邮箱） */
export function updateUserProfile(data: { nickName?: string, phoneNumber?: string, email?: string }) {
  return request.put<UserProfile>('/auth/profile', data)
}

/** 修改密码（成功后所有设备需重新登录） */
export function changePassword(oldPassword: string, newPassword: string) {
  return request.put<null>('/auth/password', { oldPassword, newPassword })
}
