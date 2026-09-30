import { defineStore } from 'pinia'
import type { LoginData, UserState } from '@/api/user'
import { clearToken, getRefreshToken, setRefreshToken, setToken } from '@/utils/auth'
import {
  getUserInfo,
  login as userLogin,
  logout as userLogout,
} from '@/api/user'
import useDictStore from './dict'
import useRouteCacheStore from './routeCache'
import { resetScopeCache } from '@/utils/tenure'
import { resetPermsCache } from '@/utils/permission'
import { clearLoginCredential } from '@/utils/auth'

const InitUserInfo: UserState = {
  uid: 0,
  nickname: '',
  avatar: '',
  username: '',
  roles: [],
}

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<UserState>({ ...InitUserInfo })

  const setInfo = (partial: Partial<UserState>) => {
    userInfo.value = { ...userInfo.value, ...partial }
  }

  const login = async (loginForm: LoginData) => {
    try {
      const data = await userLogin(loginForm)
      setToken(data.token)
      setRefreshToken(data.refreshToken)
      await info()
    }
    catch (error) {
      clearToken()
      throw error
    }
  }

  const info = async () => {
    try {
      const data = await getUserInfo()
      setInfo({
        uid: data.userId as any,
        userId: data.userId,
        username: data.userName || data.username,
        nickname: data.userName || data.username || data.nickname,
        roles: data.roles || [],
      })
      // 用户信息就绪后预取权限点集合（登录/刷新统一入口；动态 import 避免循环依赖）
      import('@/utils/permission').then(m => m.fetchMyPerms())
    }
    catch (error) {
      clearToken()
      throw error
    }
  }

  const logout = async () => {
    try {
      await userLogout(getRefreshToken())
    }
    catch {
      // 即使后端退出接口报错，也继续本地清理
    }
    finally {
      clearToken()
      setInfo({ ...InitUserInfo })
      clearLocalSession()
    }
  }

  return {
    userInfo,
    info,
    login,
    logout,
  }
}, {
  persist: true,
})

/**
 * 清除本地会话遗留数据（退出登录 / token 失效强制登出共用）：
 * - 模块级缓存：my-scope（数据权限/在岗期）、权限点
 * - 门店字典缓存：不同账号可见门店不同，必须失效重拉
 * - keep-alive 页面实例：上一账号的列表/筛选/滚动位置不能带给新账号
 * - 临时会话数据：列表筛选状态、来源标记等
 * - 记住的账号密码：属于上一账号
 */
export function clearLocalSession() {
  resetScopeCache()
  resetPermsCache()
  useDictStore().invalidateShops()
  useRouteCacheStore().resetRouteCaches()
  sessionStorage.clear()
  clearLoginCredential()
}

export default useUserStore
