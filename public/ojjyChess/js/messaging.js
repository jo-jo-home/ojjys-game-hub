// Messaging module
const Messaging = {
  conversations: [],
  currentChat: null, // username of open chat
  messages: [],

  init() {
    if (!Account.isLoggedIn() || Account.isGuest) return;
    this.loadConversations();
  },

  async loadConversations() {
    if (!Account.token || Account.isGuest) return;
    try {
      const resp = await fetch('/api/ojjychess/messages/conversations', {
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      this.conversations = data.conversations || [];
      if (!this.currentChat) this.renderInbox();
      this.renderBadge();
    } catch(e) { console.warn('loadConversations failed', e); }
  },

  togglePanel() {
    const panel = document.getElementById('chat-panel');
    if (panel.classList.contains('active')) {
      this.closePanel();
    } else {
      if (Account.isGuest) {
        alert('Register an account to send messages.');
        return;
      }
      panel.classList.add('active');
      this.currentChat = null;
      this.loadConversations();
      this.showInbox();
    }
  },

  closePanel() {
    document.getElementById('chat-panel').classList.remove('active');
    this.currentChat = null;
  },

  showInbox() {
    this.currentChat = null;
    document.getElementById('chat-header-title').innerHTML = 'Messages';
    document.getElementById('chat-conversations').style.display = 'block';
    document.getElementById('chat-messages').style.display = 'none';
    document.getElementById('chat-input-bar').style.display = 'none';
    this.renderInbox();
  },

  renderInbox() {
    const el = document.getElementById('chat-conversations');
    if (!el) return;

    if (this.conversations.length === 0) {
      el.innerHTML = '<div class="chat-empty">No conversations yet</div>';
      return;
    }

    el.innerHTML = this.conversations.map(c => {
      const letter = c.otherUser[0].toUpperCase();
      const time = this._formatTime(c.lastMessageAt);
      const unread = c.unreadCount > 0 ? `<span class="chat-conv-unread">${c.unreadCount}</span>` : '';
      return `<div class="chat-conv-row" onclick="Messaging.openChat('${c.otherUser}')">
        <div class="chat-conv-avatar">${letter}</div>
        <div class="chat-conv-info">
          <div class="chat-conv-name">${c.otherUser}</div>
          <div class="chat-conv-preview">${this._escapeHtml(c.lastMessage || '')}</div>
        </div>
        <div class="chat-conv-meta">
          <span class="chat-conv-time">${time}</span>
          ${unread}
        </div>
      </div>`;
    }).join('');
  },

  async openChat(username) {
    const panel = document.getElementById('chat-panel');
    if (!panel.classList.contains('active')) panel.classList.add('active');

    this.currentChat = username;

    // Update header
    document.getElementById('chat-header-title').innerHTML = `
      <button class="chat-header-back" onclick="Messaging.showInbox()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m0 0l7 7m-7-7l7-7"/></svg>
      </button>
      ${username}`;
    document.getElementById('chat-conversations').style.display = 'none';
    document.getElementById('chat-messages').style.display = 'flex';
    document.getElementById('chat-input-bar').style.display = 'flex';

    await this.loadMessages(username);
    this.markRead(username);

    // Focus input
    document.getElementById('chat-input').focus();
  },

  async loadMessages(username) {
    if (!Account.token) return;
    try {
      const resp = await fetch('/api/ojjychess/messages/' + encodeURIComponent(username) + '?limit=50', {
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      this.messages = data.messages || [];
      this.renderMessages();
    } catch(e) { console.warn('loadMessages failed', e); }
  },

  renderMessages() {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const myName = Account.user ? Account.user.username : '';

    if (this.messages.length === 0) {
      el.innerHTML = '<div class="chat-empty">No messages yet. Say hi!</div>';
      return;
    }

    el.innerHTML = this.messages.map(m => {
      const isSelf = m.from === myName;
      const time = this._formatTime(m.sentAt);
      return `<div class="chat-msg ${isSelf ? 'self' : 'other'}">
        ${this._escapeHtml(m.text)}
        <div class="chat-msg-time">${time}</div>
      </div>`;
    }).join('');

    el.scrollTop = el.scrollHeight;
  },

  async sendMessage(username, text) {
    if (!Account.token || Account.isGuest) return;
    try {
      const resp = await fetch('/api/ojjychess/messages/' + encodeURIComponent(username), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.message) {
        this.messages.push(data.message);
        this.renderMessages();
      }
    } catch(e) { console.warn('sendMessage failed', e); }
  },

  sendFromInput() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !this.currentChat) return;
    input.value = '';
    this.sendMessage(this.currentChat, text);
  },

  async markRead(username) {
    if (!Account.token) return;
    try {
      await fetch('/api/ojjychess/messages/' + encodeURIComponent(username) + '/read', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      // Update local unread count
      const conv = this.conversations.find(c => c.otherUser === username);
      if (conv) conv.unreadCount = 0;
      this.renderBadge();
    } catch(e) {}
  },

  renderBadge() {
    const badge = document.getElementById('messages-badge');
    if (!badge) return;
    const total = this.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    if (total > 0) {
      badge.textContent = total;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  },

  _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd';
    return d.toLocaleDateString();
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
