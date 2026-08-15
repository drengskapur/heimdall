// Heimdall service worker.
// Strategy: network-first with a same-origin runtime cache and an app-shell
// fallback ("/") for navigations, so the workspace keeps loading offline.
const CACHE = "heimdall-v1";
const CORE = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE);
      // The built bundle has to be precached here, and its filenames are
      // content-hashed, so they can only be discovered at runtime — read them
      // out of the shell HTML.
      //
      // Without this the app was not actually offline-first. A service worker
      // does not control the page that registered it, so on a first visit the
      // bundle is fetched straight from the network, never passes through the
      // fetch handler, and never enters the cache. Going offline before a second
      // online visit rendered a blank page: the document came back from cache
      // with no script to run. Measured before this: `/` and the icons cached,
      // no index-*.js or index-*.css.
      //
      // Individually and tolerantly, not addAll: one unreachable asset should
      // cost that asset, not the whole precache and with it offline support.
      try {
        const html = await (await fetch("/", { cache: "reload" })).text();
        const assets = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]));
        await Promise.all([...assets].map(url => cache.add(url).catch(() => {})));
      } catch {
        // Installing while offline. Runtime caching still fills the gap later.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only same-origin, complete (200), basic responses are safe to cache. Caching
// error pages, opaque cross-origin responses, or 206 partials would poison the
// cache (and cache.put throws on a 206).
function isCacheable(request, response) {
  return (
    response &&
    response.status === 200 &&
    response.type === "basic" &&
    new URL(request.url).origin === self.location.origin
  );
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (isCacheable(request, response)) {
          const copy = response.clone();
          caches
            .open(CACHE)
            .then(c => c.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // For navigations, fall back to the cached app shell — but only if it is
        // actually there. `caches.match` resolves undefined on a miss, and
        // responding with undefined rejects the fetch with a confusing error
        // instead of the network failure that really happened.
        if (request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
