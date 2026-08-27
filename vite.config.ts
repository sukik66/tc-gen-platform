import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 与 server/index.js 的 API_PORT、.env 对齐；不依赖 SuperAI 其它服务 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname), '')
  const apiPort = env.API_PORT || '8787'
  const apiHost = env.VITE_DEV_API_HOST || '127.0.0.1'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      /** 与 API（127.0.0.1）对齐：避免仅监听 ::1 时浏览器用 127.0.0.1 打不开 */
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      /** 避免用例库 JSON 写入触发整页热重载（易被误认为「点确定刷新了」） */
      watch: {
        // Runtime settings are applied by the API process immediately. Watching
        // its persistence files would restart Vite and discard the current UI state.
        ignored: ['**/data/**', '**/.env', '**/.env.*'],
      },
      proxy: {
        '/api': {
          target: `http://${apiHost}:${apiPort}`,
          changeOrigin: true,
          /** 长 SSE：上游首 token 慢时避免 http-proxy 默认超时掐断（表现为浏览器 terminated） */
          timeout: 900_000,
          proxyTimeout: 900_000,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
                proxyRes.headers['cache-control'] = 'no-cache'
                proxyRes.headers['x-accel-buffering'] = 'no'
              }
            })
          },
        },
      },
    },
  }
})
