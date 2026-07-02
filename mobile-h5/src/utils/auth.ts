import { STORAGE_TOKEN_KEY, STORAGE_REFRESH_TOKEN_KEY } from '@/stores/mutation-type'

const token = useLocalStorage(STORAGE_TOKEN_KEY, '')
const refreshToken = useLocalStorage(STORAGE_REFRESH_TOKEN_KEY, '')

function isLogin() {
  return !!token.value
}

function getToken() {
  return token.value
}

function setToken(newToken: string) {
  token.value = newToken
}

function getRefreshToken() {
  return refreshToken.value
}

function setRefreshToken(newToken: string) {
  refreshToken.value = newToken
}

function clearToken() {
  token.value = ''
  refreshToken.value = ''
}

/** 解析 JWT payload 中的 exp，判断 token 是否已过期（预留 60 秒缓冲） */
function isTokenExpired(): boolean {
  const accessToken = getToken()
  if (!accessToken)
    return true

  try {
    const payloadBase64 = accessToken.split('.')[1]
    if (!payloadBase64)
      return true

    const payload = JSON.parse(atob(payloadBase64))
    if (!payload.exp || typeof payload.exp !== 'number')
      return false

    // 预留 60 秒缓冲，避免在边界时刻请求失败
    return Date.now() >= (payload.exp - 60) * 1000
  }
  catch {
    return true
  }
}

export { isLogin, getToken, setToken, getRefreshToken, setRefreshToken, clearToken, isTokenExpired }
