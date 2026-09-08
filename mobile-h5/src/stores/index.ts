import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import useUserStore from './modules/user'
import useRouteCacheStore from './modules/routeCache'
import useDictStore from './modules/dict'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

export { useUserStore, useRouteCacheStore, useDictStore }
export default pinia
