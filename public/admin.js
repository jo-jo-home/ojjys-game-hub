// The admin panel: who has access, which devices they use, and what they play.
//
// Everything comes from /api/admin/*, which 404s for anyone who isn't an
// admin, so this file is inert if it is ever loaded by someone else. It holds
// no secrets and makes no decisions of its own — the server decides, this
// draws the answer.

(function () {
  "use strict";

  var state = null;
  var pending = null;        // a destructive button waiting for its second click
  var pendingTimer = null;
  var openDevices = {};      // which code's device list is expanded
  var editingAccount = "";
  var accountMessage = "";
  var accountError = false;
  var shownPassword = null; // shown once after an explicit reset; never persisted
  var feedback = { items: [], cursor: null, kind: "", status: "new", loaded: false, busy: false, generation: 0, error: "" };
  var FEEDBACK_KINDS = { idea: "hub idea", bug: "broken game", game: "game request" };
  var FEEDBACK_STATUSES = { new: "new", planned: "planned / investigating", done: "done / fixed", closed: "closed" };

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

  function dur(ms) {
    var sec = Math.round((ms || 0) / 1000);
    if (sec < 60) return sec + "s";
    var m = Math.floor(sec / 60);
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m";
  }

  var LIVE = 900000;   // "online" means seen in the last quarter hour
  function isLive(at) { return at && Date.now() - at < LIVE; }

  function nameOf(code) {
    if (code === "owner") return "you";
    if (code === "shared") return "shared password";
    if (state) {
      var account = (state.accounts || []).find(function (a) { return a.id === code; });
      if (account) return account.label;
      for (var i = 0; i < state.codes.length; i++) {
        if (state.codes[i].hash === code) return state.codes[i].label;
      }
    }
    return code.slice(0, 8) + "…";
  }

  // ---- talking to the server ---------------------------------------------

  function apiUrl(path) {
    var token = document.body.getAttribute("data-token") || "";
    return path + (/^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{10,}\.[a-f0-9]{64})$/.test(token) ? (path.indexOf("?") < 0 ? "?" : "&") + "token=" + token : "");
  }

  async function load() {
    var res = await fetch(apiUrl("/api/admin/state"), { cache: "no-store" });
    if (!res.ok) { var e = new Error("no access"); e.status = res.status; throw e; }
    state = await res.json();
  }

  async function send(path, body) {
    var res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      notify(res.status === 404
        ? "that didn't work — this session is no longer an admin session. sign in again with your admin account."
        : "that didn't work — the server answered " + res.status + ".");
      return null;
    }
    return res;
  }

  async function reload() { await load(); render(); }

  // ---- the pieces ---------------------------------------------------------

  function accountsSection() {
    var owner = state.ownerAccount || { username: "ojjy", configured: false };
    var h = '<h2>login accounts</h2><div class="sub">create a username and password for each person.</div>' +
      '<div class="card"><span class="who">' + esc(owner.username) + '</span> <span class="tag">owner</span>' +
      '<div class="dim">' + (owner.configured
        ? 'password is managed through ADMIN_PASSWORD in Deno'
        : 'set ADMIN_PASSWORD in Deno and redeploy to enable owner username/password sign-in') + '</div></div>' +
      '<form class="card ac-form" id="ac-create"><div class="ac-grid">' +
      '<label>username<input type="text" name="username" required minlength="3" maxlength="32" placeholder="e.g. sam" autocomplete="off" autocapitalize="none" spellcheck="false"></label>' +
      '<label>display name (optional)<input type="text" name="label" maxlength="40" placeholder="e.g. Sam" autocomplete="off"></label>' +
      '<label>password<input type="password" name="password" required maxlength="128" placeholder="enter password" autocomplete="new-password"></label></div>' +
      '<button class="ad-btn primary" type="submit">create account</button></form>' +
      '<p id="ac-message" class="fb-message' + (accountError ? ' error' : '') + '" role="status" aria-live="polite">' + esc(accountMessage) + '</p>';
    if (shownPassword) h += '<div class="card ac-password"><strong>new password for ' + esc(shownPassword.username) + '</strong>' +
      '<p class="dim">shown only here after the reset. existing passwords cannot be recovered from their hashes.</p>' +
      '<input id="generated-password" type="password" readonly value="' + esc(shownPassword.password) + '" aria-label="new password">' +
      '<div class="row"><button type="button" class="ad-btn small" id="ac-show-password">show password</button>' +
      '<button type="button" class="ad-btn small" id="ac-copy-password">copy password</button>' +
      '<button type="button" class="ad-btn small" id="ac-hide-password">dismiss</button></div></div>';
    var entries = state.accounts || [];
    if (!entries.length) h += '<div class="sub">no user accounts yet.</div>';
    entries.forEach(function (a) {
      var key = a.username.toLowerCase();
      var status = a.status || (a.disabled ? 'banned' : 'active');
      h += '<div class="card ac-account"><div class="row spread"><div>' +
        '<span class="who">' + esc(a.label) + '</span> <span class="tag">' + esc(a.username) + '</span> ' +
        '<span class="tag ' + (status === 'active' ? 'ok' : status === 'suspended' ? 'warn' : 'bad') + '">' + esc(status) + '</span>' +
        '<div class="dim">created ' + ago(a.createdAt) + ' · last sign-in ' + ago(a.lastLogin) + '</div></div>' +
        '<div class="row"><button class="ad-btn small" type="button" data-account-edit="' + esc(key) + '">' + (editingAccount === key ? 'cancel edit' : 'edit / reset password') + '</button>' +
        '<button class="ad-btn small" type="button" data-reset-account="' + esc(key) + '">' + (pending === 'reset:' + key ? 'reset password?' : 'reset & show password') + '</button>' +
        '<button class="ad-btn small" type="button" data-account-action="' + (status === 'active' ? 'ban' : 'enable') + '" data-account="' + esc(key) + '">' + (status === 'active' ? (pending === 'account:ban:' + key ? 'sure?' : 'ban') : 'restore access') + '</button>' +
        '<button class="ad-btn small" type="button" data-account-action="sign-out" data-account="' + esc(key) + '">sign out devices</button>' +
        '<button class="ad-btn small danger" type="button" data-account-action="delete" data-account="' + esc(key) + '">' + (pending === 'account:delete:' + key ? 'sure?' : 'delete') + '</button></div></div>';
      if (status === 'suspended') h += '<p class="dim">suspended until ' + esc(new Date(a.suspendedUntil).toLocaleString()) + ' — access returns automatically after this time</p>';
      if (status !== 'active' && a.restrictionReason) h += '<p class="dim">reason: ' + esc(a.restrictionReason) + '</p>';
      if (editingAccount === key) {
        h += '<form class="ac-form ac-edit" data-account-save="' + esc(key) + '"><div class="ac-grid">' +
          '<label>display name<input type="text" name="label" value="' + esc(a.label) + '" maxlength="40"></label>' +
          '<label>new password (optional)<input type="password" name="password" maxlength="128" placeholder="leave blank to keep it" autocomplete="new-password"></label></div>' +
          '<button class="ad-btn primary small" type="submit">save account</button>' +
          '<p class="dim">password resets sign this account out on every device.</p></form>' +
          '<form class="ac-form ac-edit" data-account-suspend="' + esc(key) + '"><div class="ac-grid">' +
          '<label>suspend for<select name="duration"><option value="15">15 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="43200">30 days</option><option value="custom">custom minutes</option></select></label>' +
          '<label class="ac-custom-duration" hidden>minutes<input type="number" name="minutes" min="1" max="525600" placeholder="number of minutes"></label>' +
          '<label>reason (optional)<input type="text" name="reason" maxlength="200" placeholder="why is access suspended?"></label></div>' +
          '<button type="submit" class="ad-btn">suspend account</button></form>';
      }
      h += '</div>';
    });
    return h;
  }

  async function saveAccount(body, success) {
    accountMessage = "";
    try {
      var res = await fetch(apiUrl("/api/admin/accounts"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "couldn't save the account");
      if (data.password) shownPassword = { username: body.username, password: data.password };
      else if (shownPassword && shownPassword.username === body.username && (body.action === 'delete' || body.password)) shownPassword = null;
      accountMessage = success;
      accountError = false;
      editingAccount = "";
      await reload();
    } catch (e) {
      accountMessage = e.message || "couldn't reach the server — try again";
      accountError = true;
      var message = document.getElementById("ac-message");
      if (message) { message.textContent = accountMessage; message.classList.add("error"); }
    }
  }

  async function createAccount(e) {
    e.preventDefault();
    var form = e.currentTarget;
    if (!form.reportValidity()) return;
    var submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await saveAccount({ action: "create", username: form.elements.username.value,
        label: form.elements.label.value, password: form.elements.password.value }, "account created — give them the username and password to sign in");
    } finally { submit.disabled = false; }
  }

  async function updateAccount(e) {
    e.preventDefault();
    var form = e.currentTarget;
    if (!form.reportValidity()) return;
    var submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await saveAccount({ action: "update", username: form.getAttribute("data-account-save"),
        label: form.elements.label.value, password: form.elements.password.value }, "account updated");
    } finally { submit.disabled = false; }
  }

  async function accountAction(e) {
    var button = e.currentTarget, action = button.getAttribute("data-account-action");
    var username = button.getAttribute("data-account");
    if ((action === "delete" || action === "ban") && !arm("account:" + action + ':' + username)) return;
    button.disabled = true;
    var descriptions = { delete: 'deleted', ban: 'banned', enable: 'restored', 'sign-out': 'signed out on all devices' };
    try { await saveAccount({ action: action, username: username }, "account " + (descriptions[action] || 'updated')); }
    finally { button.disabled = false; }
  }

  async function suspendAccount(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var minutes = form.elements.duration.value === 'custom' ? Number(form.elements.minutes.value) : Number(form.elements.duration.value);
    if (!form.reportValidity()) return;
    var button = form.querySelector('button'); button.disabled = true;
    try { await saveAccount({ action: 'suspend', username: form.getAttribute('data-account-suspend'), durationMinutes: minutes, reason: form.elements.reason.value }, 'account suspended — access will return automatically at the displayed time'); }
    finally { button.disabled = false; }
  }

  async function resetPassword(e) {
    var key = e.currentTarget.getAttribute('data-reset-account');
    if (!arm('reset:' + key)) return;
    await saveAccount({ action: 'reset-password', username: key }, 'password reset — copy the new password below');
  }

  function accessButton(action, label, target) {
    target = target || {};
    var key = 'access:' + action + ':' + (target.hash || target.id || '');
    return '<button type="button" class="ad-btn small' + (action.indexOf('delete') === 0 || action === 'remove-all' ? ' danger' : '') + '" data-access-action="' + action + '"' +
      (target.hash ? ' data-access-hash="' + esc(target.hash) + '"' : '') + (target.id ? ' data-access-id="' + esc(target.id) + '"' : '') + '>' + (pending === key ? 'confirm?' : label) + '</button>';
  }

  async function accessAction(e) {
    var button = e.currentTarget, action = button.getAttribute('data-access-action');
    var hash = button.getAttribute('data-access-hash') || '', id = button.getAttribute('data-access-id') || '';
    // The one action that erases everything deserves more than an armed
    // second click — make the consequence explicit and wait for a real OK.
    if (action === 'remove-all' && !window.confirm(
      "delete EVERY user account, access code and other login session?\n\n" +
      "accounts and passwords cannot be recovered. this is the most destructive button in the panel."))
      return;
    if (action !== 'legacy-on' && !arm('access:' + action + ':' + (hash || id))) return;
    button.disabled = true;
    try {
      var res = await fetch(apiUrl('/api/admin/access'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action, hash: hash, id: id }) });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'could not update access');
      accountMessage = 'access updated'; accountError = false;
      if (action === 'remove-all') shownPassword = null;
      await reload();
    } catch (error) { notify(error.message || 'could not reach the server'); }
    finally { button.disabled = false; }
  }

  function accessSection() {
    var policy = state.accessPolicy || {};
    var h = '<h2>all sign-in access</h2><div class="sub">manage legacy credentials and sessions here. access-code creation has been removed.</div>' +
      '<button type="button" class="ad-btn" id="access-refresh">refresh access</button><p id="ad-shown" class="fb-message" role="status"></p>' +
      '<div class="card"><div class="row spread"><div><span class="who">legacy sign-in</span><div class="dim">' + (policy.legacyEnabled ? 'access codes and the shared password are allowed' : 'accounts-only — all legacy sign-in is off') + '</div></div>' +
      accessButton(policy.legacyEnabled ? 'legacy-off' : 'legacy-on', policy.legacyEnabled ? 'require accounts only' : 'allow remaining legacy credentials') + '</div></div>' +
      '<div class="card"><div class="row spread"><div><span class="who">shared-password access</span><div class="dim">' + (policy.sharedDeleted ? 'permanently removed' : policy.sharedEnabled ? 'active' : 'inactive') + '</div></div>' +
      (policy.sharedDeleted ? '' : accessButton('delete-shared', 'remove shared-password access')) + '</div></div>';
    if (policy.adminCodeConfigured) h += '<div class="card"><div class="row spread"><div><span class="who">legacy ADMIN_CODE access</span><div class="dim">' + (policy.adminCodeDeleted ? 'permanently removed' : policy.adminCodeEnabled ? 'active' : 'inactive') + '</div></div>' +
      (policy.adminCodeDeleted ? '' : accessButton('delete-admin-code', 'remove legacy admin-code access')) + '</div></div>';
    h += '<h2>stored access codes / hashes</h2>';
    var codes = state.codes || [];
    if (!codes.length) h += '<div class="sub">no stored access-code hashes remain.</div>';
    codes.forEach(function (code) { h += codeCard(code); });
    if (codes.length) h += '<div class="row">' + accessButton('delete-codes', 'delete every access-code hash') + '</div>';
    h += '<h2>login sessions</h2><div class="sub">ending a session signs that browser out. delete or ban its credentials to block future sign-ins.</div>';
    (state.sessions || []).forEach(function (session) {
      h += '<div class="card"><div class="row spread"><div><span class="who">' + esc(session.username || session.label) + '</span> ' + (session.current ? '<span class="tag ok">this session</span>' : '') +
        '<div class="dim">last seen ' + ago(session.seen) + ' · session ' + esc(session.id.slice(0, 8)) + (session.device ? ' · browser ' + esc(session.device.slice(0, 8)) : '') + '</div></div>' +
        (session.current ? '' : accessButton('revoke-session', 'end session', { id: session.id })) + '</div></div>';
    });
    h += '<div class="row">' + accessButton('revoke-sessions', 'sign out everyone else') + '</div>' +
      '<h2>remove all other access</h2><div class="sub">deletes all user accounts and their password hashes, all access-code hashes, legacy password/code access, and every other session. your ojjy environment-managed owner login is retained.</div>' +
      accessButton('remove-all', 'remove all other access');
    return h;
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
      " · " + (c.opens || 0) + " games opened · " +
      dur((state.playtimeByCode || {})[c.hash] || 0) + " played</div></div>";

    h += '<div class="row">';
    if (!c.revokedAt) {
      h += '<button type="button" class="ad-btn small" data-toggle="' + esc(c.hash) + '">' +
        (open ? "hide" : "devices (" + ((c.devices || []).length) + ")") + "</button>";
      h += '<span class="dim">max devices</span>' +
        '<input type="number" min="0" max="20" value="' + (c.deviceLimit || 0) +
        '" data-limit="' + esc(c.hash) + '" title="0 means no limit — just tell me">';
    }
    h += "</div></div>";
    h += '<details class="ac-hash"><summary>stored code hash</summary><code>' + esc(c.hash) + '</code></details>';
    h += accessButton('delete-code', 'delete code and hash', { hash: c.hash });

    if (!c.revokedAt) {
      h += '<div class="devs' + (open ? " open" : "") + '">' + deviceRows(c.hash, c.devices) + "</div>";
    }
    return h + "</div>";
  }

  // ---- suggestions and reports -------------------------------------------

  function feedbackOptions(values, selected) {
    return Object.keys(values).map(function (key) {
      return '<option value="' + esc(key) + '"' + (selected === key ? " selected" : "") + '>' +
        esc(values[key]) + "</option>";
    }).join("");
  }

  function feedbackSection() {
    return '<section aria-labelledby="ad-fb-heading"><h2 id="ad-fb-heading">suggestions &amp; reports</h2>' +
      '<div class="sub">ideas, broken games, and games people want added. only admins can read this inbox.</div>' +
      '<div class="fb-filters"><label>type<select id="ad-fb-kind">' +
      feedbackOptions(Object.assign({ "": "all types" }, FEEDBACK_KINDS), feedback.kind) +
      '</select></label><label>status<select id="ad-fb-filter">' +
      feedbackOptions(Object.assign({ "": "all statuses" }, FEEDBACK_STATUSES), feedback.status) +
      '</select></label><button type="button" class="ad-btn" id="ad-fb-refresh">refresh inbox</button></div>' +
      '<p id="ad-fb-message" class="fb-message" role="status" aria-live="polite"></p>' +
      '<div id="ad-fb-list"></div><button type="button" class="ad-btn" id="ad-fb-more" hidden>load older submissions</button></section>';
  }

  function renderFeedback() {
    var list = document.getElementById("ad-fb-list");
    if (!list) return;
    var msg = document.getElementById("ad-fb-message");
    msg.textContent = feedback.error || (feedback.busy ? "loading submissions…" : "");
    msg.classList.toggle("error", !!feedback.error);
    var h = "";
    feedback.items.forEach(function (item) {
      h += '<article class="card fb-entry"><div class="row spread">' +
        '<span class="tag">' + esc(FEEDBACK_KINDS[item.kind] || item.kind) + '</span>' +
        '<select class="fb-status" data-feedback-id="' + esc(item.id) + '" data-previous="' + esc(item.status) +
        '" aria-label="status for ' + esc(item.title) + '">' +
        feedbackOptions(FEEDBACK_STATUSES, item.status) + '</select></div>' +
        '<h3>' + esc(item.title) + '</h3>' +
        (item.gameName ? '<div class="dim">game: ' + esc(item.gameName) + '</div>' : "") +
        (item.details ? '<p>' + esc(item.details) + '</p>' : "") +
        '<div class="dim">from ' + esc(item.name || item.label) +
        (item.name ? ' · access: ' + esc(item.label) : '') +
        ' · ' + ago(item.createdAt) + '</div></article>';
    });
    if (!feedback.items.length && !feedback.busy && !feedback.error) {
      h = '<p class="fb-inbox-note">no submissions match these filters yet.</p>';
    }
    list.innerHTML = h;
    var more = document.getElementById("ad-fb-more");
    more.hidden = !feedback.cursor;
    more.disabled = feedback.busy;
    document.getElementById("ad-fb-refresh").disabled = feedback.busy;
  }

  async function loadFeedback(append) {
    var generation = ++feedback.generation;
    var params = new URLSearchParams();
    if (feedback.kind) params.set("kind", feedback.kind);
    if (feedback.status) params.set("status", feedback.status);
    if (append && feedback.cursor) params.set("cursor", feedback.cursor);
    if (!append) { feedback.items = []; feedback.cursor = null; }
    feedback.busy = true;
    feedback.error = "";
    renderFeedback();
    try {
      var res = await fetch(apiUrl("/api/admin/feedback?" + params.toString()), { cache: "no-store" });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "couldn't load the inbox");
      if (generation !== feedback.generation) return;
      feedback.items = append ? feedback.items.concat(data.items) : data.items;
      feedback.cursor = data.cursor;
    } catch (e) {
      if (generation === feedback.generation) feedback.error = "couldn't load submissions — refresh to try again.";
    } finally {
      if (generation === feedback.generation) {
        feedback.busy = false;
        feedback.loaded = true;
        renderFeedback();
      }
    }
  }

  async function onFeedbackStatus(e) {
    var select = e.target;
    var id = select.getAttribute("data-feedback-id");
    if (!id) return;
    select.disabled = true;
    try {
      var res = await fetch(apiUrl("/api/admin/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, status: select.value }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "couldn't save that status");
      await loadFeedback(false);
    } catch (error) {
      select.value = select.getAttribute("data-previous");
      var msg = document.getElementById("ad-fb-message");
      msg.textContent = "couldn't update this submission — refresh the inbox and try again.";
      msg.classList.add("error");
    } finally { select.disabled = false; }
  }

  function render() {
    var el = document.getElementById("ad");
    if (!el) return;
    var h = accountsSection() + accessSection();
    h += feedbackSection();

    // The database canary: if the reset marker was written in the last two
    // days, the deployment's KV database was wiped or reset underneath the
    // hub — which is how accounts "disappear" and everyone gets logged out
    // at once. Nothing in the hub's code deletes accounts on its own, so
    // say so plainly when the evidence shows it.
    if (state.dbBorn && Date.now() - state.dbBorn < 2 * 86400000) {
      h = '<div class="card" style="border-color:var(--warn)">' +
        '<span class="who" style="color:var(--warn)">the database was reset recently</span>' +
        '<div class="dim" style="margin-top:.4rem">accounts or sessions that vanished were lost when ' +
        "the hub's database was reset — that happens on the Deno Deploy side, not in this site's code. " +
        "sign-ins created after the reset are unaffected.</div></div>" + h;
    }

    // ---- playing right now ----
    h += "<h2>playing right now</h2>";
    h += '<div class="sub">who has a game open at this moment, updated live. ' +
      "someone drops off a few seconds after they close the tab.</div>";
    h += '<div id="ad-live" class="live"></div>';

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

    h += "<h2>time played this season</h2>";
    if (!state.playtimeTop || !state.playtimeTop.length) {
      h += '<div class="sub">no playtime recorded yet. it starts counting when ' +
        "someone opens a game from now on.</div>";
    } else {
      h += '<div class="sub">' + dur(state.totalMs || 0) + " across everyone. by game:</div>";
      var pmost = state.playtimeTop[0][1] || 1;
      h += "<table>";
      state.playtimeTop.forEach(function (t) {
        h += '<tr><td class="who" style="width:40%">' + esc(t[0]) + "</td>" +
          '<td><div class="bar"><i style="width:' + Math.round((t[1] / pmost) * 100) + '%"></i></div></td>' +
          '<td class="dim" style="width:5rem">' + dur(t[1]) + "</td></tr>";
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
    // One choreographed entrance, the first time the panel draws; every
    // later re-render (an action, a poll) must land still.
    if (!drewOnce) {
      drewOnce = true;
      try {
        el.classList.add("enter");
        for (var i = 0; i < el.children.length; i++) {
          el.children[i].style.setProperty("--i", Math.min(i, 9));
        }
        setTimeout(function () { el.classList.remove("enter"); }, 1500);
      } catch (e) { /* decorative only */ }
    }
    wire();
    renderLive(state.now || []);
    renderFeedback();
    if (!feedback.loaded && !feedback.busy) loadFeedback(false);
  }

  var drewOnce = false;

  function renderLive(list) {
    var box = document.getElementById("ad-live");
    if (!box) return;
    var live = (list || []).filter(function (n) { return Date.now() - n.at < 60000; });
    if (!live.length) {
      box.innerHTML = '<div class="dim">nobody is in a game right now.</div>';
      return;
    }
    var h = "";
    live.sort(function (a, b) { return b.at - a.at; }).forEach(function (n) {
      h += '<div class="nowrow"><span class="on">●</span> ' +
        '<span class="who">' + esc(n.label || nameOf(n.code)) + "</span>" +
        '<span class="dim"> is playing </span><span>' + esc(n.game) + "</span></div>";
    });
    box.innerHTML = h;
  }

  async function pollLive() {
    try {
      var res = await fetch(apiUrl("/api/admin/live"), { cache: "no-store" });
      if (!res.ok) return;
      var d = await res.json();
      if (state) state.now = d.now;
      renderLive(d.now || []);
    } catch (e) { /* a missed poll is harmless; the next one covers it */ }
  }

  function fatal(status) {
    var el = document.getElementById("ad");
    if (!el) return;
    var msg = status === 404
      ? "this session isn't an admin session.\n\nthe panel only opens for a session that " +
        "signed in as ojjy using ADMIN_PASSWORD. if you just set that variable in deno deploy, the site " +
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
    box.textContent = message;
    box.classList.add('error');
  }

  // ---- events -------------------------------------------------------------

  function wire() {
    each("#ac-create", "submit", createAccount);
    each("[data-account-save]", "submit", updateAccount);
    each("[data-account-action]", "click", accountAction);
    each("[data-account-suspend]", "submit", suspendAccount);
    each("[data-reset-account]", "click", resetPassword);
    each("[data-access-action]", "click", accessAction);
    each("#access-refresh", "click", reload);
    each("[data-account-suspend] select", "change", function (e) {
      var form = e.currentTarget.form, custom = e.currentTarget.value === 'custom';
      form.querySelector('.ac-custom-duration').hidden = !custom;
      form.elements.minutes.required = custom;
    });
    each("#ac-show-password", "click", function (e) {
      var field = document.getElementById('generated-password');
      field.type = field.type === 'password' ? 'text' : 'password';
      e.currentTarget.textContent = field.type === 'password' ? 'show password' : 'hide password';
    });
    each("#ac-hide-password", "click", function () { shownPassword = null; render(); });
    each("#ac-copy-password", "click", async function (e) {
      if (!shownPassword) return;
      try { await navigator.clipboard.writeText(shownPassword.password); e.currentTarget.textContent = 'copied'; }
      catch (error) {
        var field = document.getElementById('generated-password'); field.type = 'text'; field.select();
        e.currentTarget.textContent = document.execCommand('copy') ? 'copied' : 'select and copy the password';
      }
    });
    each("[data-account-edit]", "click", function (e) {
      var key = e.currentTarget.getAttribute("data-account-edit");
      editingAccount = editingAccount === key ? "" : key;
      render();
    });
    each("[data-toggle]", "click", function (e) {
      var k = e.currentTarget.getAttribute("data-toggle");
      openDevices[k] = !openDevices[k];
      render();
    });
    each("[data-act]", "click", onDevice);
    each("[data-limit]", "change", onLimit);
    each("#ad-fb-kind", "change", function (e) {
      feedback.kind = e.currentTarget.value;
      loadFeedback(false);
    });
    each("#ad-fb-filter", "change", function (e) {
      feedback.status = e.currentTarget.value;
      loadFeedback(false);
    });
    each("#ad-fb-refresh", "click", function () { loadFeedback(false); });
    each("#ad-fb-more", "click", function () { loadFeedback(true); });
    each("#ad-fb-list", "change", onFeedbackStatus);
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

  var pollTimer = null;
  async function start() {
    try {
      await load();
      render();
      if (!pollTimer) pollTimer = setInterval(pollLive, 8000);
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
