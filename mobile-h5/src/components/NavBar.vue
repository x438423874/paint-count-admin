<script setup lang="ts">
import { rootRouteList } from '@/config/routes'

const route = useRoute()
const router = useRouter()

const title = computed(() => {
  const nameMap: Record<string, string> = {
    Home: '喷漆幅数管理',
    WorkOrder: '工单列表',
    WorkOrderDetail: '工单详情',
    WorkOrderCreate: '创建工单',
    Statistics: '数据统计',
    Profile: '我的',
    Login: '登录',
    Vehicle: '车辆管理',
  }
  return nameMap[route.name as string] || '喷漆幅数管理'
})

const showLeftArrow = computed(() => {
  if (route.name && rootRouteList.includes(route.name as any))
    return false
  return true
})

// 支持 route meta.hideNavBar 隐藏全局导航栏（页面自带导航栏时使用）
const hideNavBar = computed(() => {
  return (route.meta as any)?.hideNavBar === true
})

function onBack() {
  if (window.history.state.back) {
    history.back()
  }
  else {
    router.replace('/')
  }
}
</script>

<template>
  <VanNavBar
    v-if="!hideNavBar"
    :title="title"
    :fixed="true"
    :left-arrow="showLeftArrow"
    placeholder
    clickable
    @click-left="onBack"
  />
  <!-- 隐藏时仍保留占位，防止页面布局跳动 -->
  <div v-else class="nav-bar-placeholder" />
</template>

<style scoped>
.nav-bar-placeholder {
  height: 0;
}
</style>
