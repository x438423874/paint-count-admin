import { computed } from 'vue'
import { useDictStore } from '@/stores'
import type { PaintShop } from '@/api/types/paint'

export interface ShopOption {
  text: string
  value: string
}

export interface UseShopOptionsOptions {
  /** 是否包含「全部门店」选项（value 为 ''），默认 true */
  includeAll?: boolean
  /** 「全部门店」文案，用于选择器选项与门店名回显，默认「全部门店」 */
  allText?: string
}

/**
 * 门店选项 composable
 *
 * 统一消费 dict store 的共享门店缓存，替代各页面各自 `getShopList()` 的写法，
 * 达到「一次会话只请求一次 + 全页面共享」的效果。
 *
 * 用法：
 * ```ts
 * const { shops, shopColumns, ensureShops, getShopName } = useShopOptions()
 * onMounted(async () => {
 *   const list = await ensureShops()   // 命中缓存不发请求
 *   if (list.length === 1) selectedShopId.value = list[0].id
 * })
 * ```
 */
export function useShopOptions(options: UseShopOptionsOptions = {}) {
  const { includeAll = true, allText = '全部门店' } = options
  const dict = useDictStore()

  const shops = computed<PaintShop[]>(() => dict.shops)
  const loading = computed(() => dict.shopsLoading)

  /** van-picker 需要的列数据 */
  const shopColumns = computed<ShopOption[]>(() => {
    const cols = shops.value.map(s => ({ text: s.name, value: s.id }))
    return includeAll ? [{ text: allText, value: '' }, ...cols] : cols
  })

  /**
   * 确保门店已加载（命中缓存不发请求）
   * @param force 强制刷新
   * @returns 门店列表，便于调用方做「仅一个门店时自动选中」等副作用
   */
  function ensureShops(force = false): Promise<PaintShop[]> {
    return dict.ensureShops(force)
  }

  /** 强制刷新（门店增删改后调用） */
  function refreshShops(): Promise<PaintShop[]> {
    return dict.refreshShops()
  }

  /** 门店 id -> 名称；空 id 返回「全部门店」，未命中回退 id 本身 */
  function getShopName(id: string): string {
    if (!id)
      return allText
    return shops.value.find(s => s.id === id)?.name || id
  }

  return {
    shops,
    shopColumns,
    loading,
    ensureShops,
    refreshShops,
    getShopName,
  }
}

export default useShopOptions
