import { defineStore } from 'pinia'
import type { LoginData, UserState } from '@/api/user'
import { clearToken, getRefreshToken, setRefreshToken, setToken } from '@/utils/auth'
import {
  getUserInfo,
  login as userLogin,
  logout as userLogout,
} from '@/api/user'

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

export default useUserStore
