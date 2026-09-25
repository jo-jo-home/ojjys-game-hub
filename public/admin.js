// The admin panel: who has access, and what they've been playing.
//
// Everything comes from /api/admin/state, which 404s for anyone who isn't an
// admin — so this file is inert if it's ever loaded by someone else. It holds
// no secrets and makes no decisions of its own.

(function () {
  "use strict";

  var state = null;
  var pendingRevoke = null;
  var revokeTimer = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function ago(ms) {
    if (!ms) return "never";
    var d = Date.now() - ms;
    if (d < 60000) return "just now";
    var m = Math.floor(d / 60000);
    if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(h / 24);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  function nameOf(code) {
    if (code === "owner") return "you";
    if (code === "shared") return "shared password";
    if (!state) return code.slice(0, 8);
    for (var i = 0; i < state.codes.length; i++) {
      if (state.codes[i].hash === code) return state.codes[i].label;
    }
    return code.slice(0, 8) + "…";
  }

  // A session counts as live if it was seen in the last quarter hour.
  function onlineSince(code) {
    var at = state && state.online ? state.online[code] : 0;
    return at && Date.now() - at < 900000 ? at : 0;
  }

  async function load() {
    var res = await fetch("/api/admin/state", { cache: "no-store" });
    if (!res.ok) throw new Error("no access");
    state = await res.json();
  }

  function render() {
    var el = document.getElementById("ad");
    if (!el) return;
    var h = "";

    // ---- access ----
    h += "<h2>access</h2>";
    h += '<div class="row">' +
      '<input type="text" id="ad-label" placeholder="who is this for?" maxlength="40">' +
      '<button type="button" class="stg-btn" id="ad-new">create a code</button></div>';
    h += '<div class="new" id="ad-shown"></div>';

    h += "<table><tr><th>who</th><th>last seen</th><th>opens</th><th></th></tr>";

    // the built-in shared password, listed so it can be retired
    var sharedOn = state.sharedEnabled;
    h += '<tr><td class="' + (sharedOn ? "who" : "gone") + '">shared password' +
      '<div class="dim">' + (sharedOn
        ? "anyone who has ever had it still gets in"
        : "retired — no longer accepted") + "</div></td>" +
      "<td>" + (onlineSince("shared") ? '<span class="on">online now</span>' : ago(state.online.shared)) + "</td>" +
      '<td class="dim">—</td><td>' +
      (sharedOn
        ? '<button type="button" class="cm-it-btn" data-shared="off">retire</button>'
        : '<button type="button" class="cm-it-btn" data-shared="on">allow again</button>') +
      "</td></tr>";

    var codes = state.codes.slice().sort(function (a, b) {
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      var live = onlineSince(c.hash);
      h += '<tr><td class="' + (c.revokedAt ? "gone" : "who") + '">' + esc(c.label) +
        (c.role === "admin" ? ' <span class="dim">admin</span>' : "") +
        '<div class="dim">added ' + ago(c.createdAt) +
        (c.revokedAt ? " · revoked " + ago(c.revokedAt) : "") + "</div></td>" +
        "<td>" + (live ? '<span class="on">online now</span>' : ago(c.lastSeen)) + "</td>" +
        '<td class="dim">' + (c.opens || 0) + "</td><td>" +
        (c.revokedAt
          ? '<span class="dim">revoked</span>'
          : '<button type="button" class="cm-it-btn" data-revoke="' + c.hash + '">' +
            (pendingRevoke === c.hash ? "sure?" : "revoke") + "</button>") +
        "</td></tr>";
    }
    h += "</table>";
    if (!codes.length) {
      h += '<div class="dim" style="margin-top:.8rem">no codes yet — everyone is ' +
        "coming in on the shared password.</div>";
    }

    // ---- what's being played ----
    h += "<h2>this week</h2>";
    if (!state.top.length) {
      h += '<div class="dim">nothing opened yet. plays are recorded from now on, and ' +
        "each one is deleted automatically after a fortnight.</div>";
    } else {
      var most = state.top[0][1] || 1;
      h += "<table>";
      for (i = 0; i < state.top.length; i++) {
        h += '<tr><td class="who" style="width:40%">' + esc(state.top[i][0]) + "</td>" +
          '<td><div class="bar"><i style="width:' +
          Math.round((state.top[i][1] / most) * 100) + '%"></i></div></td>' +
          '<td class="dim" style="width:3rem">' + state.top[i][1] + "</td></tr>";
      }
      h += "</table>";
    }

    h += "<h2>recent</h2>";
    if (!state.activity.length) {
      h += '<div class="dim">nothing yet.</div>';
    } else {
      h += "<table>";
      for (i = 0; i < state.activity.length && i < 60; i++) {
        var a = state.activity[i];
        h += '<tr><td class="who" style="width:35%">' + esc(a.label || nameOf(a.code)) +
          "</td><td>" + esc(a.game) + '</td><td class="dim" style="width:8rem">' +
          ago(a.at) + "</td></tr>";
      }
      h += "</table>";
    }

    el.innerHTML = h;
    wire();
  }

  function wire() {
    var mk = document.getElementById("ad-new");
    if (mk) mk.addEventListener("click", createCode);

    var buttons = document.querySelectorAll("[data-revoke]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", onRevoke);
    }
    var shared = document.querySelectorAll("[data-shared]");
    for (i = 0; i < shared.length; i++) {
      shared[i].addEventListener("click", onShared);
    }
  }

  async function createCode() {
    var input = document.getElementById("ad-label");
    var label = input ? input.value : "";
    var res = await fetch("/api/admin/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label }),
    });
    if (!res.ok) return;
    var made = await res.json();
    if (input) input.value = "";
    await load();
    render();
    // Shown once: only a hash is stored, so it can't be looked up later.
    var box = document.getElementById("ad-shown");
    if (box) {
      box.className = "new show";
      box.innerHTML = "<div>code for <strong>" + esc(made.label) + "</strong></div>" +
        "<code>" + esc(made.code) + "</code>" +
        '<div class="dim">write this down now — only a hash of it is stored, so ' +
        "it can't be shown again. they type it where the password goes.</div>";
    }
  }

  // Two clicks, like the other destructive buttons in the hub.
  async function onRevoke(e) {
    var hash = e.currentTarget.getAttribute("data-revoke");
    if (pendingRevoke !== hash) {
      pendingRevoke = hash;
      clearTimeout(revokeTimer);
      revokeTimer = setTimeout(function () { pendingRevoke = null; render(); }, 3000);
      render();
      return;
    }
    pendingRevoke = null;
    clearTimeout(revokeTimer);
    await fetch("/api/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: hash }),
    });
    await load();
    render();
  }

  async function onShared(e) {
    var on = e.currentTarget.getAttribute("data-shared") === "on";
    if (!on && pendingRevoke !== "shared") {
      pendingRevoke = "shared";
      clearTimeout(revokeTimer);
      revokeTimer = setTimeout(function () { pendingRevoke = null; render(); }, 3000);
      e.currentTarget.textContent = "sure?";
      return;
    }
    pendingRevoke = null;
    await fetch("/api/admin/shared", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: on }),
    });
    await load();
    render();
  }

  async function start() {
    try {
      await load();
      render();
    } catch (e) {
      var el = document.getElementById("ad");
      if (el) el.textContent = "";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
