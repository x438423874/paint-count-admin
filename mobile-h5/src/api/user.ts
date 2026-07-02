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

export function logout() {
  return request.get('/auth/logout')
}

export function getUserInfo() {
  return request.get<UserState>('/auth/getUserInfo')
}

export function refreshTokenApi(refreshToken: string) {
  return request.post<LoginRes>('/auth/refreshToken', { refreshToken })
}
