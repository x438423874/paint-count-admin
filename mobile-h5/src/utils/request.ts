import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import axios from 'axios'
import { showNotify } from 'vant'
import router from '@/router'
import { clearToken, getRefreshToken, getToken, setRefreshToken, setToken } from '@/utils/auth'

export const REQUEST_TOKEN_KEY = 'Authorization'

// 创建 axios 实例
const request = axios.create({
  baseURL: import.meta.env.VITE_APP_API_BASE_URL,
  timeout: 60000,
})

export type RequestError = AxiosError<{
  message?: string
  result?: any
  errorMessage?: string
}>

// ---- 跨标签页刷新协调 ----
// 让多个标签页中只有一个真正请求后端刷新，其余复用其结果（token 存于共享的 localStorage）。
// 安全降级：若浏览器不支持 BroadcastChannel，或锁发生竞态，仍回退为各标签页独立刷新；
// 后端 refresh token 的 CAS 原子消费 + 用最新 token 重试可保证最终正确，不会破坏登录 / 刷新流程。
const REFRESH_LOCK_KEY = 'paint_h5_refresh_lock'
const REFRESH_CHANNEL = 'paint_h5_token_refresh'

const refreshChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(REFRESH_CHANNEL) : null

let leaderWaiters: Array<(ok: boolean) => void> = []

if (refreshChannel) {
  refreshChannel.onmessage = (ev: MessageEvent<{ type: 'done' | 'fail' }>) => {
    if (!leaderWaiters.length) return
    const waiters = leaderWaiters
    leaderWaiters = []
    const ok = ev.data.type === 'done'
    waiters.forEach(resolve => resolve(ok))
  }
}

/** 抢占跨标签页刷新锁；成功表示本标签页作为 leader 执行刷新。 */
function claimLeader(): boolean {
  if (!refreshChannel) return true
  const now = Date.now()
  const raw = localStorage.getItem(REFRESH_LOCK_KEY)
  const lock = raw ? Number(raw) : 0
  if (now - lock < 15000) return false
  localStorage.setItem(REFRESH_LOCK_KEY, String(now))
  return true
}

/** follower 等待 leader 的刷新结果；带超时保护，避免 leader 崩溃后一直挂起。 */
function waitForLeader(): Promise<boolean> {
  return new Promise(resolve => {
    leaderWaiters.push(resolve)
    setTimeout(() => {
      const idx = leaderWaiters.indexOf(resolve)
      if (idx !== -1) {
        leaderWaiters.splice(idx, 1)
        resolve(false)
      }
    }, 12000)
  })
}

function notifyLeaderDone() {
  localStorage.removeItem(REFRESH_LOCK_KEY)
  refreshChannel?.postMessage({ type: 'done' })
}

function notifyLeaderFail() {
  localStorage.removeItem(REFRESH_LOCK_KEY)
  refreshChannel?.postMessage({ type: 'fail' })
}

// 刷新 token 状态管理
let refreshPromise: Promise<void> | null = null
let taskQueue: Array<{ resolve: (value: any) => void; reject: (reason?: any) => void; config: any }> = []

/** 用最新 token 重放队列中的请求（leader 刷新成功或 follower 收到 done 后调用） */
function replayQueue() {
  const queue = [...taskQueue]
  taskQueue = []
  queue.forEach(task => task.resolve(request(task.config)))
}

/** 拒绝队列中的所有请求（刷新失败时调用，避免悬挂） */
function rejectQueue(reason: any) {
  const queue = [...taskQueue]
  taskQueue = []
  queue.forEach(task => task.reject(reason))
}

// 单飞：同一时间仅执行一次刷新，避免并发刷新触发 refresh token 的 CAS 原子消费冲突
// （并发两次刷新会同时使用同一 refreshToken，第二次因已被消费而 401，导致误登出）
async function refreshOnce(): Promise<void> {
  if (!refreshPromise) {
    // 跨标签页协调：follower 等待 leader 结果，复用共享 localStorage 中的新 token
    if (!claimLeader()) {
      const ok = await waitForLeader()
      if (ok) {
        replayQueue()
        return
      }
      // leader 失败或超时：本标签页尝试接管（先清除可能残留的过期锁）
      localStorage.removeItem(REFRESH_LOCK_KEY)
      if (!claimLeader()) {
        const ok2 = await waitForLeader()
        if (ok2) {
          replayQueue()
          return
        }
      }
    }
    refreshPromise = doRefreshToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/** 解析 token 剩余有效时间（秒） */
function getTokenRemainingTime(): number {
  const accessToken = getToken()
  if (!accessToken) return -1
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]))
    if (!payload.exp) return -1
    return payload.exp - Math.floor(Date.now() / 1000)
  }
  catch {
    return -1
  }
}

