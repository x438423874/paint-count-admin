import path from 'node:path'
import process from 'node:process'
import { loadEnv } from 'vite'
import type { ConfigEnv, UserConfig } from 'vite'
import { createVitePlugins } from './build/vite'
import { exclude, include } from './build/vite/optimize'

const API_PREFIX_RE = /^\/fg-api/

export default ({ mode }: ConfigEnv): UserConfig => {
  const root = process.cwd()
  const env = loadEnv(mode, root)

  return {
    base: env.VITE_APP_PUBLIC_PATH,
    plugins: createVitePlugins(mode),

    server: {
      host: true,
      port: 6400,
      proxy: {
        '/fg-api': {
          target: env.VITE_SERVER_BASEURL || 'http://localhost:6200/v1',
          ws: false,
          changeOrigin: true,
          rewrite: requestPath => requestPath.replace(API_PREFIX_RE, ''),
        },
        '/uploads': {
          target: (env.VITE_SERVER_BASEURL || 'http://localhost:6200/v1').replace(/\/v1$/, ''),
          changeOrigin: true,
        },
      },
    },

    resolve: {
      alias: {
        '@': path.join(__dirname, './src'),
        '~': path.join(__dirname, './src/assets'),
        '~root': path.join(__dirname, '.'),
      },
    },

    build: {
      cssCodeSplit: false,
      chunkSizeWarningLimit: 2048,
      outDir: env.VITE_APP_OUT_DIR || 'dist',
    },

    optimizeDeps: { include, exclude },
  }
}
