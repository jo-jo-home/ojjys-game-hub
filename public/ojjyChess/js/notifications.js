// Notifications polling module
const Notifications = {
  pollInterval: null,
  settings: { friendRequests: true, messages: true, sounds: true },

  init() {
    if (!Account.isLoggedIn() || Account.isGuest) return;
    this.startPolling();
    this.loadSettings();
  },

  startPolling() {
    this.stopPolling();
    this.poll(); // immediate first poll
    this.pollInterval = setInterval(() => this.poll(), 5000);
  },

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  },

  async poll() {
    if (!Account.token || Account.isGuest) return;
    try {
      const resp = await fetch('/api/ojjychess/poll', {
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (!resp.ok) return;
      const data = await resp.json();

      // Update friends badge
      const friendsBadge = document.getElementById('friends-badge');
      if (friendsBadge) {
        if (data.pendingFriendRequests > 0) {
          friendsBadge.textContent = data.pendingFriendRequests;
          friendsBadge.style.display = 'flex';
        } else {
          friendsBadge.style.display = 'none';
        }
      }

      // Update messages badge
      const msgBadge = document.getElementById('messages-badge');
      if (msgBadge) {
        if (data.unreadMessages > 0) {
          msgBadge.textContent = data.unreadMessages;
          msgBadge.style.display = 'flex';
        } else {
          msgBadge.style.display = 'none';
        }
      }

      // Refresh messaging conversations if chat panel is open
      if (typeof Messaging !== 'undefined' && document.getElementById('chat-panel').classList.contains('active')) {
        Messaging.loadConversations();
        if (Messaging.currentChat) {
          Messaging.loadMessages(Messaging.currentChat);
        }
      }
    } catch(e) {}
  },

  loadSettings() {
    try {
      const saved = localStorage.getItem('ojjychess_notification_settings');
      if (saved) this.settings = JSON.parse(saved);
    } catch(e) {}
  },

  saveSettings() {
    localStorage.setItem('ojjychess_notification_settings', JSON.stringify(this.settings));
  },

  stop() {
    this.stopPolling();
  }
};
