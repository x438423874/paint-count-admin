import { defineStore } from 'pinia'
import type { RouteRecordName } from 'vue-router'
import type { EnhancedRouteLocation } from '@/router/types'

const useRouteCacheStore = defineStore('route-cache', () => {
  const routeCaches = ref<RouteRecordName[]>([])

  const addRoute = (route: EnhancedRouteLocation) => {
    if (routeCaches.value.includes(route.name))
      return

    if (route?.meta?.keepAlive)
      routeCaches.value.push(route.name)
  }

  /** 清空 keep-alive 缓存名单（退出/切换账号时调用，已缓存的页面实例随之销毁重建） */
  const resetRouteCaches = () => {
    routeCaches.value = []
  }

  return {
    routeCaches,
    addRoute,
    resetRouteCaches,
  }
})

export default useRouteCacheStore
