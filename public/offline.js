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

  // Games and apps share one catalogue so the downloader, the worker and the
  // panel need no second code path. This is what keeps each page's panel
  // showing only its own list; the tiles are scoped already, since they are
  // built from the cards actually on the page.
  var scope = "game";

  function inScope(entry) {
    return (entry.kind || "game") === scope;
  }

  function scopedIds(data) {
    return Object.keys(data.games).filter(function (id) { return inScope(data.games[id]); });
  }

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

  // A downloaded page is raw GitHub bytes, so it never went through the
  // server's head injection. Without this a cached game loses the anti-inspect
  // script, and a downloaded ojjyChess loses the stylesheets that let it follow
  // the hub theme. (The tab disguise itself is unaffected — that comes from the
  // about:blank wrapper the hub writes client-side, which works offline.)
  //
  // Only applied to HTML small enough for the rewrite to be worth it. Three
  // games are a single 7-35 MB HTML file, and turning those into a string to
  // splice one tag is not a trade worth making on a Chromebook.
  var HEAD_LIMIT = 1048576;

  async function headFor(id) {
    try {
      var response = await fetch("/api/offline/head?game=" + encodeURIComponent(id));
      if (response.ok) return await response.text();
    } catch (e) { /* offline or blocked — cache the page unmodified */ }
    return "";
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
    var head = await headFor(id);
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
            var body = blob;
            var type = mime(path);
            if (head && type === "text/html" && blob.size <= HEAD_LIMIT) {
              var text = await blob.text();
              // A page with no </head> is left exactly as it came.
              if (text.indexOf("</head>") >= 0) {
                body = text.replace("</head>", head + "</head>");
              }
            }
            await cache.put(path, new Response(body, {
              status: 200,
              headers: { "Content-Type": type, "Cache-Control": "no-store" },
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

  // ---- panel filtering ---------------------------------------------------
  // 31 rows is too many to scan. Searching uses the hub's matcher so "duck
  // life" and "ducklife" both work here exactly as they do on the grid,
  // rather than this file growing its own rules.

  var panelQuery = "";
  var panelFilter = "all";
  var FILTERS = [["all", "all"], ["saved", "downloaded"], ["not", "not yet"]];

  function hayFor(id, game) {
    var parts = [id, game.name || "", (TIERS[game.tier] || TIERS.full)[0]];
    if (window.__hubUI && window.__hubUI.haystack) return window.__hubUI.haystack(parts);
    // hub-ui.js missing (it only loads on the hub) — fall back to plain text
    return { text: parts.join(" ").toLowerCase(), squashed: "" };
  }

  function hayMatch(hay, query) {
    if (window.__hubUI && window.__hubUI.match) return window.__hubUI.match(hay, query);
    return hay.text.indexOf((query || "").trim().toLowerCase()) >= 0;
  }

  function esc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // The decision for one row, kept pure so it can be tested without a DOM.
  function rowVisible(id, game, have, query, which) {
    var passes = which === "all" ||
      (which === "saved" && have) || (which === "not" && !have);
    return passes && hayMatch(hayFor(id, game), query);
  }

  // Toggles rows in place rather than re-rendering, so typing doesn't lose
  // focus or the caret position.
  function applyFilter() {
    if (!manifest) return;
    var saved = registry();
    var ids = scopedIds(manifest);
    var shown = 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var on = rowVisible(id, manifest.games[id], !!saved[id], panelQuery, panelFilter);
      var row = document.getElementById("of-" + id);
      if (row) row.style.display = on ? "" : "none";
      if (on) shown++;
    }
    var note = document.getElementById("of-shown");
    if (note) {
      note.textContent = shown === ids.length
        ? ""
        : shown ? "showing " + shown + " of " + ids.length
        : "nothing matches";
    }
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
    var ids = scopedIds(data).sort(function (a, b) {
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

    var count = ids.filter(function (id) { return saved[id]; }).length;
    var head = '<div class="cm-hd"><h2>offline mode</h2>' +
      '<button onclick="window.__hubOffline.close()">&times;</button></div>' +
      '<div class="cm-sum">' + count + " of " + ids.length + " games downloaded" +
      (quota ? " &middot; using " + size(used) + " of " + size(quota) : "") +
      (persisted ? " &middot; protected from cleanup" : "") +
      "</div>" +
      '<input class="of-find" id="of-find" type="text" placeholder="search ' +
      ids.length + ' games..." autocomplete="off" spellcheck="false" ' +
      'aria-label="search games" value="' + esc(panelQuery) + '" ' +
      'oninput="window.__hubOffline.find(this.value)">' +
      '<div class="of-chips">';
    for (var f = 0; f < FILTERS.length; f++) {
      head += '<button type="button" class="hu-opt' +
        (panelFilter === FILTERS[f][0] ? " on" : "") +
        '" onclick="window.__hubOffline.setFilter(\'' + FILTERS[f][0] + '\')">' +
        FILTERS[f][1] + "</button>";
    }
    head += '</div><div class="cm-sum" id="of-shown"></div>';

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
    applyFilter();
  }

  function message(id, text) {
    var node = document.getElementById("of-msg-" + id);
    if (node) node.textContent = text;
  }

  function setButton(id, html) {
    var node = document.getElementById("of-btn-" + id);
    if (node) node.innerHTML = html;
  }

  // ---- game tile buttons -------------------------------------------------

  // Styles live here rather than in the hub's inline CSS so everything to do
  // with offline mode stays in one file.
  //
  // The control is hidden until the tile is hovered, so 31 cards aren't
  // covered in buttons. Once a game is saved the badge stays visible, because
  // "which of these work offline" is worth seeing at a glance.
  var TILE_CSS = [
    ".ob{position:absolute;top:8px;left:8px;width:22px;height:22px;padding:0;",
    "border:1px solid var(--border);border-radius:50%;background:var(--bg3);",
    "color:var(--text2);line-height:0;cursor:pointer;display:flex;",
    "align-items:center;justify-content:center;opacity:0;",
    "transition:opacity .18s,color .2s,border-color .2s,background .2s}",
    ".gc:hover .ob,.ob:focus-visible{opacity:1}",
    ".ob:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
    ".ob:hover{color:var(--text);border-color:var(--accent)}",
    // A saved or in-flight tile always shows its state, hover or not.
    '.ob[data-state="ready"],.ob[data-state="busy"],',
    '.ob[data-state="fail"],.ob[data-state="confirm"]{opacity:1}',
    '.ob[data-state="ready"]{width:18px;height:18px;background:var(--ok);',
    "border-color:var(--ok);color:var(--bg);animation:pop .25s ease}",
    '.ob[data-state="fail"]{color:var(--warn);border-color:var(--warn)}',
    '.ob[data-state="confirm"]{color:var(--danger);border-color:var(--danger);',
    "background:var(--danger-bg)}",
    '.ob[data-state="busy"]{color:var(--accent);border-color:var(--accent)}',
    // Touch devices have no hover, so there the control is simply always there.
    "@media (hover:none){.ob{opacity:1}}",
    // Progress rides the card's bottom edge instead of squeezing a percentage
    // into a 22px circle. pointer-events:none so it never eats a card click.
    ".ob-pt{position:absolute;left:0;right:0;bottom:0;height:3px;overflow:hidden;",
    "border-radius:0 0 15px 15px;pointer-events:none;opacity:0;transition:opacity .2s}",
    ".ob-pt.on{opacity:1}",
    ".ob-pb{display:block;height:100%;width:0;background:var(--accent);",
    "transition:width .25s linear}",
    // With no network, a game that was never downloaded can't open, so say so
    // on the tile instead of letting the click land on a dead end.
    'html.hub-no-net .gc[data-playable="0"],html.hub-no-net .gc[data-playable="net"]',
    "{opacity:.4;pointer-events:none}",
    // A full-width band, and the card gets extra bottom padding, so the label
    // never sits on top of the game's description.
    "html.hub-no-net .gc{padding-bottom:2.6rem}",
    "html.hub-no-net .gc[data-playable]::after{position:absolute;left:0;right:0;bottom:0;",
    "padding:5px 0;text-align:center;font-size:.68rem;color:var(--text2);",
    "background:color-mix(in srgb,var(--bg) 78%,transparent);",
    "border-radius:0 0 15px 15px}",
    "html.hub-no-net .gc[data-playable=\"0\"]::after{content:'not downloaded'}",
    "html.hub-no-net .gc[data-playable=\"net\"]::after{content:'needs internet'}",
    // the offline panel's own search + filter row
    ".of-find{display:block;width:100%;margin:0 0 .8rem;padding:.55rem .9rem;",
    "border:1px solid var(--border);border-radius:10px;background:var(--bg);",
    "color:var(--text);font-size:.88rem;font-family:inherit;outline:none}",
    ".of-find:focus{border-color:var(--accent)}",
    ".of-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:.6rem}",
  ].join("");

  // Inline SVG rather than unicode glyphs, which rendered at different weights
  // and sizes depending on the font that happened to resolve.
  function svg(body, size) {
    return '<svg width="' + (size || 13) + '" height="' + (size || 13) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  }
  var ICON = {
    idle: svg('<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>'),
    ready: svg('<path d="M4 12.5l5.5 5.5L20 7"/>', 11),
    fail: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4"/>'),
    confirm: svg('<path d="M6 6l12 12M18 6L6 18"/>', 11),
    busy: svg('<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>', 11),
  };
  var HINT = {
    idle: "save for offline",
    ready: "saved for offline \u2014 click to remove",
    fail: "some files failed \u2014 click to retry",
    confirm: "click again to remove",
    busy: "downloading \u2014 click to cancel",
  };
  var confirmTimers = {};

  function tile(id) {
    return document.querySelector('.ob[data-g="' + id + '"]');
  }

  function setTile(id, state, pct) {
    var b = tile(id);
    if (!b) return;
    b.setAttribute("data-state", state);
    b.title = HINT[state] || "";
    b.setAttribute("aria-label", HINT[state] || "");
    b.innerHTML = ICON[state] || ICON.idle;

    var track = document.querySelector('.ob-pt[data-g="' + id + '"]');
    if (track) {
      var busy = state === "busy";
      track.classList.toggle("on", busy);
      if (busy) track.firstChild.style.width = Math.max(0, Math.min(100, pct)) + "%";
      else track.firstChild.style.width = "0";
    }
  }

  // Marks whether a tile can actually be opened with no network, which is
  // what the dimming above keys on.
  function markPlayable(id) {
    var card = document.querySelector('.gc[data-n="' + id + '"]');
    if (card) card.setAttribute("data-playable", registry()[id] ? "1" : "0");
  }

  function installTiles() {
    if (!manifest) return;
    var style = document.getElementById("ob-css");
    if (!style) {
      style = document.createElement("style");
      style.id = "ob-css";
      style.textContent = TILE_CSS;
      document.head.appendChild(style);
    }

    var saved = registry();
    var cards = document.querySelectorAll(".gc");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var id = card.getAttribute("data-n");
      var game = manifest.games[id];
      if (!game) continue;

      var tierInfo = TIERS[game.tier] || TIERS.full;

      // Multiplayer-only games would load offline with nothing to connect
      // to, so they get no button at all rather than a misleading one, and
      // are labelled as needing a connection rather than a download.
      if (!tierInfo[1]) { card.setAttribute("data-playable", "net"); continue; }
      card.setAttribute("data-playable", saved[id] ? "1" : "0");
      if (card.querySelector(".ob")) { setTile(id, saved[id] ? "ready" : "idle"); continue; }

      var b = document.createElement("button");
      b.className = "ob";
      b.type = "button";
      b.setAttribute("data-g", id);
      card.appendChild(b);

      // One track per card, created alongside the button so setTile can always
      // find it. Guarded by the .ob check above, so repeated installTiles()
      // calls never stack up duplicates.
      var track = document.createElement("i");
      track.className = "ob-pt";
      track.setAttribute("data-g", id);
      track.appendChild(document.createElement("i")).className = "ob-pb";
      card.appendChild(track);

      setTile(id, saved[id] ? "ready" : "idle");
      b.addEventListener("click", onTileClick);
    }
  }

  function onTileClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var b = e.currentTarget;
    var id = b.getAttribute("data-g");
    var state = b.getAttribute("data-state");

    if (state === "busy") { api.cancel(id); return; }

    // Two steps to remove, rather than a confirm() — a native dialog blocks
    // everything, including a download running in another tile.
    if (state === "ready") {
      setTile(id, "confirm");
      clearTimeout(confirmTimers[id]);
      confirmTimers[id] = setTimeout(function () {
        setTile(id, registry()[id] ? "ready" : "idle");
      }, 3000);
      return;
    }
    if (state === "confirm") {
      clearTimeout(confirmTimers[id]);
      api.remove(id);
      return;
    }
    api.get(id);
  }

  function syncNet() {
    document.documentElement.classList.toggle("hub-no-net", !navigator.onLine);
  }

  var api = {
    open: async function () {
      overlay().classList.add("open");
      await render();
      var box = document.getElementById("of-find");
      if (box) box.focus();
    },

    find: function (value) {
      panelQuery = value || "";
      applyFilter();
    },

    setFilter: function (which) {
      panelFilter = which;
      render();
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
      setTile(id, "busy", 0);
      try {
        var result = await download(id, function (done, total, bytes) {
          message(id, "downloading " + done + " / " + total + " files (" + size(bytes) + ")");
          setTile(id, "busy", (done / total) * 100);
        });
        if (result.cancelled) { message(id, "cancelled"); setTile(id, "idle"); }
        else if (result.failed) {
          message(id, result.failed + " of " + result.total + " files failed — press download again to retry");
          setTile(id, "fail");
        } else {
          message(id, "done, playable offline");
          setTile(id, "ready");
        }
      } catch (e) {
        message(id, "failed: " + (e && e.message ? e.message : "unknown error"));
        setTile(id, "fail");
      }
      delete active[id];
      markPlayable(id);
      // Restores the row: a download button after a failure or cancel, a
      // remove button once it succeeded.
      setButton(id, '<button class="cm-it-btn" onclick="window.__hubOffline.get(\'' +
        id + '\')">download</button>');
      if (registry()[id]) await render();
    },
    remove: async function (id) {
      message(id, "removing...");
      setTile(id, "busy", 0);
      try {
        await remove(id);
        setTile(id, "idle");
        markPlayable(id);
        if (document.getElementById("of-ov")) await render();
      } catch (e) {
        message(id, "couldn't remove");
        setTile(id, "ready");
      }
    },
  };

  // Exposed for the tile tests, which drive states directly.
  api._setTile = setTile;
  api._rowVisible = rowVisible;
  api._setScope = function (v) { scope = v; };
  api._headFor = headFor;
  api._installTiles = installTiles;

  window.__hubOffline = api;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        /* unsupported or blocked — the hub still works, just not offline */
      });
    });
  }

  // Tiles only exist on the hub. Elsewhere this file is just the worker
  // registration, so there is nothing to set up.
  // Any of our pages can be served from the worker's cache, carrying whatever
  // session token it held when it was cached. If that session has since
  // expired, every link on the page is already dead — so find out on load
  // rather than letting the first click open a tab full of login screen.
  // This file is only on the hub, the apps page and the landing page; game
  // frames never run it, so it can't redirect anything from inside a game.
  function verifySession() {
    if (!navigator.onLine) return;   // offline, the cache is what we want
    try {
      fetch("/api/session", { credentials: "same-origin", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok === false) window.location.href = "/login";
        })
        .catch(function () { /* can't tell; leave the page alone */ });
    } catch (e) { /* ditto */ }
  }

  function start() {
    var declared = document.body && document.body.getAttribute("data-scope");
    if (declared === "app" || declared === "game") scope = declared;
    verifySession();
    syncNet();
    addEventListener("online", syncNet);
    addEventListener("offline", syncNet);
    if (!document.querySelector(".gc")) return;
    getManifest().then(installTiles).catch(function () {
      /* no manifest, no per-tile buttons; the panel explains why */
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
