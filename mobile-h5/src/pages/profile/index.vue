<script setup lang="ts">
import { useUserStore } from '@/stores'

const router = useRouter()
const userStore = useUserStore()
const userInfo = computed(() => userStore.userInfo)

function handleLogout() {
  showDialog({
    title: '确认退出',
    message: '确认退出登录？',
  }).then(async () => {
    await userStore.logout()
    router.replace({ name: 'Login' })
  }).catch(() => {})
}
</script>

<template>
  <div class="me-page">
    <!-- 用户信息头部 -->
    <div class="user-header">
      <div class="header-bg" />
      <div class="user-info">
        <div class="avatar-wrap">
          <van-icon name="user-o" size="40" color="#fff" />
        </div>
        <div class="user-detail">
          <div class="user-name">
            {{ userInfo.nickname || userInfo.username || '未登录' }}
          </div>
          <div class="user-role">
            {{ userInfo.roles?.join(', ') || '普通用户' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 功能列表 -->
    <div class="menu-section">
      <van-cell title="我的工单" icon="orders-o" is-link to="/work-order" />
      <van-cell title="数据统计" icon="chart-trending-o" is-link to="/statistics" />
      <van-cell title="拍照建单" icon="photograph" is-link :to="{ name: 'WorkOrderCreate' }" />
    </div>

    <!-- 设置列表 -->
    <div class="menu-section">
      <van-cell title="系统设置" icon="setting-o" />
      <van-cell title="关于系统" icon="info-o" />
    </div>

    <!-- 退出登录 -->
    <div class="logout-section">
      <van-button block round plain type="danger" @click="handleLogout">
        退出登录
      </van-button>
    </div>
  </div>
</template>

<route lang="json5">
{
  name: 'Profile'
}
</route>

<style lang="less" scoped>
.me-page {
  min-height: 100vh;
  background: #f5f7fa;
}

.user-header {
  position: relative;
  height: 180px;
}

.header-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #1677ff 0%, #4096ff 100%);
  border-radius: 0 0 20px 20px;
}

.user-info {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
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
  gap: 4px;
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

.menu-section {
  margin: 12px 16px;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.logout-section {
  padding: 20px 16px;
}
</style>
