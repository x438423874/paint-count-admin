import { createRouter, createWebHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'

import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

import type { EnhancedRouteLocation } from './types'
import { useRouteCacheStore, useUserStore } from '@/stores'

import { isLogin, isTokenExpired, clearToken } from '@/utils/auth'
import setPageTitle from '@/utils/set-page-title'

NProgress.configure({ showSpinner: true, parent: '#app' })

const router = createRouter({
  history: createWebHistory(import.meta.env.VITE_APP_PUBLIC_PATH),
  routes,
  scrollBehavior() {
    return { top: 0, left: 0 }
  },
})

// This will update routes at runtime without reloading the page
if (import.meta.hot)
  handleHotUpdate(router)

// 不需要登录的页面
const whiteList = ['Login']

router.beforeEach(async (to: EnhancedRouteLocation) => {
  NProgress.start()

  const routeCacheStore = useRouteCacheStore()
  const userStore = useUserStore()

  // Route cache
  routeCacheStore.addRoute(to)

  // Set page title
  setPageTitle(to.name)

  if (isLogin() && !isTokenExpired()) {
    if (!userStore.userInfo?.uid)
      await userStore.info()

    if (to.name === 'Login') {
      router.replace({ name: 'Home' })
      return
    }
  }
  else {
    clearToken()

    if (!whiteList.includes(to.name as string)) {
      router.replace({ name: 'Login', query: { redirect: to.fullPath } })
      return
    }
  }
})

router.afterEach(() => {
  NProgress.done()
})

export default router
