// Cesium loads its workers and assets from this folder (copied by vite-plugin-static-copy).
// Must be set before Cesium is used.
;(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium/'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChakraProvider } from '@chakra-ui/react'
import { system } from './theme'
import './index.css'
import Root from './Root'

// A permanent cache for map tiles (see public/tile-cache-sw.js). The map works without it,
// so a browser that refuses service workers only loses the speed-up.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/tile-cache-sw.js').catch((err) => {
    console.warn('[tile cache] not available', err)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChakraProvider value={system}>
      <Root />
    </ChakraProvider>
  </StrictMode>,
)
