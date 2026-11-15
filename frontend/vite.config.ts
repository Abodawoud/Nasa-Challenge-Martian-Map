import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Cesium needs its Workers, Assets, Widgets and ThirdParty folders served as
// static files. They are copied from node_modules to /cesium at build and dev time.
const cesiumBuild = 'node_modules/cesium/Build/Cesium'

// Inside Docker the backend is reachable as http://be:8000.
// Outside Docker (npm run dev on the host) it is http://localhost:8000.
const apiTarget = process.env.API_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'Assets', 'Widgets', 'ThirdParty'].map((dir) => ({
        src: `${cesiumBuild}/${dir}`,
        dest: 'cesium',
        // Drop "node_modules/cesium/Build/Cesium/" so files land in /cesium/<dir>/...
        rename: { stripBase: 4 },
      })),
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // Docker on Windows does not pass file-change events into containers.
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  // "vite preview" serves the built app (the dist folder). The public link uses it, not the
  // development server: it only hands out the finished files, never the source code.
  preview: {
    host: true,
    port: 4173,
    // The public link is a Cloudflare quick tunnel. Its address ends in trycloudflare.com.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
