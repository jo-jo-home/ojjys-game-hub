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

const SHELL = "hub-shell-v2";
const GAMES = "hub-games-v1";
const KEEP = [SHELL, GAMES];

// Fetched on install. Failures here are tolerated: a cold isolate can
// redirect /hub to /login, and that must never end up cached.
const SHELL_URLS = [
  "/",
  "/hub",
  "/theme.css",
  "/theme-presets.js",
  "/themes.js",
  "/hub-ui.js",
  "/chess-theme.css",
  "/hub.css",
  "/bg.js",
  "/offline.js",
  "/cloak.js",
  "/offline-manifest.json",
  "/manifest.webmanifest",
  "/icons/hub-192.png",
  "/icons/hub-512.png",
];

function page(title, body) {
  return new Response(
    `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>offline</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a1628;color:#e2e8f0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;text-align:center}div{max-width:320px;padding:2rem}h1{font-weight:300;font-size:1.35rem;margin:0 0 .7rem;letter-spacing:.03em}p{color:#8296ab;font-size:.9rem;line-height:1.55;margin:0 0 1.4rem}a{display:inline-block;padding:.6rem 1.4rem;border:1px solid #1e3a5f;border-radius:10px;background:#152238;color:#e2e8f0;font-size:.9rem;text-decoration:none}a:hover{border-color:#2e6bbd}</style>
</head><body><div><h1>${title}</h1><p>${body}</p>
<a href="/hub">back to the hub</a></div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } },
  );
}

// Shown when the hub itself was never cached.
function offlineResponse() {
  return page(
    "nothing cached yet",
    "connect to the internet once and open the hub, then your downloaded games will work offline.",
  );
}

// Shown when a game that was never downloaded is opened with no network.
// Falling back to the cached hub here used to render what looked like a
// second copy of the hub sitting at the game's own URL.
function notDownloadedResponse(name) {
  return page(
    name + " isn't downloaded",
    "this game wasn't saved for offline play. reconnect and use the offline " +
      "button on the hub to download it.",
  );
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

// A download stores a game by file path — /coreball/index.html — but the hub
// links to the directory, /coreball/. Without resolving one to the other, a
// game that was downloaded but never also opened online would miss the cache
// and be reported as not downloaded. The server already does this same
// resolution for the GitHub proxy.
function candidates(target) {
  const path = typeof target === "string"
    ? new URL(target, self.location.origin).pathname
    : new URL(target.url).pathname;
  const out = [target];
  const last = path.split("/").pop();
  if (path.endsWith("/")) out.push(path + "index.html");
  else if (last && !last.includes(".")) out.push(path + "/index.html");
  return out;
}

// Session tokens ride along as ?token=..., so a cache lookup has to ignore
// the query string or every new session would miss and refill the cache.
async function lookup(request) {
  const targets = candidates(request);
  for (const name of [GAMES, SHELL]) {
    const cache = await caches.open(name);
    for (const target of targets) {
      const hit = await cache.match(target, { ignoreSearch: true });
      if (hit) return hit;
    }
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
    const hit = await lookup(request);
    if (hit) return hit;

    // Only the hub's own pages stand in for each other. A game path must not
    // fall back to the hub: the landing page carries the same title and the
    // about:blank button, so it read as a duplicate hub at the game's URL.
    const path = new URL(request.url).pathname;
    if (path === "/" || path === "/hub" || path === "/index.html") {
      // Plain paths, not new Request(...): Cache.match takes a URL string,
      // and the Request constructor needs a base URL that isn't always there.
      return (await lookup("/hub")) || (await lookup("/")) || offlineResponse();
    }

    const game = path.split("/").filter(Boolean)[0] || "this game";
    return notDownloadedResponse(game);
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
