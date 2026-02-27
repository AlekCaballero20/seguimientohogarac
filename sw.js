/* Hogares | Musicala — Service Worker PRO
   - HTML: Network-first (actualiza de una)
   - Assets: Stale-while-revalidate (rápido + se refresca)
   - Fallback offline
   - Limpieza de caches viejos
*/

const VERSION = "1.1.0"; // 🔁 súbelo cada vez que quieras forzar update
const CACHE_PREFIX = "hogares-pwa";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${VERSION}`;

const OFFLINE_FALLBACK_URL = "./index.html";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

/* =========================
   Install
========================= */
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // Si un asset falla, no queremos que la instalación muera completa:
    await Promise.allSettled(STATIC_ASSETS.map(a => cache.add(a)));
    await self.skipWaiting();
  })());
});

/* =========================
   Activate
========================= */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        const isOurCache = k.startsWith(CACHE_PREFIX);
        const isCurrent = (k === STATIC_CACHE || k === RUNTIME_CACHE);
        if (isOurCache && !isCurrent) return caches.delete(k);
        return null;
      })
    );
    await self.clients.claim();
  })());
});

/* =========================
   Messages (optional)
   Permite: navigator.serviceWorker.controller?.postMessage({type:"SKIP_WAITING"})
========================= */
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* =========================
   Fetch strategies
========================= */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // No tocar cosas raras
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Solo mismo origen (tu PWA)
  // Si en algún momento quieres cachear fonts externos, se hace aparte con reglas.
  if (url.origin !== self.location.origin) return;

  // Navegación / HTML (mejor para updates)
  if (req.mode === "navigate" || isHTML(req)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Assets estáticos: cache rápido + refresco en segundo plano
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // Lo demás (runtime): SWR pero en otro cache
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

/* =========================
   Helpers
========================= */
function isHTML(req) {
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isStaticAsset(pathname) {
  // Ajusta si luego agregas assets nuevos
  return (
    pathname.endsWith("/") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".webmanifest") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".ico")
  );
}

async function networkFirst(req) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    const fresh = await fetch(req, { cache: "no-store" });
    // Guardamos copia si ok
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    // Offline: intenta cache
    const cached = await cache.match(req);
    if (cached) return cached;

    // fallback general a index
    const fallback = await cache.match(OFFLINE_FALLBACK_URL);
    return fallback || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  // Si hay cache, responde ya; si no hay, espera red (o falla)
  return cached || (await fetchPromise) || (await offlineFallback(cache));
}

async function offlineFallback(cache) {
  const fallback = await cache.match(OFFLINE_FALLBACK_URL);
  return fallback || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}