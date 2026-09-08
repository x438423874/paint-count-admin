import { ref } from 'vue';
import { defineStore } from 'pinia';
import { fetchPaintShopList } from '@/service/api';
import type { PaintShopListItem } from '@/service/api';
import { SetupStoreId } from '@/enum';

/**
 * paint 业务字典共享缓存
 *
 * 目的：门店等低频变动数据在整个会话内共享，避免每个页面进入时重复请求 （原先 statistics / work-order(index, drawer) / adjustment / pending-image /
 * reconcile / seal / user-shop-bind 共 8 处各自调用 fetchPaintShopList()， 切页即重复打接口；operate-drawer 每次打开还会再请求一次）。
 *
 * 策略：
 *
 * - TTL 过期才重新拉取，有效期内直接命中缓存
 * - 并发去重：同一时刻只发一个请求，其余调用方复用同一个 promise
 * - 请求失败保留旧数据且不刷新时间戳，下次仍会重试
 */
const SHOP_TTL = 5 * 60 * 1000;

export const usePaintStore = defineStore(SetupStoreId.Paint, () => {
  const shops = ref<PaintShopListItem[]>([]);
  const shopsLoading = ref(false);
  /** 上次成功加载的时间戳，0 表示从未加载 */
  let shopsLoadedAt = 0;

  // 并发去重用的在途请求
  let shopsPromise: Promise<PaintShopListItem[]> | null = null;

  async function fetchShops(): Promise<PaintShopListItem[]> {
    shopsLoading.value = true;
    try {
      const { data, error } = await fetchPaintShopList();
      if (!error && data) {
        shops.value = data;
        shopsLoadedAt = Date.now();
        return data;
      }
      // 失败时保留旧数据，不刷新时间戳（下次继续重试）
      return shops.value;
    } finally {
      shopsLoading.value = false;
      shopsPromise = null;
    }
  }

  /**
   * 确保门店已加载：命中缓存直接返回，否则发起请求
   *
   * @param force 是否强制刷新（新增/编辑门店后使用）
   */
  function ensureShops(force = false): Promise<PaintShopListItem[]> {
    if (!force) {
      const fresh = shops.value.length > 0 && Date.now() - shopsLoadedAt < SHOP_TTL;
      if (fresh) return Promise.resolve(shops.value);
      if (shopsPromise) return shopsPromise;
    }
    shopsPromise = fetchShops();
    return shopsPromise;
  }

  /** 强制刷新门店列表 */
  function refreshShops(): Promise<PaintShopListItem[]> {
    return ensureShops(true);
  }

  /** 手动失效缓存（退出登录或权限变更后调用，下次访问自动重拉） */
  function invalidateShops() {
    shops.value = [];
    shopsLoadedAt = 0;
    shopsPromise = null;
  }

  return {
    shops,
    shopsLoading,
    ensureShops,
    refreshShops,
    invalidateShops
  };
});
