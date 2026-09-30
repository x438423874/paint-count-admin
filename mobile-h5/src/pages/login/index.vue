<script setup lang="ts">
import { onMounted } from 'vue'
import { useUserStore } from '@/stores'
import { LOGIN_CREDENTIAL_KEY } from '@/utils/auth'

const router = useRouter()
const userStore = useUserStore()
const loading = ref(false)

const form = reactive({
  identifier: '',
  password: '',
})

// 记住密码：勾选后在本地保存账号与密码，下次进入自动回填
const rememberPwd = ref(false)

// 轻量可逆加密：XOR 混淆后再 base64，避免密码以明文存于 localStorage
const PWD_SECRET = 'paint-count-h5@2026'

function encryptPwd(pwd: string): string {
  if (!pwd) return ''
  let out = ''
  for (let i = 0; i < pwd.length; i++) {
    out += String.fromCharCode(pwd.charCodeAt(i) ^ PWD_SECRET.charCodeAt(i % PWD_SECRET.length))
  }
  const bytes = new TextEncoder().encode(out)
  let bin = ''
  bytes.forEach(b => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function decryptPwd(cipher: string): string {
  const bin = atob(cipher)
  const out = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
  let text = ''
  for (let i = 0; i < out.length; i++) {
    text += String.fromCharCode(out.charCodeAt(i) ^ PWD_SECRET.charCodeAt(i % PWD_SECRET.length))
  }
  return text
}

function safeDecrypt(cipher: string): string {
  try {
    return decryptPwd(cipher)
  } catch (e) {
    return cipher // 兼容未加密的旧数据
  }
}

function loadCredential() {
  try {
    const raw = localStorage.getItem(LOGIN_CREDENTIAL_KEY)
    if (raw) {
      const cred = JSON.parse(raw)
      form.identifier = cred.identifier ?? form.identifier
      if (cred.password) {
        form.password = safeDecrypt(cred.password)
      }
      rememberPwd.value = true
    }
  } catch (e) {}
}

function saveCredential() {
  if (rememberPwd.value) {
    localStorage.setItem(LOGIN_CREDENTIAL_KEY, JSON.stringify({ identifier: form.identifier, password: encryptPwd(form.password) }))
  } else {
    localStorage.removeItem(LOGIN_CREDENTIAL_KEY)
  }
}

onMounted(loadCredential)

async function handleLogin() {
  if (!form.identifier.trim()) {
    showNotify({ type: 'warning', message: '请输入用户名' })
    return
  }
  if (form.identifier.trim().length < 4) {
    showNotify({ type: 'warning', message: '用户名不能少于4位' })
    return
  }
  if (!form.password.trim()) {
    showNotify({ type: 'warning', message: '请输入密码' })
    return
  }
  if (form.password.trim().length < 6) {
    showNotify({ type: 'warning', message: '密码不能少于6位' })
    return
  }

  loading.value = true
  try {
    await userStore.login(form)
    saveCredential()
    const { redirect } = router.currentRoute.value.query as any
    if (redirect) {
      router.push(redirect)
    }
    else {
      router.push({ name: 'Home' })
    }
  }
  catch (error: any) {
    // 优先取后端返回的业务文案；axios HTTP 错误的 error.message 是英文默认值，放最后
    const message = error?.response?.data?.message || error?.response?.data?.error?.message || error?.message || '登录失败'
    showNotify({ type: 'danger', message })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <!-- 顶部装饰 -->
    <div class="login-header">
      <div class="header-bg" />
      <div class="header-content">
        <div class="logo-wrap">
          <div class="logo-icon">
            <van-icon name="brush-o" size="40" color="#fff" />
          </div>
        </div>
        <div class="app-title">
          喷漆幅数管理
        </div>
        <div class="app-subtitle">
          移动端工作台
        </div>
      </div>
    </div>

    <!-- 登录表单 -->
    <div class="login-form">
      <div class="form-card">
        <van-field
          v-model="form.identifier"
          placeholder="请输入用户名"
          left-icon="manager-o"
          clearable
          @keyup.enter="handleLogin"
        />
        <van-field
          v-model="form.password"
          type="password"
          placeholder="请输入密码"
          left-icon="lock"
          clearable
          @keyup.enter="handleLogin"
        />
      </div>

      <div class="remember-row">
        <van-checkbox v-model="rememberPwd">记住密码</van-checkbox>
      </div>

      <van-button
        type="primary"
        block
        round
        :loading="loading"
        loading-text="登录中..."
        class="login-btn"
        @click="handleLogin"
      >
        登 录
      </van-button>
    </div>
  </div>
</template>

<route lang="json5">
{
  name: 'Login'
}
</route>

<style lang="less" scoped>
.login-page {
  min-height: 100vh;
  background: var(--color-bg);
}

.login-header {
  position: relative;
  height: 250px;
  overflow: hidden;
}

.header-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 60%, #fff) 50%, #fff 100%);
  border-radius: 0 0 30px 30px;
}

.header-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 70px;
}

.logo-wrap {
  margin-bottom: 12px;
}

.logo-icon {
  width: 60px;
  height: 60px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(10px);
}

.app-title {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 2px;
}

.app-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 4px;
}

.login-form {
  padding: 30px 24px 0;
}

.form-card {
  background: var(--color-surface);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);

  :deep(.van-field) {
    padding: 14px 16px;
  }

  :deep(.van-field + .van-field) {
    border-top: 1px solid var(--neutral-100);
  }
}

.remember-row {
  display: flex;
  justify-content: flex-start;
  padding: 16px 4px 0;
  font-size: 14px;
  color: var(--color-text, #323233);
}

.login-btn {
  margin-top: 30px;
  height: 48px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 4px;
  background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #fff));
  border: none;
  box-shadow: 0 4px 12px rgba(22, 119, 255, 0.35);
}
</style>
