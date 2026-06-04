// Account API calls
const Account = {
  token: localStorage.getItem('ojjychess_token') || null,
  user: null,

  async register(username, password) {
    const resp = await fetch('/api/ojjychess/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Registration failed');
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
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Login failed');
    this.token = data.token;
    localStorage.setItem('ojjychess_token', this.token);
    this.user = data.user;
    return data;
  },

  async getProfile() {
    if (!this.token) return null;
    const resp = await fetch('/api/ojjychess/me', {
      headers: { 'Authorization': 'Bearer ' + this.token },
    });
    if (!resp.ok) {
      this.logout();
      return null;
    }
    const data = await resp.json();
    this.user = data;
    return data;
  },

  async updateStats(result) {
    if (!this.token) return;
    await fetch('/api/ojjychess/stats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token,
      },
      body: JSON.stringify({ result }),
    });
    // Refresh profile
    await this.getProfile();
  },

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('ojjychess_token');
  },

  isLoggedIn() {
    return !!this.token;
  }
};
