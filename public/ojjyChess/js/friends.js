// Friends system module
const Friends = {
  friends: [],
  requests: [],
  searchTimeout: null,

  init() {
    if (!Account.isLoggedIn() || Account.isGuest) return;
    this.loadFriends();
    this.loadRequests();
  },

  async loadFriends() {
    if (!Account.token || Account.isGuest) return;
    try {
      const resp = await fetch('/api/ojjychess/friends', {
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      this.friends = data.friends || [];
      this.render();
    } catch(e) { console.warn('loadFriends failed', e); }
  },

  async loadRequests() {
    if (!Account.token || Account.isGuest) return;
    try {
      const resp = await fetch('/api/ojjychess/friends/requests', {
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      this.requests = data.requests || [];
      this.render();
      this.renderBadge();
    } catch(e) { console.warn('loadRequests failed', e); }
  },

  async sendRequest(username) {
    if (!Account.token || Account.isGuest) return;
    try {
      const resp = await fetch('/api/ojjychess/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
        body: JSON.stringify({ username }),
      });
      const data = await resp.json();
      if (!resp.ok) { alert(data.error || 'Failed'); return; }
      if (data.autoAccepted) {
        await this.loadFriends();
      }
      // Clear search results
      const resultsEl = document.getElementById('friend-search-results');
      if (resultsEl) resultsEl.innerHTML = '';
      const input = document.getElementById('friend-search-input');
      if (input) input.value = '';
    } catch(e) { console.warn('sendRequest failed', e); }
  },

  async acceptRequest(username) {
    if (!Account.token || Account.isGuest) return;
    try {
      await fetch('/api/ojjychess/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
        body: JSON.stringify({ username }),
      });
      await this.loadRequests();
      await this.loadFriends();
    } catch(e) { console.warn('acceptRequest failed', e); }
  },

  async declineRequest(username) {
    if (!Account.token || Account.isGuest) return;
    try {
      await fetch('/api/ojjychess/friends/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
        body: JSON.stringify({ username }),
      });
      await this.loadRequests();
    } catch(e) { console.warn('declineRequest failed', e); }
  },

  async removeFriend(username) {
    if (!Account.token || Account.isGuest) return;
    try {
      await fetch('/api/ojjychess/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
        body: JSON.stringify({ username }),
      });
      await this.loadFriends();
    } catch(e) { console.warn('removeFriend failed', e); }
  },

  searchUsers(query) {
    clearTimeout(this.searchTimeout);
    const resultsEl = document.getElementById('friend-search-results');
    if (!resultsEl) return;
    if (!query || query.length < 2) { resultsEl.innerHTML = ''; return; }
    this.searchTimeout = setTimeout(async () => {
      try {
        const resp = await fetch('/api/ojjychess/users/search?q=' + encodeURIComponent(query), {
          headers: { 'Authorization': 'Bearer ' + Account.token },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const friendNames = this.friends.map(f => f.username.toLowerCase());
        resultsEl.innerHTML = (data.users || []).map(u => {
          const isFriend = friendNames.includes(u.username.toLowerCase());
          return `<div class="search-result-row">
            <div class="search-result-avatar">${u.username[0].toUpperCase()}</div>
            <span class="search-result-name">${u.username}</span>
            ${isFriend
              ? '<span class="search-result-status">Friends</span>'
              : `<button class="search-result-btn" onclick="Friends.sendRequest('${u.username}')">Add Friend</button>`
            }
          </div>`;
        }).join('') || '<div class="search-empty">No users found</div>';
      } catch(e) { console.warn('searchUsers failed', e); }
    }, 300);
  },

  render() {
    const page = document.getElementById('friends-page');
    if (!page) return;

    // Requests section
    const reqContainer = document.getElementById('friend-requests-list');
    if (reqContainer) {
      if (this.requests.length === 0) {
        reqContainer.innerHTML = '<div class="friends-empty">No pending requests</div>';
      } else {
        reqContainer.innerHTML = this.requests.map(r => `<div class="friend-request-row">
          <div class="friend-avatar">${r.from[0].toUpperCase()}</div>
          <span class="friend-name">${r.from}</span>
          <div class="friend-request-actions">
            <button class="friend-accept-btn" onclick="Friends.acceptRequest('${r.from}')">Accept</button>
            <button class="friend-decline-btn" onclick="Friends.declineRequest('${r.from}')">Decline</button>
          </div>
        </div>`).join('');
      }
    }

    // Requests count in header
    const reqCount = document.getElementById('friend-requests-count');
    if (reqCount) reqCount.textContent = this.requests.length > 0 ? ` (${this.requests.length})` : '';

    // Friends list
    const listContainer = document.getElementById('friends-list');
    if (listContainer) {
      if (this.friends.length === 0) {
        listContainer.innerHTML = '<div class="friends-empty">No friends yet. Search for users above to add friends.</div>';
      } else {
        listContainer.innerHTML = this.friends.map(f => `<div class="friend-row">
          <div class="friend-avatar">${f.username[0].toUpperCase()}</div>
          <div class="friend-row-info">
            <span class="friend-name">${f.username}</span>
            <span class="friend-status ${f.online ? 'online' : ''}">${f.online ? 'Online' : 'Offline'}</span>
          </div>
          <div class="friend-row-actions">
            <button class="friend-msg-btn" onclick="Messaging.openChat('${f.username}')" title="Message">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </button>
            <button class="friend-remove-btn" onclick="Friends.removeFriend('${f.username}')" title="Remove">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>`).join('');
      }
    }
  },

  renderBadge() {
    const badge = document.getElementById('friends-badge');
    if (!badge) return;
    if (this.requests.length > 0) {
      badge.textContent = this.requests.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
};
