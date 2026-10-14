// Remember a validated session, never a password. The server still decides
// whether it is valid on every return, so sign-out and account revocation win.
(function () {
  'use strict';
  if (window.__hubSession) return;
  var KEY = 'hub_login', VALID = /^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{10,}\.[a-f0-9]{64})$/;
  var login = location.pathname === '/login', query = new URLSearchParams(location.search);
  var skipRestore = login && ['signedout', 'reauth', 'switch', 'wrong', 'error', 'limited', 'blocked', 'toomany'].some(function (key) { return query.has(key); });
  var busy = null, current = pageToken(), interacting = false;
  // The pages the hub itself owns. Two jobs: they are the only pages whose
  // links carry ?token=, and — because this script also runs inside every
  // game frame — they are the only pages a failed check may navigate away
  // from. A game frame that loses its session keeps running; being thrown
  // to the sign-in screen mid-level is far worse, and the hub is where a
  // dead session actually has to be dealt with.
  var HUB_PAGES = ['/', '/index.html', '/hub', '/apps', '/me', '/admin', '/feedback', '/profile', '/people', '/account'];
  function hubPage() {
    try { return HUB_PAGES.indexOf(location.pathname) >= 0; } catch (_) { return false; }
  }
  function pageToken() {
    var explicit = new URLSearchParams(location.search).get('token') || '';
    if (VALID.test(explicit)) return explicit;
    var declared = document.body && document.body.dataset.token || '';
    return VALID.test(declared) ? declared : '';
  }
  function saved() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (value && VALID.test(value.token) && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now()) return value;
      localStorage.removeItem(KEY);
    } catch (_) { /* cookies and URL tokens still work without storage */ }
    return null;
  }
  function forget(expected) {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!expected || !value || value.token === expected) localStorage.removeItem(KEY);
    } catch (_) { /* storage unavailable */ }
  }
  function token() { return current || pageToken(); }
  function deviceHeader() {
    try { var id = localStorage.getItem('hub_device'); if (/^[A-Za-z0-9-]{8,64}$/.test(id || '')) return {'X-Device':id}; } catch (_) { /* optional */ }
    return {};
  }
  function adopt(value, expiresAt) {
    current = value;
    if (document.body) document.body.dataset.token = value;
    // Only the hub's own pages get the rest: inside a game frame, `_t` can be
    // the game's variable, not ours, and its links are never hub links.
    if (hubPage()) {
      if (typeof window._t === 'string') window._t = value;
      document.querySelectorAll('a[href]').forEach(function (link) {
        var target = new URL(link.href, location.href);
        if (target.origin === location.origin && HUB_PAGES.includes(target.pathname)) { target.searchParams.set('token', value); link.href = target.href; }
      });
    }
    try { localStorage.setItem(KEY, JSON.stringify({token:value, expiresAt:expiresAt})); } catch (_) { /* cookie fallback */ }
  }
  async function check(value) {
    var res = await fetch('/api/session' + (value ? '?token=' + value : ''), {
      credentials:'same-origin', cache:'no-store', headers:deviceHeader(),
    });
    if (!res.ok) throw new Error('session check unavailable');
    return res.json();
  }
  function continueWith(value, returning) {
    if (login && interacting) return;
    var target = new URL(returning ? '/' : location.href, location.origin);
    target.searchParams.set('token', value);
    location.replace(target.href);
  }
  // The page's own token first, then the saved backup. `fallback` records that
  // the page's token was the dead one, so the caller can move the page onto
  // the token that still works.
  async function probe(selected, backup) {
    var data = await check(selected);
    var fallback = false;
    if (!data.ok && backup && backup.token !== selected) { data = await check(backup.token); fallback = true; }
    data.fallback = fallback;
    return data;
  }
  async function run() {
    if (!navigator.onLine || (login && skipRestore)) return;
    var backup = saved();
    var selected = login ? backup && backup.token || '' : token();
    try {
      var data = await probe(selected, backup);
      // One refusal is not a sign-out. This check runs on a timer and every
      // time a tab is focused, so a single bad answer — a cold isolate, a
      // blip on the way to the database — used to end the session on the
      // spot and take a game in mid-play with it. Ask again before
      // believing it, and only then throw the saved tokens away.
      if (!data.ok) {
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
        data = await probe(selected, backup);
      }
      if (data.ok && VALID.test(data.token || '')) {
        adopt(data.token, data.expiresAt);
        if (login || data.fallback) continueWith(data.token, login);
      } else {
        forget(selected);
        if (backup) forget(backup.token);
        // Hub pages only. Game frames never navigate to the sign-in screen:
        // the game keeps running, and the session is dealt with wherever
        // the person actually signs in from.
        if (!login && hubPage()) location.replace('/login?reauth=1');
      }
    } catch (_) { /* network failure is not a sign-out; keep the saved session */ }
  }
  function verify() {
    if (busy) return busy;
    busy = run().finally(function () { busy = null; });
    return busy;
  }
  window.__hubToken = token;
  window.__hubDevice = deviceHeader;
  window.__hubSessionUrl = function () { var value = token(); return '/api/session' + (value ? '?token=' + value : ''); };
  window.__hubSession = {verify:verify, forget:forget, token:token};
  window.__hubLogout = async function (button) {
    if (button) { button.disabled = true; button.textContent = 'signing out…'; }
    try {
      var value = token();
      var res = await fetch('/api/logout' + (value ? '?token=' + value : ''), {
        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:'{}',
      });
      if (!res.ok) throw new Error('sign out failed');
      forget(); current = ''; location.href = '/login?signedout=1';
    } catch (_) {
      if (button) { button.disabled = false; button.textContent = 'retry sign out'; }
      var error = document.getElementById('logout-error');
      if (!error) { error = document.createElement('p'); error.id = 'logout-error'; error.setAttribute('role','alert'); (document.querySelector('header') || document.body).appendChild(error); }
      error.textContent = 'could not reach the server to sign out — reconnect and try again';
    }
  };
  if (login) {
    if (skipRestore) forget();
    // Do not interrupt a person who starts entering another account's login.
    document.addEventListener('input', function () { interacting = true; }, {once:true});
    document.addEventListener('submit', function () { interacting = true; }, {once:true});
  }
  window.addEventListener('online', verify);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) verify(); });
  setInterval(function () { if (!document.hidden) verify(); }, 300000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', verify); else verify();
})();
