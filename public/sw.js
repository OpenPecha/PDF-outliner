/**
 * Service Worker for offline caching of processed PDF pages
 */

const CACHE_NAME = "pdf-workspace-cache-v1"
const PDFJS_WORKER_CACHE = "pdfjs-worker-cache-v1"

// Cache PDF.js worker and other static assets
const STATIC_ASSETS = [
  "/",
  "/index.html",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    })
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== PDFJS_WORKER_CACHE)
          .map((name) => caches.delete(name))
      )
    })
  )
  return self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Cache PDF.js worker files
  if (url.pathname.includes("pdf.worker") || url.pathname.includes("pdfjs-dist")) {
    event.respondWith(
      caches.open(PDFJS_WORKER_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached

        try {
          const response = await fetch(request)
          if (response.ok) {
            cache.put(request, response.clone())
          }
          return response
        } catch (error) {
          console.error("Failed to fetch PDF.js worker:", error)
          throw error
        }
      })
    )
    return
  }

  // For other requests, try network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        if (response.ok && request.method === "GET") {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone)
          })
        }
        return response
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(request).then((cached) => {
          if (cached) return cached
          throw new Error("No cache available")
        })
      })
  )
})
