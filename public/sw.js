/* Home+ Service Worker
 *
 * Estratégia:
 *  - /_next/static/* e /_next/image: cache-first (assets imutáveis com hash)
 *  - /icon, /apple-icon, /manifest.webmanifest, /favicon.ico: cache-first
 *  - Navegações HTML: network-first com fallback para /offline
 *  - Tudo mais (server actions POST, /api/*, fetches autenticados, cross-origin):
 *    passa direto, sem cache, pra não vazar dados de outros usuários nem
 *    servir página stale após mudanças
 *
 * Bumpa VERSION quando mudar lógica do SW; clients velhos serão substituídos.
 */
const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGES_CACHE = `pages-${VERSION}`;

const PRECACHE_URLS = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Best-effort: se falhar (rota nova ainda não disponível), segue
      await Promise.allSettled(
        PRECACHE_URLS.map((u) =>
          fetch(u, { credentials: "same-origin" })
            .then((res) => (res.ok ? cache.put(u, res) : null))
            .catch(() => null),
        ),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpa caches de versões antigas
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(`-${VERSION}`))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

const STATIC_PREFIXES = ["/_next/static/", "/_next/image"];
const ASSET_PATHS = new Set([
  "/icon",
  "/apple-icon",
  "/manifest.webmanifest",
  "/favicon.ico",
]);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Apenas same-origin
  if (url.origin !== self.location.origin) return;
  // Nunca cacheia API / rotas de auth
  if (url.pathname.startsWith("/api/")) return;

  // Assets imutáveis: cache-first
  if (
    STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) ||
    ASSET_PATHS.has(url.pathname)
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Navegações HTML: network-first, fallback /offline
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(networkFirstWithOffline(req));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // Sem cache e sem rede: retorna erro padrão (browser mostra erro do asset).
    throw e;
  }
}

async function networkFirstWithOffline(req) {
  try {
    const res = await fetch(req);
    // Cacheia páginas públicas só (estático). Como não sabemos auth, deixa
    // o navegador lidar com Vary/cookies; SW não armazena resposta autenticada.
    return res;
  } catch (e) {
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match("/offline");
    if (offline) return offline;
    // Último recurso
    return new Response(
      `<!DOCTYPE html><html lang="pt-BR"><body style="font-family:system-ui;padding:2rem;text-align:center"><h1>Você está offline</h1><p>Tente novamente quando voltar a internet.</p></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
