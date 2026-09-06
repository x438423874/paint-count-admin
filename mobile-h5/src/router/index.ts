import { createRouter, createWebHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'

import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
import { showToast } from 'vant'

import type { EnhancedRouteLocation } from './types'
import { useRouteCacheStore, useUserStore } from '@/stores'

import { isLogin, isTokenExpired, clearToken } from '@/utils/auth'
import { ensureMyPerms, hasPerm, isPermsReady } from '@/utils/permission'
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

// 页面级权限：进入页面前校验权限点（入口显隐之外的双保险，防止直接输入 URL 进入）
const PAGE_PERMS: Record<string, string> = {
  '/work-order/create': 'paint:work-order:create', // 拍照建单
  '/pending-image': 'paint:work-order:create', // 图片池
}

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

    // 页面级权限校验（权限点与后端 Casbin 同一口径；加载失败宽松放行，API 层兜底）
    const requiredPerm = PAGE_PERMS[to.path]
    if (requiredPerm) {
      await ensureMyPerms()
      if (isPermsReady() && !hasPerm(requiredPerm)) {
        showToast({ message: '无权限访问该页面', forbidClick: true })
        router.replace({ name: 'Home' })
        return
      }
    }

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
