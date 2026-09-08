import { useAuthStore } from '@/store/modules/auth';
import { localStg } from '@/utils/storage';
import { fetchRefreshToken } from '../api';
import type { RequestInstanceState } from './type';

// ---- 跨标签页刷新协调 ----
// 让多个标签页中只有一个真正请求后端刷新，其余复用其结果（token 存于共享的 localStorage）。
// 安全降级：若浏览器不支持 BroadcastChannel，或锁发生竞态，仍回退为各标签页独立刷新；
// 后端 refresh token 的 CAS 原子消费 + handleRefreshToken 内的「用最新 token 重试」可保证最终正确，
// 不会因此协调机制破坏登录 / 刷新流程。
const REFRESH_LOCK_KEY = 'paint_refresh_lock';
const REFRESH_CHANNEL = 'paint_token_refresh';

const refreshChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(REFRESH_CHANNEL) : null;

let leaderWaiters: Array<(ok: boolean) => void> = [];

if (refreshChannel) {
  refreshChannel.onmessage = (ev: MessageEvent<{ type: 'done' | 'fail' }>) => {
    if (!leaderWaiters.length) return;
    const waiters = leaderWaiters;
    leaderWaiters = [];
    const ok = ev.data.type === 'done';
    waiters.forEach(resolve => resolve(ok));
  };
}

/** 抢占跨标签页刷新锁；成功表示本标签页作为 leader 执行刷新。 */
function claimLeader(): boolean {
  if (!refreshChannel) return true;
  const now = Date.now();
  const lock = Number(localStg.get(REFRESH_LOCK_KEY)) || 0;
  if (now - lock < 15000) return false;
  localStg.set(REFRESH_LOCK_KEY, String(now));
  return true;
}

/** follower 等待 leader 的刷新结果；带超时保护，避免 leader 崩溃后一直挂起。 */
function waitForLeader(): Promise<boolean> {
  return new Promise(resolve => {
    leaderWaiters.push(resolve);
    setTimeout(() => {
      const idx = leaderWaiters.indexOf(resolve);
      if (idx !== -1) {
        leaderWaiters.splice(idx, 1);
        resolve(false);
      }
    }, 12000);
  });
}

function notifyLeaderDone() {
  localStg.remove(REFRESH_LOCK_KEY);
  refreshChannel?.postMessage({ type: 'done' });
}

function notifyLeaderFail() {
  localStg.remove(REFRESH_LOCK_KEY);
  refreshChannel?.postMessage({ type: 'fail' });
}

export function getAuthorization() {
  const token = localStg.get('token');
  const Authorization = token ? `Bearer ${token}` : null;

  return Authorization;
}

/** refresh token */
async function handleRefreshToken() {
  const { resetStore } = useAuthStore();

  const rToken = localStg.get('refreshToken') || '';

  // 已无有效 refresh token（可能刚被其它请求触发登出并清除了本地存储），
  // 直接返回 false，不再用空 token 发请求（避免多余 401），也不重复登出/跳转
  if (!rToken) {
    return false;
  }

  const { error, data } = await fetchRefreshToken(rToken, { timeout: 10000 });
  if (!error) {
    localStg.set('token', data.token);
    localStg.set('refreshToken', data.refreshToken);
    return true;
  }

  // 多标签页场景：若其它标签页已用同一 refreshToken 刷新并写入了新 token，
  // 这里用最新的 refreshToken 重试一次，避免被 CAS 误判为「已被使用」而登出
  const latestToken = localStg.get('refreshToken') || '';
  if (latestToken && latestToken !== rToken) {
    const retry = await fetchRefreshToken(latestToken, { timeout: 10000 });
    if (!retry.error) {
      localStg.set('token', retry.data.token);
      localStg.set('refreshToken', retry.data.refreshToken);
      return true;
    }
  }

  resetStore();

  return false;
}

// 单飞：同一时间仅执行一次刷新，避免并发刷新触发 refresh token 的 CAS 原子消费冲突
// （并发两次刷新会同时使用同一 refreshToken，第二次因已被消费而 401，导致误登出）
let refreshPromise: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      // 跨标签页协调：follower 直接等待 leader 的广播结果，不再重复请求后端
      if (!claimLeader()) {
        const ok = await waitForLeader();
        if (ok) return true;
        // leader 失败或超时：本标签页尝试接管（先清除可能残留的过期锁）
        localStg.remove(REFRESH_LOCK_KEY);
        if (!claimLeader()) {
          return waitForLeader();
        }
      }

      const ok = await handleRefreshToken();
      if (ok) notifyLeaderDone();
      else notifyLeaderFail();
      return ok;
    })().finally(() => {
      setTimeout(() => {
        refreshPromise = null;
      }, 1000);
    });
  }

  return refreshPromise;
}

export async function handleExpiredRequest() {
  return doRefresh();
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
  } catch {
    return -1;
  }
}

/** token 即将过期时主动刷新 */
export async function tryProactiveRefresh() {
  const token = localStg.get('token');
  // 未登录（无 token）：无需刷新，直接放行请求（如登录接口本身需要无 token 发出）
  if (!token) return true;

  const remaining = getTokenRemainingTime();
  // 剩余有效期 <= 120s（含已过期）时主动刷新，避免请求中途过期或白跑一次 401
  if (remaining > 120) return true;

  return doRefresh();
}
