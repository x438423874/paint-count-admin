import type { AxiosRequestConfig } from 'axios';
import { request } from '../request';

/**
 * Login
 *
 * @param identifier User name
 * @param password Password
 */
export function fetchLogin(identifier: string, password: string) {
  return request<Api.Auth.LoginToken>({
    url: '/auth/login',
    method: 'post',
    data: {
      identifier,
      password
    }
  });
}

/** Get user info */
export function fetchGetUserInfo() {
  return request<Api.Auth.UserInfo>({ url: '/auth/getUserInfo' });
}

/**
 * Refresh token
 *
 * @param refreshToken Refresh token
 */
export function fetchRefreshToken(refreshToken: string, config?: AxiosRequestConfig) {
  return request<Api.Auth.LoginToken>({
    url: '/auth/refreshToken',
    method: 'post',
    data: {
      refreshToken
    },
    ...config
  });
}

/**
 * return custom backend error
 *
 * @param code error code
 * @param msg error message
 */
export function fetchCustomBackendError(code: string, msg: string) {
  return request({ url: '/auth/error', params: { code, msg } });
}

/**
 * Logout
 *
 * Revoke the current refresh token on the backend and clear the role cache.
 *
 * @param refreshToken Current refresh token
 */
export function fetchLogout(refreshToken?: string) {
  return request({ url: '/auth/logout', method: 'post', data: { refreshToken } });
}
