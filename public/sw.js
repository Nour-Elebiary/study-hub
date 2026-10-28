/**
 * Study Hub service worker (spec section 10): caches the app shell and the
 * last 20 notes a person opened, so they can be read offline.
 *
 * Hand-rolled instead of Serwist because Serwist's compiler plugin is
 * webpack-only and this project builds with Turbopack (Next 16 default) —
 * see docs/QUESTIONS.md #13. No build step: this file is served as-is.
 *
 * What is cached:
 *   - navigations (HTML) network-first, so content is fresh when online and
 *     readable when offline — including the last opened note,
 *   - immutable build assets (/_next/static/…) cache-first,
 *   - a small "pages" cache capped at 20 entries, LRU by last visit.
 *
 * What is never cached: /s/download/* (10-minute signed URLs must not be
 * reused), POST requests (server actions), and anything on another origin.
 */

const VERSION = "v1";
const SHELL_CACHE = `shell-${VERSION}`;
const PAGES_CACHE = `pages-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;
const MAX_PAGES = 20;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // A public page as the offline navigation fallback. It must be cacheable
      // and reachable without a join cookie.
      const cache = await caches.open(SHELL_CACHE);
      await cache.add("/s/join");
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions of this worker.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => ![SHELL_CACHE, PAGES_CACHE, STATIC_CACHE].includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return; // server actions always hit the network
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/s/download/")) return; // signed URLs: never cache

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico"
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
  // Everything else (RSC payloads, Supabase API, Storage) passes through
  // untouched — the browser's own HTTP cache handles static reuse.
});

async function handleNavigation(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      // Remember the page. Notes go into the capped LRU cache; other pages
      // (home, courses, search) into the shell cache as offline fallbacks.
      const cache = await caches.open(
        url.pathname.startsWith("/s/notes/") ? PAGES_CACHE : SHELL_CACHE,
      );
      // delete-then-put re-inserts the entry, making the cache order the
      // visit order (true LRU for the 20-note cap).
      await cache.delete(request, { ignoreVary: true });
      await cache.put(request, response.clone());
      await trimPages();
    }
    return response;
  } catch {
    const cached =
      (await caches.match(request, { ignoreVary: true })) ||
      (await caches.match("/s/join", { ignoreVary: true }));
    if (cached) return cached;
    return new Response(
      "<html><body><h1>Offline</h1><p>You are offline and this page was not saved for reading. Reconnect and open it once.</p></body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

/** Keeps at most MAX_PAGES entries in the notes cache (spec section 10). */
async function trimPages() {
  const cache = await caches.open(PAGES_CACHE);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) {
    await cache.delete(key);
  }
}
