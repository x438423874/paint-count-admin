<script setup lang="ts">
import { useUserStore } from '@/stores'
import { canEdit as canEditRole } from '@/utils/permission'
import { confirmAction } from '@/composables/useConfirm'
import { changePassword, getUserProfile, updateUserProfile } from '@/api/user'

const router = useRouter()
const userStore = useUserStore()
const userInfo = computed(() => userStore.userInfo)

const allowCreate = canEditRole()

const appVersion = ref('1.0.0')

// ==================== 个人资料 ====================
const profile = ref<{ nickName?: string, phoneNumber?: string, email?: string } | null>(null)
const profileLoading = ref(false)

async function loadProfile() {
  profileLoading.value = true
  try {
    const res: any = await getUserProfile()
    profile.value = { nickName: res?.nickName || '', phoneNumber: res?.phoneNumber || '', email: res?.email || '' }
  }
  catch {
    profile.value = null
  }
  finally {
    profileLoading.value = false
  }
}

// ==================== 编辑资料 ====================
const editPopup = reactive({ show: false, submitting: false })
const editForm = reactive({ nickName: '', phoneNumber: '', email: '' })

function openEditProfile() {
  editForm.nickName = profile.value?.nickName || ''
  editForm.phoneNumber = profile.value?.phoneNumber || ''
  editForm.email = profile.value?.email || ''
  editPopup.show = true
}

async function submitProfile() {
  if (!editForm.nickName.trim()) {
    showNotify({ type: 'warning', message: '请输入昵称' })
    return
  }
  if (editForm.phoneNumber && !/^1[3-9]\d{9}$/.test(editForm.phoneNumber)) {
    showNotify({ type: 'warning', message: '手机号格式不正确' })
    return
  }
  editPopup.submitting = true
  try {
    const res: any = await updateUserProfile({
      nickName: editForm.nickName.trim(),
      phoneNumber: editForm.phoneNumber || undefined,
      email: editForm.email || undefined,
    })
    profile.value = { nickName: res?.nickName || '', phoneNumber: res?.phoneNumber || '', email: res?.email || '' }
    editPopup.show = false
    showNotify({ type: 'success', message: '资料已更新' })
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '保存失败' })
  }
  finally {
    editPopup.submitting = false
  }
}

// ==================== 修改密码 ====================
const pwdPopup = reactive({ show: false, submitting: false })
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

function openChangePassword() {
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdForm.confirmPassword = ''
  pwdPopup.show = true
}

async function submitPassword() {
  if (!pwdForm.oldPassword) {
    showNotify({ type: 'warning', message: '请输入旧密码' })
    return
  }
  if (pwdForm.newPassword.length < 6) {
    showNotify({ type: 'warning', message: '新密码至少 6 位' })
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    showNotify({ type: 'warning', message: '两次输入的新密码不一致' })
    return
  }
  pwdPopup.submitting = true
  try {
    await changePassword(pwdForm.oldPassword, pwdForm.newPassword)
    pwdPopup.show = false
    showNotify({ type: 'success', message: '密码已修改，请重新登录' })
    await userStore.logout()
    router.replace({ name: 'Login' })
  }
  catch (e: any) {
    showNotify({ type: 'danger', message: e?.message || '修改失败' })
  }
  finally {
    pwdPopup.submitting = false
  }
}

onMounted(() => {
  loadProfile()
})

function handleLogout() {
  confirmAction({
    title: '确认退出',
    message: '退出后需要重新登录',
  }).then(async () => {
    await userStore.logout()
    router.replace({ name: 'Login' })
  }).catch(() => {})
}

function clearCache() {
  sessionStorage.clear()
  showNotify({ type: 'success', message: '缓存已清除' })
}
</script>

