// Keyboard navigation, sort order and recently-played for the hub grid.
//
// The grid was mouse-only: tab order went through every card with no visible
// focus, there was no way to reorder, and nothing remembered what you actually
// play. None of that needs the server, so it all lives here.
//
// It deliberately takes over window._s, the sorter the inline script calls
// after a favourite is toggled, rather than adding a second competing sort.

(function () {
  "use strict";

  var KEY = "hub_theme";       // shared with the theme panel
  var PLAYS = "hub_plays";     // { id: lastPlayedMs }
  var KEEP_PLAYS = 40;

  var SORTS = [
    ["favourites", "favourites"],
    ["recent", "recent"],
    ["az", "a–z"],
  ];

  function prefs() {
    try {
      var t = JSON.parse(localStorage.getItem(KEY) || "{}");
      return t && typeof t === "object" ? t : {};
    } catch (e) { return {}; }
  }

  function savePref(key, value) {
    try {
      var t = prefs();
      t[key] = value;
      localStorage.setItem(KEY, JSON.stringify(t));
    } catch (e) { /* full or blocked; the choice just won't stick */ }
  }

  function plays() {
    try {
      var p = JSON.parse(localStorage.getItem(PLAYS) || "{}");
      return p && typeof p === "object" ? p : {};
    } catch (e) { return {}; }
  }

  function recordPlay(id) {
    // Tell the server too, so the admin panel can show who is playing what.
    // Fire and forget with keepalive, because the click is about to open a new
    // tab and the request must survive that. A failure changes nothing.
    try {
      fetch("/api/played", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id }),
        keepalive: true,
        credentials: "same-origin",
      }).catch(function () { /* nothing depends on this */ });
    } catch (e) { /* ditto */ }

    try {
      var p = plays();
      p[id] = Date.now();
      // Keep the list from growing without bound.
      var ids = Object.keys(p);
      if (ids.length > KEEP_PLAYS) {
        ids.sort(function (a, b) { return p[b] - p[a]; });
        var trimmed = {};
        for (var i = 0; i < KEEP_PLAYS; i++) trimmed[ids[i]] = p[ids[i]];
        p = trimmed;
      }
      localStorage.setItem(PLAYS, JSON.stringify(p));
    } catch (e) { /* not important enough to surface */ }
  }

  function favourites() {
    try {
      var f = JSON.parse(localStorage.getItem("favorites") || "[]");
      return Array.isArray(f) ? f : [];
    } catch (e) { return []; }
  }

  // ---- matching -----------------------------------------------------------
  // The old search did card.dataset.n.includes(query) — the folder id only,
  // case-sensitively. So "duck life", "retro bowl", "geometry dash" and
  // "ojjychess" all returned nothing, and descriptions were never searched.

  // Precomputed per card: the text to search, plus the same text with all
  // punctuation and spacing removed.
  function haystack(parts) {
    var text = parts.join(" ").toLowerCase();
    return { text: text, squashed: text.replace(/[^a-z0-9]+/g, "") };
  }

  // Matches when every word of the query appears somewhere, or when the query
  // with its spacing removed appears in the squashed text. The second rule is
  // what makes "duck life" find ducklife1 and "ducklife" find "Duck Life 1".
  function match(hay, query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return true;
    var squashed = q.replace(/[^a-z0-9]+/g, "");
    if (squashed && hay.squashed.indexOf(squashed) >= 0) return true;
    var terms = q.split(/\s+/);
    for (var i = 0; i < terms.length; i++) {
      if (hay.text.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }

  // ---- sorting -----------------------------------------------------------

  var grid = null, cards = [], originalOrder = [];

  function sortMode() {
    var m = prefs().sort;
    for (var i = 0; i < SORTS.length; i++) if (SORTS[i][0] === m) return m;
    return "favourites";
  }

  function sortCards() {
    if (!grid) return;
    var mode = sortMode();
    var favs = favourites();
    var played = plays();
    var list = [].slice.call(grid.children).filter(function (c) {
      return c.classList && c.classList.contains("gc");
    });

    list.sort(function (a, b) {
      var an = a.getAttribute("data-n"), bn = b.getAttribute("data-n");
      if (mode === "az") {
        // by the visible name, not the folder id
        return label(a).localeCompare(label(b));
      }
      if (mode === "recent") {
        var at = played[an] || 0, bt = played[bn] || 0;
        if (at !== bt) return bt - at;           // most recent first
        return originalOrder.indexOf(an) - originalOrder.indexOf(bn);
      }
      // favourites first, then the order the server rendered
      var af = favs.indexOf(an) >= 0 ? 0 : 1, bf = favs.indexOf(bn) >= 0 ? 0 : 1;
      if (af !== bf) return af - bf;
      return originalOrder.indexOf(an) - originalOrder.indexOf(bn);
    });

    for (var i = 0; i < list.length; i++) grid.appendChild(list[i]);
    cards = list;
  }

  function label(card) {
    var h = card.querySelector("h2");
    return (h ? h.textContent : card.getAttribute("data-n") || "").toLowerCase();
  }

  // ---- filtering ---------------------------------------------------------

  var search = null, empty = null;

  function filter() {
    if (!search) return;
    var q = search.value || "";
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var on = match(cards[i].__hay, q);
      cards[i].style.display = on ? "" : "none";
      if (on) shown++;
    }
    if (empty) {
      empty.style.display = shown ? "none" : "";
      var trimmed = q.trim();
      empty.textContent = trimmed ? 'nothing matches "' + trimmed + '"' : "";
    }
    focusIndex = -1;
  }

  // ---- toolbar -----------------------------------------------------------

  function renderBar() {
    var bar = document.getElementById("hu-bar");
    if (!bar) return;
    var mode = sortMode();
    var h = '<span class="hu-lbl">sort</span>';
    for (var i = 0; i < SORTS.length; i++) {
      h += '<button type="button" class="hu-opt' + (SORTS[i][0] === mode ? " on" : "") +
        '" data-sort="' + SORTS[i][0] + '">' + SORTS[i][1] + "</button>";
    }
    h += '<span class="hu-hint">press / to search, arrows to move, enter to play</span>';
    bar.innerHTML = h;
  }

  function onBarClick(e) {
    var btn = e.target.closest ? e.target.closest(".hu-opt") : null;
    if (!btn) return;
    savePref("sort", btn.getAttribute("data-sort"));
    renderBar();
    sortCards();
    focusIndex = -1;
  }

  // ---- keyboard ----------------------------------------------------------

  var focusIndex = -1;

  function visible() {
    return cards.filter(function (c) { return c.style.display !== "none"; });
  }

  function columns() {
    var vis = visible();
    if (vis.length < 2) return 1;
    var top = vis[0].offsetTop, n = 0;
    for (var i = 0; i < vis.length; i++) {
      if (vis[i].offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  }

  function moveFocus(delta) {
    var vis = visible();
    if (!vis.length) return;
    var current = vis.indexOf(document.activeElement);
    if (current < 0) current = focusIndex;
    var next = current < 0 ? 0 : current + delta;
    next = Math.max(0, Math.min(vis.length - 1, next));
    focusIndex = next;
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove("kb");
    vis[next].classList.add("kb");
    vis[next].focus();
  }

  function isTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  function anyPanelOpen() {
    var open = document.querySelectorAll(".cm-ov.open");
    return open.length ? open : null;
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var search = document.getElementById("s");

    if (e.key === "Escape") {
      var open = anyPanelOpen();
      if (open) {
        for (var i = 0; i < open.length; i++) open[i].classList.remove("open");
        e.preventDefault();
        return;
      }
      if (search && (document.activeElement === search || search.value)) {
        search.value = "";
        if (typeof Event === "function") search.dispatchEvent(new Event("input"));
        search.blur();
        e.preventDefault();
      }
      return;
    }

    if (isTyping(document.activeElement) || anyPanelOpen()) return;

    if (e.key === "/") {
      if (search) { search.focus(); search.select(); e.preventDefault(); }
      return;
    }

    var cols = columns();
    if (e.key === "ArrowRight") { moveFocus(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { moveFocus(-1); e.preventDefault(); }
    else if (e.key === "ArrowDown") { moveFocus(cols); e.preventDefault(); }
    else if (e.key === "ArrowUp") { moveFocus(-cols); e.preventDefault(); }
    else if (e.key === "Home") { moveFocus(-cards.length); e.preventDefault(); }
    else if (e.key === "End") { moveFocus(cards.length); e.preventDefault(); }
  }

  // ---- start -------------------------------------------------------------

  function start() {
    grid = document.getElementById("g");
    if (!grid) return; // not the hub

    cards = [].slice.call(grid.querySelectorAll(".gc"));
    originalOrder = cards.map(function (c) { return c.getAttribute("data-n"); });

    // Build each card's searchable text once: the folder id, the display name
    // and the description.
    for (var k = 0; k < cards.length; k++) {
      var card = cards[k];
      var h2 = card.querySelector("h2"), pEl = card.querySelector("p");
      card.__hay = haystack([
        card.getAttribute("data-n") || "",
        h2 ? h2.textContent : "",
        pEl ? pEl.textContent : "",
      ]);
    }

    // Cards are anchors, so Enter already activates them once focused; they
    // only need to be reachable and to show where focus is.
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener("focus", function () {
        for (var j = 0; j < cards.length; j++) cards[j].classList.remove("kb");
      });
    }

    var bar = document.createElement("div");
    bar.className = "hu-bar";
    bar.id = "hu-bar";
    grid.parentNode.insertBefore(bar, grid);
    bar.addEventListener("click", onBarClick);
    renderBar();

    // Event delegation, so this never fights the inline card handler — that
    // one opens the game, this one just remembers it was opened.
    grid.addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest(".gc") : null;
      if (!card) return;
      if (e.target.closest(".sb") || e.target.closest(".ob")) return;
      recordPlay(card.getAttribute("data-n"));
    });

    // Take over the inline sorter so favourite toggles respect the chosen
    // mode instead of always forcing favourites-first.
    window._s = sortCards;
    sortCards();

    search = document.getElementById("s");
    if (search) {
      empty = document.createElement("div");
      empty.className = "hu-empty";
      empty.style.display = "none";
      grid.parentNode.insertBefore(empty, grid.nextSibling);
      search.addEventListener("input", filter);
      filter();
    }

    document.addEventListener("keydown", onKey);
  }

  window.__hubUI = {
    // shared with the offline panel so both search by the same rules
    haystack: haystack,
    match: match,
    filter: filter,
    sortCards: sortCards,
    recordPlay: recordPlay,
    plays: plays,
    sortMode: sortMode,
    _onKey: onKey,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
