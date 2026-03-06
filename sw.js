/* Hogares | Musicala — Service Worker PRO++
   Estrategia:
   - Navegación / HTML: network-first con fallback offline
   - CSS / JS / manifest / iconos: stale-while-revalidate
   - Limpieza de caches viejos
   - Mensajes a clientes para avisar updates
   - Skip waiting opcional
   - Manejo más robusto de fallos y requests
*/

"use strict";

const VERSION = "1.2.0";
const CACHE_PREFIX = "hogares-pwa";

const CACHE_APP = `${CACHE_PREFIX}-app-${VERSION}`;
const CACHE_ASSETS = `${CACHE_PREFIX}-assets-${VERSION}`;
const CACHE_RUNTIME = `${CACHE_PREFIX}-runtime-${VERSION}`;

const OFFLINE_FALLBACK_URL = "./index.html";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* =========================
   Install
========================= */
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);

    // No dejamos que un solo archivo dañe toda la instalación
    await Promise.allSettled(
      APP_SHELL.map(async (asset) => {
        try {
          await cache.add(new Request(asset, { cache: "reload" }));
        } catch (_) {
          /* silencio elegante */
        }
      })
    );

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
      keys.map((key) => {
        const isOurCache = key.startsWith(CACHE_PREFIX);
        const isCurrent =
          key === CACHE_APP ||
          key === CACHE_ASSETS ||
          key === CACHE_RUNTIME;

        if (isOurCache && !isCurrent) {
          return caches.delete(key);
        }
        return null;
      })
    );

    await self.clients.claim();
    await notifyClients({ type: "SW_ACTIVATED", version: VERSION });
  })());
});

/* =========================
   Messages
   Permite:
   navigator.serviceWorker.controller?.postMessage({ type:"SKIP_WAITING" })
========================= */
self.addEventListener("message", (event) => {
  const msg = event.data || {};

  if (msg.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (msg.type === "PING") {
    event.source?.postMessage?.({
      type: "PONG",
      version: VERSION
    });
  }
});

/* =========================
   Fetch
========================= */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo http(s)
  if (!/^https?:$/.test(url.protocol)) return;

  // Solo mismo origen
  if (url.origin !== self.location.origin) return;

  // Evitar extensiones del navegador o cosas raras
  if (url.pathname.startsWith("/chrome-extension")) return;

  // Navegación / documentos HTML
  if (req.mode === "navigate" || isHTML(req)) {
    event.respondWith(handleNavigation(req));
    return;
  }

  // Assets estáticos
  if (isAssetRequest(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_ASSETS));
    return;
  }

  // Todo lo demás mismo origen
  event.respondWith(staleWhileRevalidate(req, CACHE_RUNTIME));
});

/* =========================
   Strategies
========================= */
async function handleNavigation(req) {
  const cache = await caches.open(CACHE_APP);

  try {
    const fresh = await fetch(req, {
      cache: "no-store"
    });

    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }

    return fresh;
  } catch (_) {
    const cachedPage = await cache.match(req);
    if (cachedPage) return cachedPage;

    const fallback = await cache.match(OFFLINE_FALLBACK_URL);
    if (fallback) return fallback;

    return offlineResponse("No hay conexión y no encontré la vista offline.");
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const networkPromise = fetch(req)
    .then(async (res) => {
      if (isCacheableResponse(res)) {
        await cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    // actualiza en segundo plano
    networkPromise.then(async (res) => {
      if (res && isLikelyAppFile(req.url)) {
        await notifyClients({ type: "SW_ASSET_UPDATED", url: req.url, version: VERSION });
      }
    });
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;

  const fallback = await offlineAssetFallback(req);
  if (fallback) return fallback;

  return offlineResponse("Recurso no disponible sin conexión.");
}

/* =========================
   Helpers
========================= */
function isHTML(req) {
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isAssetRequest(pathname) {
  return (
    pathname.endsWith("/") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".mjs") ||
    pathname.endsWith(".webmanifest") ||
    pathname.endsWith(".json") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".ico")
  );
}

function isLikelyAppFile(urlString) {
  try {
    const url = new URL(urlString);
    return (
      url.pathname.endsWith(".html") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".webmanifest")
    );
  } catch {
    return false;
  }
}

function isCacheableResponse(res) {
  return !!(res && res.ok && (res.type === "basic" || res.type === "default"));
}

async function offlineAssetFallback(req) {
  const url = new URL(req.url);

  // Si piden HTML, devolver index
  if (isHTML(req) || req.mode === "navigate") {
    const appCache = await caches.open(CACHE_APP);
    const fallback = await appCache.match(OFFLINE_FALLBACK_URL);
    if (fallback) return fallback;
  }

  // Si piden imagen, podrías devolver una imagen fallback en el futuro
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(url.pathname)) {
    return null;
  }

  return null;
}

function offlineResponse(message = "Offline") {
  return new Response(message, {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function notifyClients(payload) {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window"
  });

  await Promise.allSettled(
    clients.map((client) => client.postMessage(payload))
  );
}