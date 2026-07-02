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
  }
  return nameMap[route.name as string] || '喷漆幅数管理'
})

const showLeftArrow = computed(() => {
  if (route.name && rootRouteList.includes(route.name as any))
    return false
  return true
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
    :title="title"
    :fixed="true"
    :left-arrow="showLeftArrow"
    placeholder
    clickable
    @click-left="onBack"
  />
</template>
