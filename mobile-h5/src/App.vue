<script setup lang="ts">
import { useRouteCacheStore } from '@/stores'

useHead({
  title: '喷漆幅数管理',
  meta: [
    {
      name: 'description',
      content: '喷漆幅数管理系统 - 移动端工作台',
    },
    {
      name: 'theme-color',
      content: () => isDark.value ? '#0B0A0A' : '#ffffff',
    },
  ],
})

const routeCacheStore = useRouteCacheStore()

const keepAliveRouteNames = computed(() => {
  return routeCacheStore.routeCaches
})

const mode = computed(() => {
  return isDark.value ? 'dark' : 'light'
})
</script>

<template>
  <van-config-provider :theme="mode">
    <nav-bar />
    <router-view v-slot="{ Component }">
      <section class="app-wrapper">
        <keep-alive :include="keepAliveRouteNames">
          <component :is="Component" />
        </keep-alive>
      </section>
    </router-view>
    <tab-bar />
  </van-config-provider>
</template>

<style scoped>
.app-wrapper {
  width: 100%;
  position: relative;
}
</style>
