import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import type { PaintShopListItem } from '@/service/api';
import { usePaintStore } from '@/store/modules/paint';

/**
 * 门店选项 composable
 *
 * 统一消费 paint store 的共享门店缓存，替代各页面各自 fetchPaintShopList() 的写法，达到「一次会话只请求一次 + 全页面共享」的效果。
 *
 * 用法：
 *
 * ```ts
 * const { shops, shopOptions, ensureShops, getShopName } = useShopOptions();
 * onMounted(() => {
 *   ensureShops().then(list => {
 *     // 单门店自动选中等副作用
 *   });
 * });
 * ```
 */
export function useShopOptions() {
  const paintStore = usePaintStore();
  const { shops, shopsLoading } = storeToRefs(paintStore);

  /** NaiveUI NSelect 需要的选项数据 */
  const shopOptions = computed(() => shops.value.map(s => ({ label: s.name, value: s.id })));

  /** 确保门店已加载（命中缓存不发请求），返回列表便于调用方做副作用 */
  function ensureShops(force = false): Promise<PaintShopListItem[]> {
    return paintStore.ensureShops(force);
  }

  /** 强制刷新（门店增删改后调用） */
  function refreshShops(): Promise<PaintShopListItem[]> {
    return paintStore.refreshShops();
  }

  /** 门店 id -> 名称；未命中回退 id 本身 */
  function getShopName(id?: string | null): string {
    if (!id) return '-';
    return shops.value.find(s => s.id === id)?.name || id;
  }

  return {
    shops,
    shopOptions,
    shopsLoading,
    ensureShops,
    refreshShops,
    getShopName
  };
}
