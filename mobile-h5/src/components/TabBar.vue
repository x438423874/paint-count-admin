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

<style lang="less" scoped>
:deep(.van-tabbar-item) {
  color: var(--color-text-secondary);

  &--active {
    color: var(--color-primary);

    .van-tabbar-item__icon {
      transform: scale(1.12);
      transition: transform 0.2s ease;
    }

    .van-tabbar-item__text {
      font-weight: 600;
    }
  }
}
</style>
