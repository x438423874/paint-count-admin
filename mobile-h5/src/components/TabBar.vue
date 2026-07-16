<script setup lang="ts">
import { rootRouteList } from '@/config/routes'

const route = useRoute()

const show = computed(() => {
  if (route.name && rootRouteList.includes(route.name as any))
    return true
  return false
})

const active = computed(() => {
  const index = rootRouteList.indexOf(route.name as string)
  return index >= 0 ? index : 0
})
</script>

<template>
  <van-tabbar v-if="show" v-model="active" route placeholder safe-area-inset-bottom>
    <van-tabbar-item replace to="/" icon="home-o">
      首页
    </van-tabbar-item>
    <van-tabbar-item replace to="/work-order" icon="orders-o">
      工单
    </van-tabbar-item>
    <van-tabbar-item replace to="/statistics" icon="chart-trending-o">
      统计
    </van-tabbar-item>
    <van-tabbar-item replace to="/profile" icon="user-o">
      我的
    </van-tabbar-item>
  </van-tabbar>
</template>
