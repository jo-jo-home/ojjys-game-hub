(function () {
  "use strict";
  var root = document.getElementById('profile-root');
  if (!root) return;
  var page = document.body.dataset.scope;
  function esc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function token() { return window.__hubToken ? window.__hubToken() : document.body.dataset.token || ''; }
  function url(path) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token()); }
  function link(path, label) { return '<a class="pf-button" href="' + esc(url(path)) + '">' + esc(label) + '</a>'; }
  function duration(ms) { var m = Math.floor((ms || 0) / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + m % 60 + 'm' : m ? m + 'm' : Math.round((ms || 0) / 1000) + 's'; }
  function date(time) { return time ? new Date(time).toLocaleDateString() : 'not yet'; }
  async function request(path, body) {
    var res = await fetch(url(path), { method:body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store',
      headers:body ? {'Content-Type':'application/json'} : {}, body:body ? JSON.stringify(body) : undefined });
    var data;
    try { data = await res.json(); } catch (_) { throw new Error('could not load this page — check your connection'); }
    if (!res.ok) { var error = new Error(data.error || 'could not save changes'); error.status = res.status; throw error; }
    return data;
  }
  function failure(error) {
    root.innerHTML = '<section class="pf-card"><h2>' + (error.status === 404 ? 'profile not found' : 'could not load this page') + '</h2><p class="pf-muted">' + esc(error.message) + '</p>' +
      (error.status === 401 || error.status === 403 ? link('/login', 'sign in with an account') : '<button type="button" id="pf-retry">try again</button>') + '</section>';
    var retry = document.getElementById('pf-retry'); if (retry) retry.onclick = start;
    stagger();
  }
  // Entrance choreography: every card, tile, row and activity bar is
  // stamped with an index that profiles.css turns into a delay. Purely
  // decorative — a failure here must never take the page down.
  function stagger() {
    try {
      var groups = root.querySelectorAll('.pf-tiles,.pf-game-list,.pf-people,.pf-activity');
      groups.forEach(function (g) {
        for (var i = 0; i < g.children.length; i++) g.children[i].style.setProperty('--i', Math.min(i, 12));
      });
      var c = 0;
      for (var k = 0; k < root.children.length; k++) {
        if (root.children[k].classList.contains('pf-card')) root.children[k].style.setProperty('--i', Math.min(c++, 8));
      }
    } catch (e) { /* decorative only */ }
  }
  function identity(p) {
    return '<div class="pf-identity"><span class="pf-avatar" aria-hidden="true">' + esc(p.avatar) + '</span><div><h2>' + esc(p.label) + '</h2><div class="pf-meta">@' + esc(p.username) + (p.createdAt ? ' · joined ' + esc(date(p.createdAt)) : '') + '</div></div></div>';
  }
  function game(g, stats) {
    var id = g.id || g.game;
    return '<a class="pf-game" data-play="' + esc(id) + '" href="' + esc(url(g.path || '/' + id + '/')) + '">' +
      (g.iconUrl ? '<img src="' + esc(g.iconUrl) + '" alt="" loading="lazy">' : '<span class="pf-game-face" aria-hidden="true">🎮</span>') +
      '<span class="pf-game-info"><strong>' + esc(g.name) + '</strong>' + (stats ? '<small>' + g.opens + ' opens · last played ' + esc(date(g.last)) + '</small>' : '') + '</span>' +
      (stats ? '<span class="pf-game-time">' + esc(duration(g.ms)) + '</span>' : '') + '</a>';
  }
  function statsHtml(s) {
    var tiles = [[duration(s.totalMs), 'total playtime'], [s.tried, 'games tried'], [s.totalOpens, 'times opened'],
      [duration(s.averageMs), 'average time per game'], [s.top ? s.top.name : 'not yet', 'most played'],
      [duration(s.recentMs), 'last 14 days'], [s.activeDays, 'tracked active days'], [s.currentStreak + ' days', 'current streak'], [s.longestStreak + ' days', 'longest streak']];
    var h = '<section class="pf-card"><h2>player stats</h2><div class="pf-tiles">' + tiles.map(function (t) {
      return '<div class="pf-tile"><strong>' + esc(t[0]) + '</strong><span>' + esc(t[1]) + '</span></div>';
    }).join('') + '</div><p class="pf-meta">first played: ' + esc(date(s.since)) + ' · last played: ' + esc(date(s.lastPlayed)) + '</p><h3>activity · last 14 days</h3>';
    var max = Math.max.apply(null, s.activity.map(function (d) { return d.ms; }).concat([1]));
    h += '<div class="pf-activity">' + s.activity.map(function (d) {
      var text = d.day + ' (UTC): ' + duration(d.ms) + ', ' + d.opens + ' opens';
      return '<div class="pf-day" title="' + esc(text) + '" aria-label="' + esc(text) + '"><div class="pf-day-track"><i style="height:' + Math.round(d.ms / max * 100) + '%"></i></div><small>' + d.day.slice(8) + '</small></div>';
    }).join('') + '</div><p class="pf-muted">Daily activity and streaks use UTC. Tracking ' + (s.activitySince ? 'started ' + esc(s.activitySince) : 'starts with your next game') + '; older playtime is included in the total above.</p></section>';
    return h + '<section class="pf-card"><h2>playtime by game</h2>' + (s.games.length ? '<div class="pf-game-list">' + s.games.map(function (g) { return game(g, true); }).join('') + '</div>' : '<p class="pf-empty">no games played yet</p>') + '</section>';
  }
  async function showProfile() {
    var username = document.body.dataset.username;
    var data = await request('/api/profiles?' + (username ? 'username=' + encodeURIComponent(username) : 'self=1'));
    root.innerHTML = '<section class="pf-card">' + identity(data.profile) + '<p class="pf-bio">' + esc(data.profile.bio || 'no description yet') + '</p>' + (data.own ? link('/account', 'edit my profile') : '') + '</section>' +
      '<section class="pf-card"><h2>favorite games</h2>' + (data.favorites.length ? '<div class="pf-game-list">' + data.favorites.map(function (g) { return game(g, false); }).join('') + '</div>' : '<p class="pf-empty">no favorites chosen yet</p>') + '</section>' + statsHtml(data.stats);
    root.querySelectorAll('[data-play]').forEach(function (a) { a.addEventListener('click', function (e) {
      fetch(url('/api/played'), {method:'POST', headers:Object.assign({'Content-Type':'application/json'}, window.__hubDevice ? window.__hubDevice() : {}),
        body:JSON.stringify({id:a.dataset.play}), keepalive:true, credentials:'same-origin'}).catch(function () { /* gameplay remains available */ });
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
      if (window.__hubCloak) { e.preventDefault(); window.__hubCloak.openIframe(a.href, true); }
    }); });
    stagger();
  }
  function showPeople() {
    root.innerHTML = '<form class="pf-search" id="pf-search"><input type="search" name="q" aria-label="search people" placeholder="search usernames or display names" maxlength="80"><button>search</button></form><p id="pf-search-status" role="status"></p><div class="pf-people" id="pf-people"></div><button type="button" id="pf-more" hidden>load more people</button>';
    var form = document.getElementById('pf-search'), list = document.getElementById('pf-people'), status = document.getElementById('pf-search-status');
    var more = document.getElementById('pf-more'), cursor = null, generation = 0, timer;
    async function search(append) {
      var current = ++generation; more.disabled = true; status.textContent = 'loading people…';
      try {
        var data = await request('/api/profiles?q=' + encodeURIComponent(form.elements.q.value.trim()) + (append && cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        if (current !== generation) return;
        var html = data.people.map(function (p) {
          return '<a class="pf-person" href="' + esc(url('/profile?username=' + encodeURIComponent(p.username))) + '"><div class="pf-identity"><span class="pf-avatar" aria-hidden="true">' + esc(p.avatar) + '</span><div><strong>' + esc(p.label) + '</strong><div class="pf-meta">@' + esc(p.username) + '</div></div></div><p class="pf-bio">' + esc(p.bio.slice(0, 140) || 'view profile, favorites & stats') + '</p></a>';
        }).join('');
        if (append) list.insertAdjacentHTML('beforeend', html); else list.innerHTML = html;
        cursor = data.cursor; more.hidden = !cursor;
        status.textContent = list.children.length ? list.children.length + ' people shown' : cursor ? 'keep loading to search more accounts' : 'no people found';
        stagger();
      } catch (e) { if (current === generation) status.textContent = e.message; }
      finally { if (current === generation) more.disabled = false; }
    }
    form.onsubmit = function (e) { e.preventDefault(); clearTimeout(timer); search(false); };
    form.elements.q.oninput = function () { clearTimeout(timer); generation++; timer = setTimeout(function () { search(false); }, 250); };
    more.onclick = function () { search(true); };
    search(false);
  }
  async function showAccount() {
    var data = await request('/api/account'), p = data.profile;
    root.innerHTML = '<section class="pf-card">' + identity(p) + '<p class="pf-muted">Your display name, description, favorites and stats are visible to other signed-in hub members.</p>' + link('/profile', 'view my profile') + '</section>' +
      '<form class="pf-card" id="pf-edit"><h2>edit profile</h2><label>display name<input name="label" required maxlength="40" value="' + esc(p.label) + '"></label>' +
      '<label for="pf-avatar">avatar</label><select id="pf-avatar" name="avatar">' + data.avatars.map(function (avatar) { return '<option' + (avatar === p.avatar ? ' selected' : '') + '>' + esc(avatar) + '</option>'; }).join('') + '</select>' +
      '<label>profile description<textarea name="bio" rows="4" maxlength="1000" placeholder="tell people a little about yourself">' + esc(p.bio) + '</textarea></label><div class="pf-count" id="pf-count"></div>' +
      '<fieldset><legend>favorite games</legend><input type="search" id="pf-game-search" aria-label="filter favorite games" placeholder="find a game…"><div class="pf-favorites">' + data.catalog.map(function (g) {
        return '<label data-name="' + esc(g.name.toLowerCase()) + '"><input type="checkbox" name="favorite" value="' + esc(g.id) + '"' + (p.favorites.includes(g.id) ? ' checked' : '') + '>' + esc(g.name) + '</label>';
      }).join('') + '</div></fieldset><button type="submit">save profile</button> <button type="button" id="pf-import">import this browser’s old favorites</button><p class="pf-message" role="status" aria-live="polite"></p></form>' +
      '<div class="pf-grid">' + (data.owner ? '<section class="pf-card"><h2>owner sign-in</h2><p class="pf-muted">Your username is ojjy. The owner password is managed through ADMIN_PASSWORD in your deployment settings.</p></section>' :
      '<form class="pf-card" id="pf-username"><h2>change username</h2><label>new username<input name="username" value="' + esc(p.username) + '" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,31}" autocapitalize="none" spellcheck="false" autocomplete="username"></label><label>current password<input type="password" name="currentPassword" required maxlength="128" autocomplete="current-password"></label><p class="pf-muted">Your playtime and profile stay with you. You’ll sign in again with the new username.</p><button>change username</button><p class="pf-message" role="status" aria-live="polite"></p></form>' +
      '<form class="pf-card" id="pf-password"><h2>change password</h2><label>current password<input type="password" name="currentPassword" required maxlength="128" autocomplete="current-password"></label><label>new password<input type="password" name="password" required maxlength="128" autocomplete="new-password"></label><label>confirm new password<input type="password" name="confirmation" required maxlength="128" autocomplete="new-password"></label><p class="pf-muted">Changing your password signs out every device, including this one.</p><button>change password</button><p class="pf-message" role="status" aria-live="polite"></p></form>') + '</div>' +
      '<section class="pf-card"><h2>signed-in devices</h2><p class="pf-muted">End your other login sessions while keeping this device signed in.</p><button type="button" id="pf-devices">sign out other devices</button><p class="pf-message" role="status" aria-live="polite"></p></section>';
    var edit = document.getElementById('pf-edit');
    function count() { document.getElementById('pf-count').textContent = edit.elements.bio.value.length + ' / 1,000 characters'; }
    edit.elements.bio.oninput = count; count();
    stagger();
    document.getElementById('pf-game-search').oninput = function (e) {
      var q = e.target.value.toLowerCase().trim(); edit.querySelectorAll('[data-name]').forEach(function (label) { label.hidden = label.dataset.name.indexOf(q) < 0; });
    };
    document.getElementById('pf-import').onclick = function () {
      try { var old = JSON.parse(localStorage.getItem('favorites') || '[]'); if (!Array.isArray(old)) return;
        edit.querySelectorAll('[name="favorite"]').forEach(function (box) { if (old.includes(box.value)) box.checked = true; });
        edit.querySelector('.pf-message').textContent = 'old browser favorites selected — save profile to keep them';
      } catch (_) { edit.querySelector('.pf-message').textContent = 'no old browser favorites found'; }
    };
    async function save(container, body) {
      var message = container.querySelector('.pf-message'), button = container.querySelector('button');
      button.disabled = true; message.classList.remove('error'); message.textContent = 'saving…';
      try {
        var result = await request('/api/account', body);
        if (result.reauthenticate) { message.textContent = 'saved — sign in again'; if (window.__hubSession) window.__hubSession.forget(); location.href = '/login?reauth=1'; return; }
        if (result.profile) {
          p = result.profile;
          try { localStorage.setItem('hub_favorites:' + p.username.toLowerCase(), JSON.stringify(p.favorites)); } catch (_) { /* optional browser cache */ }
        }
        message.textContent = body.action === 'sign-out-others' ? 'other devices signed out' : 'profile saved';
      } catch (e) { message.classList.add('error'); message.textContent = e.message; }
      finally { button.disabled = false; }
    }
    edit.onsubmit = function (e) { e.preventDefault(); save(edit, { action:'profile', label:edit.elements.label.value, bio:edit.elements.bio.value, avatar:edit.elements.avatar.value,
      favorites:Array.from(edit.querySelectorAll('[name="favorite"]:checked')).map(function (box) { return box.value; }) }); };
    ['username', 'password'].forEach(function (action) {
      var form = document.getElementById('pf-' + action); if (!form) return;
      form.onsubmit = function (e) { e.preventDefault();
        if (action === 'password' && form.elements.password.value !== form.elements.confirmation.value) {
          var message = form.querySelector('.pf-message'); message.classList.add('error'); message.textContent = 'new passwords do not match'; return;
        }
        var body = {action:action, currentPassword:form.elements.currentPassword.value}; body[action] = form.elements[action].value; save(form, body);
      };
    });
    document.getElementById('pf-devices').onclick = function (e) { save(e.target.closest('section'), {action:'sign-out-others'}); };
  }
  async function start() {
    try { if (page === 'people') showPeople(); else if (page === 'account') await showAccount(); else await showProfile(); }
    catch (e) { failure(e); }
  }
  start();
})();
