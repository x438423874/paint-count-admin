<script setup lang="ts">
import { useUserStore } from '@/stores'
import { canEdit as canEditRole } from '@/utils/permission'
import { confirmAction } from '@/composables/useConfirm'

const router = useRouter()
const userStore = useUserStore()
const userInfo = computed(() => userStore.userInfo)

const allowCreate = canEditRole()

const appVersion = ref('1.0.0')

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
            {{ userInfo.nickname || userInfo.username || '未登录' }}
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
</style>
