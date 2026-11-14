import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
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
    tailwindcss(),
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
})
