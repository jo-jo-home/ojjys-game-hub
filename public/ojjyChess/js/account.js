// Account API calls
const Account = {
  token: localStorage.getItem('ojjychess_token') || null,
  user: null,
  isGuest: false,
  guestName: null,

  // Get the base URL for API calls (handles about:blank iframe context)
  _apiBase() {
    // If we're in an iframe, use the iframe's src origin
    try {
      if (window.location.protocol === 'about:') {
        // We're in about:blank, find the iframe src
        return '';
      }
      return '';
    } catch(e) {
      return '';
    }
  },

  async register(username, password) {
    const resp = await fetch('/api/ojjychess/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      let msg = 'Registration failed';
      try { const data = await resp.json(); msg = data.error || msg; } catch(e) {}
      throw new Error(msg);
    }
    const data = await resp.json();
    this.token = data.token;
    localStorage.setItem('ojjychess_token', this.token);
    this.user = data.user;
    return data;
  },

  async login(username, password) {
    const resp = await fetch('/api/ojjychess/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      let msg = 'Login failed';
      try { const data = await resp.json(); msg = data.error || msg; } catch(e) {}
      throw new Error(msg);
    }
    const data = await resp.json();
    this.token = data.token;
    localStorage.setItem('ojjychess_token', this.token);
    this.user = data.user;
    return data;
  },

  async loginAsGuest(name) {
    const resp = await fetch('/api/ojjychess/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) {
      let msg = 'Failed';
      try { const data = await resp.json(); msg = data.error || msg; } catch(e) {}
      throw new Error(msg);
    }
    const data = await resp.json();
    this.token = data.token;
    this.isGuest = true;
    this.guestName = data.guestName;
    localStorage.setItem('ojjychess_token', this.token);
    this.user = { username: data.guestName, isGuest: true };
    return data;
  },

  async getProfile() {
    if (!this.token) return null;
    try {
      const resp = await fetch('/api/ojjychess/me', {
        headers: { 'Authorization': 'Bearer ' + this.token },
      });
      if (!resp.ok) {
        this.logout();
        return null;
      }
      const data = await resp.json();
      this.user = data;
      this.isGuest = !!data.isGuest;
      this.guestName = data.isGuest ? data.username : null;
      return data;
    } catch(e) {
      console.warn('getProfile failed', e);
      return null;
    }
  },

  async updateStats(result) {
    if (!this.token) return;
    try {
      await fetch('/api/ojjychess/stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.token,
        },
        body: JSON.stringify({ result }),
      });
      await this.getProfile();
    } catch(e) {
      console.warn('updateStats failed', e);
    }
  },

  logout() {
    this.token = null;
    this.user = null;
    this.isGuest = false;
    this.guestName = null;
    localStorage.removeItem('ojjychess_token');
  },

  isLoggedIn() {
    return !!this.token;
  }
};