<template>
  <div class="profile-page">
    <!-- 用户信息头部 -->
    <div class="user-header">
      <div class="header-bg" />
      <div class="user-info">
        <div class="avatar-wrap">
          <van-icon name="user-o" size="36" color="#fff" />
        </div>
        <div class="user-detail">
          <div class="user-name">
            {{ profile?.nickName || userInfo.nickname || userInfo.username || '未登录' }}
          </div>
          <div class="user-role">
            {{ userInfo.roles?.join('、') || '普通用户' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷功能 -->
    <div class="quick-grid">
      <div class="quick-item" @click="router.push({ name: 'WorkOrder' })">
        <div class="quick-icon blue">
          <van-icon name="orders-o" size="22" color="#fff" />
        </div>
        <span class="quick-text">我的工单</span>
      </div>
      <div v-if="allowCreate" class="quick-item" @click="router.push({ name: 'WorkOrderCreate' })">
        <div class="quick-icon green">
          <van-icon name="photograph" size="22" color="#fff" />
        </div>
        <span class="quick-text">拍照建单</span>
      </div>
      <div class="quick-item" @click="router.push({ name: 'Statistics' })">
        <div class="quick-icon orange">
          <van-icon name="chart-trending-o" size="22" color="#fff" />
        </div>
        <span class="quick-text">数据统计</span>
      </div>
      <div class="quick-item" @click="router.push({ name: 'Vehicle' })">
        <div class="quick-icon purple">
          <van-icon name="logistics" size="22" color="#fff" />
        </div>
        <span class="quick-text">车辆管理</span>
      </div>
    </div>

    <!-- 设置列表 -->
    <div class="menu-section">
      <van-cell title="编辑资料" icon="user-edit-o" is-link @click="openEditProfile" />
      <van-cell title="修改密码" icon="shield-o" is-link @click="openChangePassword" />
      <van-cell title="清除缓存" icon="delete-o" is-link @click="clearCache" />
      <van-cell title="关于系统" icon="info-o" is-link>
        <template #right-icon>
          <span class="version-text">v{{ appVersion }}</span>
        </template>
      </van-cell>
    </div>

    <!-- 退出登录 -->
    <div class="logout-section">
      <van-button block round plain type="danger" @click="handleLogout">
        退出登录
      </van-button>
    </div>

    <div style="height: 80px;" />

    <!-- 编辑资料 -->
    <van-popup v-model:show="editPopup.show" position="bottom" round style="padding: 20px">
      <div class="popup-title">编辑资料</div>
      <van-form @submit="submitProfile">
        <van-cell-group inset>
          <van-field v-model="editForm.nickName" label="昵称" placeholder="请输入昵称" required :maxlength="30" />
          <van-field v-model="editForm.phoneNumber" label="手机号" placeholder="请输入手机号" type="tel" :maxlength="11" />
          <van-field v-model="editForm.email" label="邮箱" placeholder="请输入邮箱" />
        </van-cell-group>
        <div style="margin: 16px">
          <van-button block round type="primary" :loading="editPopup.submitting" native-type="submit">
            保存
          </van-button>
        </div>
      </van-form>
    </van-popup>

    <!-- 修改密码 -->
    <van-popup v-model:show="pwdPopup.show" position="bottom" round style="padding: 20px">
      <div class="popup-title">修改密码</div>
      <van-form @submit="submitPassword">
        <van-cell-group inset>
          <van-field v-model="pwdForm.oldPassword" label="旧密码" placeholder="请输入旧密码" type="password" required />
          <van-field v-model="pwdForm.newPassword" label="新密码" placeholder="至少 6 位" type="password" required />
          <van-field v-model="pwdForm.confirmPassword" label="确认密码" placeholder="再次输入新密码" type="password" required />
        </van-cell-group>
        <div style="margin: 16px">
          <van-button block round type="primary" :loading="pwdPopup.submitting" native-type="submit">
            确认修改
          </van-button>
        </div>
      </van-form>
    </van-popup>
  </div>
</template>

<route lang="json5">
{
  name: 'Profile'
}
</route>

<style lang="less" scoped>
.profile-page {
  min-height: 100vh;
  background: var(--color-bg);
}

.user-header {
  position: relative;
  height: 170px;
}

.header-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 60%, #fff) 100%);
  border-radius: 0 0 24px 24px;
}

.user-info {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 60px 20px 0;
}

.avatar-wrap {
  width: 64px;
  height: 64px;
  border-radius: 32px;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-name {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.user-role {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 0 16px;
  margin-top: -30px;
  position: relative;
  z-index: 1;
}

.quick-item {
  background: var(--color-surface);
  border-radius: 16px;
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.quick-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.quick-icon.blue {
  background: var(--color-primary);
}

.quick-icon.green {
  background: var(--color-success);
}

.quick-icon.orange {
  background: var(--color-warning);
}

.quick-icon.purple {
  background: #722ed1;
}

.quick-text {
  font-size: 13px;
  color: var(--text-regular);
}

.menu-section {
  margin: 16px;
  background: var(--color-surface);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.03);
}

.version-text {
  font-size: 13px;
  color: var(--text-tertiary);
}

.logout-section {
  padding: 20px 16px;
}

.popup-title {
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}
</style>
