import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import axios from 'axios'
import { showNotify } from 'vant'
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

// 刷新 token 状态管理
let refreshing = false
let taskQueue: Array<{ resolve: (value: any) => void; reject: (reason?: any) => void; config: any }> = []

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
      if (refreshTokenValue && !refreshing) {
        refreshing = true
        return new Promise((resolve, reject) => {
          taskQueue.push({ resolve, reject, config: error.config })
          if (taskQueue.length === 1) {
            doRefreshToken()
          }
        })
      }
      else if (refreshing) {
        return new Promise((resolve, reject) => {
          taskQueue.push({ resolve, reject, config: error.config })
        })
      }
      else {
        clearToken()
        window.location.href = '/login'
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
    })
    if (data.code === 200 || data.code === 0) {
      setToken(data.data.token)
      setRefreshToken(data.data.refreshToken)
      // 重放队列中的请求
      const queue = [...taskQueue]
      taskQueue = []
      queue.forEach(task => task.resolve(request(task.config)))
    }
    else {
      throw new Error('刷新token失败')
    }
  }
  catch {
    clearToken()
    // 刷新失败，reject 队列中的所有 Promise，避免悬挂
    const queue = [...taskQueue]
    taskQueue = []
    queue.forEach(task => task.reject(new Error('token刷新失败')))
    window.location.href = '/login'
  }
  finally {
    refreshing = false
  }
}

// 请求拦截器
function requestHandler(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig> {
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
