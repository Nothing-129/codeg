// Codeg PWA service worker.
//
// Deliberately minimal: only immutable static assets are cached. Content is
// served cache-first when it is content-hashed by the build (Next.js chunks
// under /_next/static/), and stale-while-revalidate when the path is stable
// across builds (the Monaco /vs/ tree). Everything else — HTML, /api, /ws —
// always goes straight to the network so auth and live data are never served
// stale.
//
// Bump CACHE_VERSION when the /vs/ assets change shape between releases;
// activation then discards every cache from the previous version.
const CACHE_VERSION = "codeg-v1"
const HASHED_PREFIX = "/_next/static/"
const STABLE_PREFIX = "/vs/"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith(HASHED_PREFIX)) {
    event.respondWith(cacheFirst(request))
    return
  }
  if (url.pathname.startsWith(STABLE_PREFIX)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  return cached || (await network) || Response.error()
}
