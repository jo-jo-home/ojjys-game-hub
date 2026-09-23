// Offline mode for ojjy's game hub.
//
// Game files are pulled straight from raw.githubusercontent.com rather than
// through the hub itself, so downloading a 135 MB game costs this server no
// bandwidth at all. Two things make that possible and are load bearing:
//
//   1. raw sends access-control-allow-origin: *, so responses are readable
//      and a failed file can actually be detected instead of silently
//      caching a 404.
//   2. raw serves everything as text/plain with x-content-type-options:
//      nosniff, which the browser refuses to execute as script. So every
//      response is rebuilt with a real Content-Type before being cached.
//
// URLs are pinned to a commit sha, not a branch. Branch refs on raw have
// been seen to 404 for files that resolve fine by sha, and a sha also stops
// a push mid-download from mixing two versions of a game together.

(function () {
  "use strict";

  var REPO = "https://raw.githubusercontent.com/jo-jo-home/ojjys-game-hub";
  var GAMES_CACHE = "hub-games-v1";
  var REGISTRY = "offlineGames";
  var PARALLEL = 6;

  var MIME = {
    html: "text/html", js: "application/javascript", css: "text/css",
    json: "application/json", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml",
    ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
    ttf: "font/ttf", eot: "application/vnd.ms-fontobject",
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
    mp4: "video/mp4", webm: "video/webm", wasm: "application/wasm",
    unityweb: "application/octet-stream", data: "application/octet-stream",
    mem: "application/octet-stream", swf: "application/x-shockwave-flash",
    xml: "application/xml", txt: "text/plain", csv: "text/csv",
    epw: "application/octet-stream", webp: "image/webp",
  };

  function mime(path) {
    var i = path.lastIndexOf(".");
    if (i < 0) return "application/octet-stream";
    return MIME[path.substring(i + 1).toLowerCase()] || "application/octet-stream";
  }

  function size(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + " MB";
    return (bytes / 1073741824).toFixed(1) + " GB";
  }

  var TIERS = {
    full: ["works fully offline", true],
    degraded: ["works offline, ads won't load", true],
    partial: ["single player only offline", true],
    online: ["needs internet to play", false],
  };

  // ---- state -------------------------------------------------------------

  var manifest = null;
  var rev = null;
  var active = {};

  function registry() {
    try { return JSON.parse(localStorage.getItem(REGISTRY) || "{}"); } catch (e) { return {}; }
  }

  function remember(id, entry) {
    var all = registry();
    if (entry) all[id] = entry; else delete all[id];
    try { localStorage.setItem(REGISTRY, JSON.stringify(all)); } catch (e) { /* full */ }
  }

  async function getManifest() {
    if (manifest) return manifest;
    var response = await fetch("/offline-manifest.json");
    if (!response.ok) throw new Error("manifest unavailable");
    manifest = await response.json();
    return manifest;
  }

  // The commit sha comes from the server, which caches it. Falling back to
  // the branch name keeps downloads working if that lookup ever fails.
  async function getRev() {
    if (rev) return rev;
    try {
      var response = await fetch("/api/offline/rev");
      if (response.ok) rev = (await response.json()).rev;
    } catch (e) { /* fall through */ }
    return rev || "master";
  }

  // ---- download ----------------------------------------------------------

  async function download(id, progress) {
    var game = (await getManifest()).games[id];
    var sha = await getRev();
    var cache = await caches.open(GAMES_CACHE);

    // Ask to be exempt from eviction. Eviction is all or nothing per origin,
    // so without this a routine cleanup wipes every download and every game
    // save at the same time.
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (e) { /* not supported */ }

    var queue = game.files.slice();
    var total = queue.length;
    var done = 0;
    var bytes = 0;
    var failed = [];

    async function worker() {
      while (queue.length) {
        if (active[id] === "cancel") return;
        var path = queue.shift();
        try {
          // Already have it — lets a retry resume instead of starting over.
          var have = await cache.match(path);
          if (!have) {
            var response = await fetch(REPO + "/" + sha + "/public" + encodeURI(path));
            if (!response.ok) throw new Error("HTTP " + response.status);
            var blob = await response.blob();
            await cache.put(path, new Response(blob, {
              status: 200,
              headers: { "Content-Type": mime(path), "Cache-Control": "no-store" },
            }));
            bytes += blob.size;
          }
        } catch (e) {
          failed.push(path);
        }
        done++;
        if (progress) progress(done, total, bytes);
      }
    }

    var workers = [];
    for (var i = 0; i < PARALLEL; i++) workers.push(worker());
    await Promise.all(workers);

    if (active[id] === "cancel") {
      await remove(id);
      return { cancelled: true };
    }
    if (failed.length) {
      // Leave what downloaded in place so a retry only fetches the rest,
      // but do not claim the game is playable offline.
      return { failed: failed.length, total: total };
    }

    remember(id, { bytes: game.bytes, at: Date.now() });
    return { ok: true, bytes: bytes };
  }

  async function remove(id) {
    var game = (await getManifest()).games[id];
    var cache = await caches.open(GAMES_CACHE);
    for (var i = 0; i < game.files.length; i++) await cache.delete(game.files[i]);
    remember(id, null);
  }

  // ---- ui ----------------------------------------------------------------

  function el(html) {
    var d = document.createElement("div");
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function overlay() {
    var existing = document.getElementById("of-ov");
    if (existing) return existing;
    var node = el('<div class="cm-ov" id="of-ov"><div class="cm" id="of"></div></div>');
    document.body.appendChild(node);
    node.addEventListener("click", function (e) {
      if (e.target === node) close();
    });
    return node;
  }

  function close() {
    var node = document.getElementById("of-ov");
    if (node) node.classList.remove("open");
  }

  async function render() {
    var panel = document.getElementById("of");
    if (!panel) return;

    var data;
    try {
      data = await getManifest();
    } catch (e) {
      panel.innerHTML = '<div class="cm-hd"><h2>offline mode</h2>' +
        '<button onclick="window.__hubOffline.close()">&times;</button></div>' +
        '<div class="cm-empty">can\'t load the game list. connect to the internet and try again.</div>';
      return;
    }

    var saved = registry();
    var ids = Object.keys(data.games).sort(function (a, b) {
      var sa = saved[a] ? 0 : 1, sb = saved[b] ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return data.games[a].bytes - data.games[b].bytes;
    });

    var used = 0, quota = 0, persisted = false;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var est = await navigator.storage.estimate();
        used = est.usage || 0;
        quota = est.quota || 0;
      }
      if (navigator.storage && navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
    } catch (e) { /* not supported */ }

    var count = Object.keys(saved).length;
    var head = '<div class="cm-hd"><h2>offline mode</h2>' +
      '<button onclick="window.__hubOffline.close()">&times;</button></div>' +
      '<div class="cm-sum">' + count + " of " + ids.length + " games downloaded" +
      (quota ? " &middot; using " + size(used) + " of " + size(quota) : "") +
      (persisted ? " &middot; protected from cleanup" : "") +
      "</div>";

    var body = "";
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var game = data.games[id];
      var tier = TIERS[game.tier] || TIERS.full;
      var have = !!saved[id];
      var button = have
        ? '<button class="cm-it-btn" onclick="window.__hubOffline.remove(\'' + id + '\')">remove</button>'
        : tier[1]
          ? '<button class="cm-it-btn" onclick="window.__hubOffline.get(\'' + id + '\')">download</button>'
          : '<button class="cm-it-btn" disabled style="opacity:.4;cursor:default">unavailable</button>';

      body += '<div class="cm-it" id="of-' + id + '">' +
        '<div class="cm-it-hd"><span class="cm-it-name">' + game.name + "</span>" +
        '<span id="of-btn-' + id + '">' + button + "</span></div>" +
        '<div class="cm-it-meta"><span>' + size(game.bytes) + "</span>" +
        "<span>" + game.files.length + " files</span>" +
        (have ? "<span>ready offline</span>" : "") + "</div>" +
        '<div class="cm-it-tags"><span class="cm-tag">' + tier[0] + "</span></div>" +
        '<div class="cm-it-keys" id="of-msg-' + id + '"></div></div>';
    }

    panel.innerHTML = head + body;
  }

  function message(id, text) {
    var node = document.getElementById("of-msg-" + id);
    if (node) node.textContent = text;
  }

  function setButton(id, html) {
    var node = document.getElementById("of-btn-" + id);
    if (node) node.innerHTML = html;
  }

  var api = {
    open: async function () {
      overlay().classList.add("open");
      await render();
    },
    close: close,
    // A big game takes a while and navigating away kills it, so the button
    // becomes a cancel while a download is running.
    cancel: function (id) {
      if (active[id]) {
        active[id] = "cancel";
        message(id, "cancelling...");
      }
    },
    get: async function (id) {
      if (active[id]) return;
      active[id] = "run";
      message(id, "starting...");
      setButton(id, '<button class="cm-it-btn" onclick="window.__hubOffline.cancel(\'' +
        id + '\')">cancel</button>');
      try {
        var result = await download(id, function (done, total, bytes) {
          message(id, "downloading " + done + " / " + total + " files (" + size(bytes) + ")");
        });
        if (result.cancelled) message(id, "cancelled");
        else if (result.failed) {
          message(id, result.failed + " of " + result.total + " files failed — press download again to retry");
        } else {
          message(id, "done, playable offline");
        }
      } catch (e) {
        message(id, "failed: " + (e && e.message ? e.message : "unknown error"));
      }
      delete active[id];
      // Restores the row: a download button after a failure or cancel, a
      // remove button once it succeeded.
      setButton(id, '<button class="cm-it-btn" onclick="window.__hubOffline.get(\'' +
        id + '\')">download</button>');
      if (registry()[id]) await render();
    },
    remove: async function (id) {
      message(id, "removing...");
      try {
        await remove(id);
        await render();
      } catch (e) {
        message(id, "couldn't remove");
      }
    },
  };

  window.__hubOffline = api;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        /* unsupported or blocked — the hub still works, just not offline */
      });
    });
  }
})();
