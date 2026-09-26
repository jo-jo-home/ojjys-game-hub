// The admin panel: who has access, which devices they use, and what they play.
//
// Everything comes from /api/admin/state, which 404s for anyone who isn't an
// admin, so this file is inert if it is ever loaded by someone else. It holds
// no secrets and makes no decisions of its own — the server decides, this
// draws the answer.

(function () {
  "use strict";

  var state = null;
  var pending = null;        // a destructive button waiting for its second click
  var pendingTimer = null;
  var openDevices = {};      // which code's device list is expanded

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

  var LIVE = 900000;   // "online" means seen in the last quarter hour
  function isLive(at) { return at && Date.now() - at < LIVE; }

  function nameOf(code) {
    if (code === "owner") return "you";
    if (code === "shared") return "shared password";
    if (state) {
      for (var i = 0; i < state.codes.length; i++) {
        if (state.codes[i].hash === code) return state.codes[i].label;
      }
    }
    return code.slice(0, 8) + "…";
  }

  // ---- talking to the server ---------------------------------------------

  async function load() {
    var res = await fetch("/api/admin/state", { cache: "no-store" });
    if (!res.ok) { var e = new Error("no access"); e.status = res.status; throw e; }
    state = await res.json();
  }

  async function send(path, body) {
    var res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      notify(res.status === 404
        ? "that didn't work — this session is no longer an admin session. sign in again with your admin code."
        : "that didn't work — the server answered " + res.status + ".");
      return null;
    }
    return res;
  }

  async function reload() { await load(); render(); }

  // ---- the pieces ---------------------------------------------------------

  // What the owner actually came here to do, so it is the first thing on the
  // page and the button is the only filled-in one.
  function createSection() {
    return '<h2>give someone access</h2>' +
      '<div class="sub">they type the code where the password goes. you see it ' +
      'once — only a hash is stored.</div>' +
      '<div class="card"><div class="row">' +
      '<input type="text" id="ad-label" placeholder="who is this for? e.g. sam" maxlength="40" style="flex:1;min-width:12rem">' +
      '<button type="button" class="ad-btn primary" id="ad-new">create a code</button>' +
      '</div></div>' +
      '<div class="new" id="ad-shown"></div>';
  }

  function verdictTag(c) {
    if (c.suspicion === "high") {
      return '<span class="tag bad">two devices at once, different networks</span>';
    }
    if (c.suspicion === "likely") {
      return '<span class="tag warn">' + c.active + " devices, " + c.networks + " networks</span>";
    }
    if (c.suspicion === "maybe") return '<span class="tag warn">3 devices</span>';
    if (c.active) return '<span class="tag ok">' + c.active + (c.active === 1 ? " device" : " devices") + "</span>";
    return '<span class="tag">no devices yet</span>';
  }

  function deviceRows(code, devices) {
    if (!devices || !devices.length) {
      return '<div class="dim">nothing has signed in with this code yet.</div>';
    }
    var nets = {}, n = 0, h = "";
    devices.forEach(function (d) { if (d.net && !nets[d.net]) nets[d.net] = ++n; });
    devices.slice().sort(function (a, b) { return b.last - a.last; }).forEach(function (d) {
      h += '<div class="dev"><div>' +
        '<div class="who' + (d.blocked ? " gone" : "") + '">' +
        esc(d.label || d.ua) + (d.blocked ? ' <span class="tag bad">blocked</span>' : "") +
        (isLive(d.last) ? ' <span class="on">● online</span>' : "") + "</div>" +
        '<div class="dev-m">' + esc(d.ua) +
        (d.net ? " · network " + nets[d.net] : "") +
        " · " + (d.opens || 0) + " opens · first seen " + ago(d.first) +
        " · last " + ago(d.last) + "</div></div>" +
        '<div class="row">' +
        '<button type="button" class="ad-btn small" data-act="label" data-code="' + esc(code) +
          '" data-dev="' + esc(d.id) + '">rename</button>' +
        '<button type="button" class="ad-btn small' + (d.blocked ? "" : " danger") +
          '" data-act="' + (d.blocked ? "unblock" : "block") + '" data-code="' + esc(code) +
          '" data-dev="' + esc(d.id) + '">' + (d.blocked ? "allow" : "block") + "</button>" +
        "</div></div>";
    });
    return h;
  }

  function codeCard(c) {
    var live = c.devices && c.devices.some(function (d) { return isLive(d.last); });
    var open = openDevices[c.hash];
    var h = '<div class="card">';
    h += '<div class="row spread"><div>' +
      '<span class="who' + (c.revokedAt ? " gone" : "") + '">' + esc(c.label) + "</span> " +
      (c.role === "admin" ? '<span class="tag">admin</span> ' : "") +
      (c.revokedAt ? '<span class="tag bad">revoked</span> ' : verdictTag(c)) +
      (live ? ' <span class="on">● online now</span>' : "") +
      '<div class="dim">added ' + ago(c.createdAt) + " · last seen " + ago(c.lastSeen) +
      " · " + (c.opens || 0) + " games opened</div></div>";

    h += '<div class="row">';
    if (!c.revokedAt) {
      h += '<button type="button" class="ad-btn small" data-toggle="' + esc(c.hash) + '">' +
        (open ? "hide" : "devices (" + ((c.devices || []).length) + ")") + "</button>";
      h += '<span class="dim">max devices</span>' +
        '<input type="number" min="0" max="20" value="' + (c.deviceLimit || 0) +
        '" data-limit="' + esc(c.hash) + '" title="0 means no limit — just tell me">';
      h += '<button type="button" class="ad-btn small danger" data-revoke="' + esc(c.hash) + '">' +
        (pending === c.hash ? "sure?" : "revoke") + "</button>";
    }
    h += "</div></div>";

    if (!c.revokedAt) {
      h += '<div class="devs' + (open ? " open" : "") + '">' + deviceRows(c.hash, c.devices) + "</div>";
    }
    return h + "</div>";
  }

  function render() {
    var el = document.getElementById("ad");
    if (!el) return;
    var h = createSection();

    // ---- people ----
    h += "<h2>people</h2>";
    var codes = (state.codes || []).slice().sort(function (a, b) {
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });
    if (!codes.length) {
      h += '<div class="sub">no codes yet — everyone is coming in on the shared password, ' +
        "which means you can't tell them apart. make one above.</div>";
    } else {
      h += '<div class="sub">a code is one person. the devices behind it are how you ' +
        "tell whether it is being passed around.</div>";
    }
    codes.forEach(function (c) { h += codeCard(c); });

    // ---- the shared password, treated as the code it is ----
    var sd = state.sharedDevices || [];
    var sv = state.shared || { active: 0, networks: 0, suspicion: "none" };
    h += "<h2>shared password</h2>";
    h += '<div class="sub">' + (state.sharedEnabled
      ? "still accepted. anyone who has ever had it still gets in, and they all look the same to you."
      : "retired — no longer accepted.") + "</div>";
    h += '<div class="card"><div class="row spread"><div>' +
      '<span class="who' + (state.sharedEnabled ? "" : " gone") + '">shared password</span> ' +
      '<span class="tag' + (sd.length >= 4 ? " warn" : "") + '">' + sd.length +
      (sd.length === 1 ? " device" : " devices") + "</span>" +
      '<div class="dim">' + (isLive(state.online.shared) ? "someone is on it now" : "last used " + ago(state.online.shared)) + "</div></div>" +
      '<div class="row">' +
      (sd.length ? '<button type="button" class="ad-btn small" data-toggle="shared">' +
        (openDevices.shared ? "hide" : "devices (" + sd.length + ")") + "</button>" : "") +
      (state.sharedEnabled
        ? '<button type="button" class="ad-btn small danger" data-shared="off">' +
          (pending === "shared" ? "sure?" : "retire") + "</button>"
        : '<button type="button" class="ad-btn small" data-shared="on">allow again</button>') +
      "</div></div>" +
      (sd.length ? '<div class="devs' + (openDevices.shared ? " open" : "") + '">' +
        deviceRows("shared", sd) + "</div>" : "") +
      "</div>";

    // ---- what is being played ----
    h += "<h2>this week</h2>";
    if (!state.top.length) {
      h += '<div class="sub">nothing opened yet. plays are recorded from now on, and each ' +
        "one is deleted automatically after a fortnight.</div>";
    } else {
      var most = state.top[0][1] || 1;
      h += "<table>";
      state.top.forEach(function (t) {
        h += '<tr><td class="who" style="width:40%">' + esc(t[0]) + "</td>" +
          '<td><div class="bar"><i style="width:' + Math.round((t[1] / most) * 100) + '%"></i></div></td>' +
          '<td class="dim" style="width:3rem">' + t[1] + "</td></tr>";
      });
      h += "</table>";
    }

    h += "<h2>recent</h2>";
    if (!state.activity.length) {
      h += '<div class="sub">nothing yet.</div>';
    } else {
      h += "<table>";
      state.activity.slice(0, 60).forEach(function (a) {
        h += '<tr><td class="who" style="width:32%">' + esc(a.label || nameOf(a.code)) + "</td>" +
          "<td>" + esc(a.game) + '</td><td class="dim" style="width:8rem">' + ago(a.at) + "</td></tr>";
      });
      h += "</table>";
    }

    h += '<div class="note">a device is a browser, not a person. someone with a laptop and ' +
      "a phone shows as two, and clearing site data makes one look new. treat the warnings " +
      "as worth a look, not as proof. devices are forgotten after two months of no use, and " +
      "addresses are stored only as a hash — enough to tell two networks apart, not enough " +
      "to say where anybody is.</div>";

    el.innerHTML = h;
    wire();
  }

  function fatal(status) {
    var el = document.getElementById("ad");
    if (!el) return;
    var msg = status === 404
      ? "this session isn't an admin session.\n\nthe panel only opens for a session that " +
        "signed in with ADMIN_CODE. if you just set that variable in deno deploy, the site " +
        "has to be redeployed before it takes effect — it is read once when the server " +
        "starts. check /api/session: it answers {\"ok\":true,\"admin\":true} for an admin session."
      : status
        ? "the server answered " + status + "."
        : "couldn't reach the server. this page needs to be online.";
    el.innerHTML = '<h2>admin</h2><div class="sub" style="white-space:pre-line">' + esc(msg) + "</div>";
  }

  function notify(message) {
    var box = document.getElementById("ad-shown");
    if (!box) return;
    box.className = "new show";
    box.innerHTML = '<div class="dim">' + esc(message) + "</div>";
  }

  // ---- events -------------------------------------------------------------

  function wire() {
    var mk = document.getElementById("ad-new");
    if (mk) mk.addEventListener("click", createCode);
    var label = document.getElementById("ad-label");
    if (label) {
      label.addEventListener("keydown", function (e) {
        if (e.key === "Enter") createCode();
      });
    }
    each("[data-toggle]", "click", function (e) {
      var k = e.currentTarget.getAttribute("data-toggle");
      openDevices[k] = !openDevices[k];
      render();
    });
    each("[data-revoke]", "click", onRevoke);
    each("[data-shared]", "click", onShared);
    each("[data-act]", "click", onDevice);
    each("[data-limit]", "change", onLimit);
  }

  function each(sel, type, fn) {
    var n = document.querySelectorAll(sel);
    for (var i = 0; i < n.length; i++) n[i].addEventListener(type, fn);
  }

  // Two clicks for anything that takes access away, with the armed state
  // clearing itself so a stray first click doesn't stay armed forever.
  function arm(key, redraw) {
    if (pending === key) { pending = null; clearTimeout(pendingTimer); return true; }
    pending = key;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { pending = null; render(); }, 3000);
    if (redraw !== false) render();
    return false;
  }

  async function createCode() {
    var input = document.getElementById("ad-label");
    var label = input ? input.value : "";
    var res = await send("/api/admin/code", { label: label });
    if (!res) return;
    var made = await res.json();
    await reload();
    var box = document.getElementById("ad-shown");
    if (box) {
      box.className = "new show";
      box.innerHTML = "<div>code for <strong>" + esc(made.label) + "</strong></div>" +
        "<code>" + esc(made.code) + "</code>" +
        '<div class="dim">write this down now — only a hash of it is stored, so it ' +
        "can't be shown again. they type it where the password goes.</div>";
    }
  }

  async function onRevoke(e) {
    var hash = e.currentTarget.getAttribute("data-revoke");
    if (!arm(hash)) return;
    if (!await send("/api/admin/revoke", { hash: hash })) return;
    await reload();
  }

  async function onShared(e) {
    var on = e.currentTarget.getAttribute("data-shared") === "on";
    if (!on && !arm("shared")) return;
    pending = null;
    if (!await send("/api/admin/shared", { on: on })) return;
    await reload();
  }

  async function onDevice(e) {
    var b = e.currentTarget;
    var act = b.getAttribute("data-act");
    var code = b.getAttribute("data-code");
    var dev = b.getAttribute("data-dev");
    var body = { code: code, device: dev, action: act };
    if (act === "label") {
      var name = prompt("name this device");
      if (name === null) return;
      body.label = name;
    }
    if (act === "block" && !arm("d:" + dev, false)) {
      b.textContent = "sure?";
      return;
    }
    if (!await send("/api/admin/device", body)) return;
    await reload();
  }

  async function onLimit(e) {
    var hash = e.currentTarget.getAttribute("data-limit");
    if (!await send("/api/admin/limit", { hash: hash, limit: e.currentTarget.value })) return;
    await reload();
  }

  async function start() {
    try {
      await load();
      render();
    } catch (e) {
      fatal(e && e.status);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
