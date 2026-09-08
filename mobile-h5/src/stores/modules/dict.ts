import { defineStore } from 'pinia'
import { getShopList } from '@/api/paint'
import type { PaintShop } from '@/api/types/paint'

/**
 * 业务字典共享缓存
 *
 * 目的：门店等低频变动数据在整个会话内共享，避免每个页面进入时重复请求
 * （原先 index / statistics / work-order(index,create,detail) / pending-image
 * 6 个页面各自 await getShopList()，切页即重复打接口）。
 *
 * 策略：
 * - TTL 过期才重新拉取，有效期内直接命中缓存
 * - 并发去重：同一时刻只发一个请求，其余调用方复用同一个 promise
 * - 请求失败保留旧数据且不刷新时间戳，下次仍会重试
 */
const SHOP_TTL = 5 * 60 * 1000

const useDictStore = defineStore('dict', () => {
  const shops = ref<PaintShop[]>([])
  const shopsLoading = ref(false)
  /** 上次成功加载的时间戳，0 表示从未加载 */
  const shopsLoadedAt = ref(0)

  // 并发去重用的在途请求；latestReq 用于避免 force 刷新时的竞态覆盖
  let shopsPromise: Promise<PaintShop[]> | null = null
  let latestReq = 0

  async function fetchShops(reqId: number): Promise<PaintShop[]> {
    shopsLoading.value = true
    try {
      const res = await getShopList()
      const list = (res as any as PaintShop[]) || []
      shops.value = list
      shopsLoadedAt.value = Date.now()
      return list
    }
    catch {
      // 失败时保留旧数据，不刷新时间戳（下次继续重试）
      return shops.value
    }
    finally {
      shopsLoading.value = false
      // 只有最新一次请求才负责清理在途标记
      if (reqId === latestReq)
        shopsPromise = null
    }
  }

  /**
   * 获取门店列表：命中缓存直接返回，否则发起请求
   * @param force 是否强制刷新（新增/编辑门店后使用）
   */
  async function ensureShops(force = false): Promise<PaintShop[]> {
    if (!force) {
      const fresh = shops.value.length > 0 && Date.now() - shopsLoadedAt.value < SHOP_TTL
      if (fresh)
        return shops.value
      if (shopsPromise)
        return shopsPromise
    }

    const reqId = ++latestReq
    shopsPromise = fetchShops(reqId)
    return shopsPromise
  }

  /** 强制刷新门店列表 */
  function refreshShops(): Promise<PaintShop[]> {
    return ensureShops(true)
  }

  /** 手动失效缓存（退出登录或权限变更后调用，下次访问自动重拉） */
  function invalidateShops() {
    shops.value = []
    shopsLoadedAt.value = 0
    shopsPromise = null
  }

  return {
    shops,
    shopsLoading,
    ensureShops,
    refreshShops,
    invalidateShops,
  }
})

export default useDictStore
