// Service worker: a permanent cache for Mars map tiles.
//
// Why: NASA's tile servers do not tell the browser how long a tile may be kept, so the
// browser asks the server again for every tile on every visit. Map tiles never change, so we
// keep them ourselves: the first time a tile is downloaded it is stored, and after that it is
// answered from this cache at once, with no network. This works across page reloads.
//
// Only tile requests are touched. Everything else (the app, the backend API) passes through.

const CACHE = 'mars-tiles-v1'
/** Stop storing new tiles above this many, then remove the oldest ones. */
const MAX_TILES = 6000
const TRIM_TO = 5000

const TILE_HOSTS = ['trek.nasa.gov', 'marshub.s3.amazonaws.com', 'astro.arcgis.com']

function isTile(url) {
  if (!TILE_HOSTS.includes(url.hostname)) return false
  if (url.hostname === 'trek.nasa.gov') return url.pathname.startsWith('/tiles/')
  if (url.hostname === 'astro.arcgis.com') return url.pathname.includes('/MapServer/tile/')
  return true // the Trek terrain bucket: tiles and layer.json
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove caches of older versions.
      for (const name of await caches.keys()) if (name !== CACHE && name.startsWith('mars-tiles-')) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

let storedSinceTrim = 0

async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_TILES) return
  // Cache keys come back oldest first.
  for (const key of keys.slice(0, keys.length - TRIM_TO)) await cache.delete(key)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (!isTile(url)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      // Ignore the request mode and headers: the same tile URL is always the same tile.
      const hit = await cache.match(request.url)
      if (hit) return hit

      const response = await fetch(request)
      // Store only complete, readable answers. A failed tile (404, 400) is not stored,
      // so it can work later. "opaque" answers cannot be read by the map, skip them.
      if (response.ok && response.type !== 'opaque') {
        cache.put(request.url, response.clone()).catch(() => {})
        if (++storedSinceTrim >= 500) {
          storedSinceTrim = 0
          trim(cache).catch(() => {})
        }
      }
      return response
    })(),
  )
})
