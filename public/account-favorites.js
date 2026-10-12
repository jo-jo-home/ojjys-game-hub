// The hub's existing stars remain immediate/offline-friendly. Account changes
// are queued by username, then merged as per-game operations on reconnect.
(function () {
  'use strict';
  var account = document.body.dataset.account;
  if (!account || !window._0x) return;
  var key = 'hub_favorites:' + account, pendingKey = key + ':pending', pending = {}, busy = false;
  try { var saved = JSON.parse(localStorage.getItem(pendingKey) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) pending = saved; } catch (_) { /* empty queue */ }
  var status = document.createElement('p'); status.className = 'pf-message'; status.setAttribute('role', 'status');
  status.style.cssText = 'color:var(--dim);font-size:.8rem;margin:.5rem 0';
  var search = document.getElementById('s'); if (search) search.after(status);
  function remember() { try { localStorage.setItem(pendingKey, JSON.stringify(pending)); } catch (_) { /* memory queue still works */ } }
  function apply(favorites) {
    var values = new Set(favorites);
    Object.keys(pending).forEach(function (id) { if (pending[id]) values.add(id); else values.delete(id); });
    window._0x[0] = Array.from(values);
    try { localStorage.setItem(key, JSON.stringify(window._0x[0])); } catch (_) { /* storage optional */ }
    window._r(); window._s(); if (window.__hubUI) window.__hubUI.filter();
  }
  async function api(body) {
    var token = window.__hubToken ? window.__hubToken() : document.body.dataset.token;
    var res = await fetch('/api/account?token=' + encodeURIComponent(token || ''), { method:body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store',
      headers:body ? {'Content-Type':'application/json'} : {}, body:body ? JSON.stringify(body) : undefined });
    var data = await res.json(); if (!res.ok) throw new Error(data.error || 'could not sync favorites'); return data;
  }
  async function sync() {
    if (busy) return; busy = true;
    try {
      var data = await api();
      if (data.profile.username.toLowerCase() !== account) throw new Error('sign in again to sync favorites');
      apply(data.profile.favorites);
      while (Object.keys(pending).length) {
        var id = Object.keys(pending)[0], value = pending[id];
        data = await api({ action:'favorite', game:id, favorite:value });
        if (pending[id] === value) delete pending[id];
        remember(); apply(data.profile.favorites);
      }
      status.textContent = '';
    } catch (_) { status.textContent = Object.keys(pending).length ? 'Favorites saved on this browser. Reconnect to sync your profile.' : 'Account favorites are offline — showing this browser’s saved copy.'; }
    finally { busy = false; }
  }
  document.addEventListener('hub-favorite-change', function (event) { pending[event.detail.game] = event.detail.favorite; remember(); sync(); });
  window.addEventListener('online', sync);
  window.addEventListener('storage', function (event) { if (event.key === key) { try { apply(JSON.parse(event.newValue || '[]')); } catch (_) { /* malformed cache */ } } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
  sync();
})();
