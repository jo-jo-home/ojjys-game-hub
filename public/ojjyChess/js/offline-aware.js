// Greys out the parts of ojjyChess that need the server when there is no
// network. Bot games, puzzles, variants, openings and settings are entirely
// client side and keep working; matchmaking, friends and messaging cannot.
//
// Nothing here changes game logic — it only marks the entry points and lets
// CSS dim them, so it stays correct if those screens move around.

(function () {
  "use strict";

  // Entry points that hit the server. Matched on the onclick attribute so no
  // ids have to be added to the markup.
  var ONLINE_ONLY = [
    '[onclick*="showPlayOnline"]',
    '[onclick*="enterFriendsMode"]',
    '[onclick*="enterOnlineGameMode"]',
  ];

  var STYLE = [
    "[data-needs-net]{transition:opacity .2s}",
    "html.no-net [data-needs-net]{opacity:.35;pointer-events:none;cursor:default}",
    "#net-banner{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;",
    "z-index:9999;display:none;align-items:center;gap:8px;padding:9px 16px;",
    "border:1px solid #1e3a5f;border-radius:999px;background:#111d2e;color:#e2e8f0;",
    "font-size:.82rem;font-family:'Segoe UI',system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)}",
    "html.no-net #net-banner{display:flex}",
    "#net-banner i{width:7px;height:7px;border-radius:50%;background:#e0a355;display:inline-block}",
  ].join("");

  function inject() {
    var style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    var banner = document.createElement("div");
    banner.id = "net-banner";
    banner.innerHTML = "<i></i><span>offline &middot; bot games, puzzles and variants only</span>";
    document.body.appendChild(banner);
  }

  // Re-marked on every change because these screens are built as you navigate,
  // so the buttons don't all exist at load.
  function mark() {
    for (var i = 0; i < ONLINE_ONLY.length; i++) {
      var found = document.querySelectorAll(ONLINE_ONLY[i]);
      for (var j = 0; j < found.length; j++) found[j].setAttribute("data-needs-net", "");
    }
  }

  function apply() {
    document.documentElement.classList.toggle("no-net", !navigator.onLine);
    mark();
  }

  function start() {
    inject();
    apply();
    addEventListener("online", apply);
    addEventListener("offline", apply);
    // Catches buttons added when a new screen is rendered.
    if (window.MutationObserver) {
      new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
