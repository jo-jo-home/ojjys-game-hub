// The person's own stats page. Reads /api/me, which only ever returns the
// caller's own numbers, and draws them. Holds nothing and decides nothing.

(function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // "3h 12m", "12m", "48s" — whichever units actually carry information.
  function dur(ms) {
    var s = Math.round((ms || 0) / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m";
  }

  function ago(ms) {
    if (!ms) return "never";
    var d = Date.now() - ms, day = 86400000;
    if (d < 3600000) return Math.max(1, Math.floor(d / 60000)) + " min ago";
    if (d < day) return Math.floor(d / 3600000) + "h ago";
    var days = Math.floor(d / day);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  // The same monogram the hub draws for a game with no icon, so a game shows
  // the same face in both places.
  function face(g) {
    if (g.icon) {
      return '<img src="/icons/' + esc(g.game) + '.png" alt="" width="38" height="38">';
    }
    var letters = (g.name || g.game).replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    var t = (letters.length > 1 ? letters[0][0] + letters[1][0]
      : (letters[0] || "?").slice(0, 2)).toUpperCase();
    var hash = 0, n = g.name || g.game;
    for (var i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
    return '<span class="mg" aria-hidden="true" style="--mg:' + (hash % 360) + 'deg">' + esc(t) + "</span>";
  }

  function tile(n, l) {
    return '<div class="tile"><div class="n">' + n + '</div><div class="l">' + l + "</div></div>";
  }

  function render(d) {
    var el = document.getElementById("me");
    if (!el) return;

    var hi = document.getElementById("me-hi");
    if (hi && d.label) hi.textContent = "hey " + d.label + " — here's your time on the hub";

    if (!d.games || !d.games.length) {
      el.innerHTML = '<div class="empty">no playtime yet. open a game and it starts counting — ' +
        "come back here to see it add up.</div>";
      return;
    }

    var h = '<h2>the numbers</h2><div class="tiles">';
    h += tile(esc(dur(d.totalMs)), "total playtime");
    h += tile(d.tried, d.tried === 1 ? "game played" : "games played");
    h += tile(d.totalOpens, "times opened");
    if (d.top) h += tile(esc(d.top.name), "most played");
    if (d.since) h += tile(ago(d.since), "first played");
    h += "</div>";

    h += "<h2>by game</h2><div class=\"list\">";
    var most = d.games[0].ms || 1;
    d.games.forEach(function (g) {
      h += '<div class="g">' + face(g) + '<div class="info">' +
        '<div class="gn">' + esc(g.name) + "</div>" +
        '<div class="gm">' + (g.opens || 0) + (g.opens === 1 ? " open" : " opens") +
        " · last " + ago(g.last) + "</div>" +
        '<div class="bar"><i style="width:' + Math.round((g.ms / most) * 100) + '%"></i></div>' +
        '</div><div class="time">' + esc(dur(g.ms)) + "</div></div>";
    });
    h += "</div>";
    el.innerHTML = h;
  }

  function tokenUrl() {
    var t = "";
    try { t = document.body.getAttribute("data-token") || ""; } catch (e) { /* none */ }
    return /^[a-f0-9]{64}$/.test(t) ? "/api/me?token=" + t : "/api/me";
  }

  async function start() {
    try {
      var res = await fetch(tokenUrl(), { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      render(await res.json());
    } catch (e) {
      var el = document.getElementById("me");
      if (el) el.innerHTML = '<div class="empty">couldn\'t load your stats — this page needs to be online.</div>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
