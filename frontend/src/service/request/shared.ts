import { useAuthStore } from '@/store/modules/auth';
import { localStg } from '@/utils/storage';
import { fetchRefreshToken } from '../api';
import type { RequestInstanceState } from './type';

export function getAuthorization() {
  const token = localStg.get('token');
  const Authorization = token ? `Bearer ${token}` : null;

  return Authorization;
}

/** refresh token */
async function handleRefreshToken() {
  const { resetStore } = useAuthStore();

  const rToken = localStg.get('refreshToken') || '';
  const { error, data } = await fetchRefreshToken(rToken);
  if (!error) {
    localStg.set('token', data.token);
    localStg.set('refreshToken', data.refreshToken);
    return true;
  }

  resetStore();

  return false;
}

export async function handleExpiredRequest(state: RequestInstanceState) {
  if (!state.refreshTokenFn) {
    state.refreshTokenFn = handleRefreshToken();
  }

  const success = await state.refreshTokenFn;

  setTimeout(() => {
    state.refreshTokenFn = null;
  }, 1000);

  return success;
}

export function showErrorMsg(state: RequestInstanceState, message: string) {
  if (!state.errMsgStack?.length) {
    state.errMsgStack = [];
  }

  const isExist = state.errMsgStack.includes(message);

  if (!isExist) {
    state.errMsgStack.push(message);

    window.$message?.error(message, {
      onLeave: () => {
        state.errMsgStack = state.errMsgStack.filter(msg => msg !== message);

        setTimeout(() => {
          state.errMsgStack = [];
        }, 5000);
      }
    });
  }
}

/** 解析 token 剩余有效时间（秒） */
function getTokenRemainingTime(): number {
  const token = localStg.get('token');
  if (!token) return -1;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return -1;
    return payload.exp - Math.floor(Date.now() / 1000);
  }
  catch {
    return -1;
  }
}

let proactiveRefreshPromise: Promise<boolean> | null = null;

/** token 即将过期时主动刷新 */
export async function tryProactiveRefresh() {
  const remaining = getTokenRemainingTime();
  // 小于 120 秒则主动刷新
  if (remaining < 0 || remaining > 120) return true;

  if (!proactiveRefreshPromise) {
    proactiveRefreshPromise = handleRefreshToken();
  }
  const success = await proactiveRefreshPromise;
  proactiveRefreshPromise = null;
  return success;
}