/** token 剩余有效期 <= 120s（含已过期）时主动刷新，避免请求中途过期或白跑一次 401 */
async function tryProactiveRefresh(): Promise<boolean> {
  const accessToken = getToken()
  // 未登录（无 access token）：无需刷新，直接放行请求（如登录接口本身需要无 token 发出）
  if (!accessToken) return true

  const remaining = getTokenRemainingTime()
  if (remaining > 120) return true

  await refreshOnce()
  // 刷新成功会写入新 token；失败则已 clearToken 并跳转登录
  return !!getToken()
}

// 异常拦截处理器
function errorHandler(error: RequestError): Promise<any> {
  if (error.response) {
    const { data = {}, status } = error.response
    if (status === 403) {
      showNotify({ type: 'danger', message: (data && data.message) || '无权限' })
    }
    if (status === 401) {
      // 排除登录接口的 401，避免登录失败时重定向循环
      const requestUrl = error.config?.url || ''
      if (requestUrl.includes('/auth/login')) {
        return Promise.reject(error)
      }

      const refreshTokenValue = getRefreshToken()
      // refreshToken 自身失败直接登出，避免递归刷新；否则入队等待统一刷新后重放
      if (refreshTokenValue && !requestUrl.includes('/auth/refreshToken')) {
        return new Promise((resolve, reject) => {
          taskQueue.push({ resolve, reject, config: error.config })
          if (taskQueue.length === 1) {
            refreshOnce()
          }
        })
      }
      else {
        clearToken()
        router.replace({ name: 'Login', query: { redirect: router.currentRoute.value.fullPath } })
      }
    }
  }
  return Promise.reject(error)
}

async function doRefreshToken() {
  try {
    const refreshTokenValue = getRefreshToken()
    const { data } = await axios.post('/auth/refreshToken', { refreshToken: refreshTokenValue }, {
      baseURL: import.meta.env.VITE_APP_API_BASE_URL,
      timeout: 10000,
    })
    if (data.code === 200 || data.code === 0) {
      setToken(data.data.token)
      setRefreshToken(data.data.refreshToken)
      replayQueue()
      notifyLeaderDone()
    }
    else {
      throw new Error('刷新token失败')
    }
  }
  catch {
    clearToken()
    // 多标签页场景：若其它标签页已用同一 refreshToken 刷新并写入了新 token，用最新 token 重试一次
    const latestToken = getRefreshToken()
    if (latestToken && latestToken !== refreshTokenValue) {
      try {
        const { data: retryData } = await axios.post('/auth/refreshToken', { refreshToken: latestToken })
        setToken(retryData.token)
        setRefreshToken(retryData.refreshToken)
        replayQueue()
        notifyLeaderDone()
        return
      }
      catch {
        // 忽略，继续走登出逻辑
      }
    }
    rejectQueue(new Error('token刷新失败'))
    notifyLeaderFail()
    router.replace({ name: 'Login', query: { redirect: router.currentRoute.value.fullPath } })
  }
}

// 请求拦截器
async function requestHandler(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
  const refreshed = await tryProactiveRefresh()
  if (!refreshed) {
    // 主动刷新失败（token 已失效），终止本次请求，避免发送无 token 的脏请求
    return Promise.reject(new Error('token 刷新失败，请求已中止'))
  }
  const savedToken = getToken()
  if (savedToken)
    config.headers[REQUEST_TOKEN_KEY] = `Bearer ${savedToken}`

  return config
}

request.interceptors.request.use(requestHandler, errorHandler)

// 响应拦截器
function responseHandler(response: AxiosResponse) {
  const { data } = response
  if (data.code !== undefined && data.code !== 200 && data.code !== 0) {
    showNotify({ type: 'danger', message: data.message || data.msg || '请求错误' })
    return Promise.reject(data)
  }
  return data.data !== undefined ? data.data : data
}

request.interceptors.response.use(responseHandler, errorHandler)

interface RequestInstance extends AxiosInstance {
  <T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
  <T = any>(config: AxiosRequestConfig): Promise<T>
  get: <T = any>(url: string, config?: AxiosRequestConfig) => Promise<T>
  post: <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<T>
  put: <T = any>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<T>
  delete: <T = any>(url: string, config?: AxiosRequestConfig) => Promise<T>
}

export default request as unknown as RequestInstance
