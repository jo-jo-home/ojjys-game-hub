// Offline support for ojjy's game hub.
//
// Lives at the root so its scope is "/" — a service worker only controls
// its own directory downward, so this file must not be moved into a
// subfolder or it would stop controlling /hub and the games.
//
// Two caches, on purpose:
//   SHELL - the hub pages and icons, versioned, cheap to rebuild
//   GAMES - downloaded game files, expensive, must survive every update
// GAMES is in KEEP below and must stay there. Dropping it means every
// service worker update silently deletes everything the user downloaded.

const SHELL = "hub-shell-v1";
const GAMES = "hub-games-v1";
const KEEP = [SHELL, GAMES];

// Fetched on install. Failures here are tolerated: a cold isolate can
// redirect /hub to /login, and that must never end up cached.
const SHELL_URLS = [
  "/",
  "/hub",
  "/offline.js",
  "/offline-manifest.json",
  "/manifest.webmanifest",
  "/icons/hub-192.png",
  "/icons/hub-512.png",
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ojjy's game hub</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a1628;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;text-align:center}div{max-width:300px;padding:2rem}h1{font-weight:300;font-size:1.4rem;margin:0 0 .6rem}p{color:#64806f;font-size:.9rem;line-height:1.5;margin:0}</style>
</head><body><div><h1>nothing cached yet</h1>
<p>connect to the internet once and open the hub, then your downloaded games will work offline.</p>
</div></body></html>`;

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
  });
}

// Only ever store a real, final 200. Anything else — the 302 to /login, a
// 404, an opaque redirect — would be served back later as if it were the
// real thing, so it is rejected here.
function storable(response) {
  return !!response && response.status === 200 && response.type !== "opaqueredirect" &&
    !response.redirected;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { credentials: "same-origin", cache: "reload" });
        if (storable(response)) await cache.put(url, response);
      } catch { /* offline or gated — the fetch handler will fill this in later */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      // Only ever touch our own caches, and never the downloaded games.
      if (name.startsWith("hub-") && !KEEP.includes(name)) return caches.delete(name);
    }));
    await self.clients.claim();
  })());
});

// Session tokens ride along as ?token=..., so a cache lookup has to ignore
// the query string or every new session would miss and refill the cache.
async function lookup(request) {
  for (const name of [GAMES, SHELL]) {
    const cache = await caches.open(name);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

// Pages are generated server side from the GAMES array, so prefer the
// network and fall back to whatever was cached last.
async function handlePage(request) {
  try {
    const response = await fetch(request);
    if (storable(response)) {
      // Stored under the bare path. Keying on the full URL would leave one
      // stale copy per session behind, since /hub carries a ?token=.
      const key = new URL(request.url).pathname;
      const cache = await caches.open(SHELL);
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    return (await lookup(request)) ||
      (await lookup(new Request("/hub"))) ||
      (await lookup(new Request("/"))) ||
      offlineResponse();
  }
}

// Part of the hub itself rather than a game, so worth holding on to when
// seen. Game files are deliberately excluded: they only enter the cache
// through an explicit download, otherwise merely opening a game online
// would quietly pull 135 MB into storage nobody asked for.
function isShellAsset(pathname) {
  return pathname.startsWith("/icons/") || pathname.lastIndexOf("/") === 0;
}

// Downloaded game files never change under a given commit, so cache wins
// and the download actually buys something.
async function handleAsset(request) {
  const hit = await lookup(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (storable(response) && isShellAsset(new URL(request.url).pathname)) {
      const cache = await caches.open(SHELL);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Login and the chess APIs are live-only. Caching either would strand
  // people on a stale page or serve stale game state.
  if (url.pathname === "/login" || url.pathname.startsWith("/api/")) return;

  // The worker itself must always come from the network or updates stop.
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(handlePage(request));
  } else {
    event.respondWith(handleAsset(request));
  }
});
