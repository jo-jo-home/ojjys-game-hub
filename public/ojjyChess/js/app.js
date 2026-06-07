// Sound system (chess.com sounds)
const Sound = {
  muted: localStorage.getItem('ojjychess-muted') === 'true',
  _cache: {},
  _base: 'https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/',
  _names: ['game-start','game-end','capture','castle','move-self','move-opponent','move-check','promote','illegal','notify','tenseconds'],
  play(name) {
    if (this.muted) return;
    if (!this._cache[name]) this._cache[name] = new Audio(this._base + name + '.mp3');
    const a = this._cache[name];
    a.currentTime = 0;
    a.play().catch(() => {});
  },
  toggle() {
    this.muted = !this.muted;
    localStorage.setItem('ojjychess-muted', this.muted);
    this.updateIcon();
  },
  updateIcon() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    if (this.muted) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>';
    }
  }
};

// Chess clock
const Clock = {
  wTime: 0,       // ms remaining for white
  bTime: 0,       // ms remaining for black
  increment: 0,   // ms increment per move
  activeSide: null,
  _interval: null,
  _lastTick: 0,
  enabled: false,
  onFlag: null,    // callback(color) when time runs out

  start(timeMinutes, incrementSeconds) {
    this.stop();
    if (!timeMinutes) { this.enabled = false; this._hideClocks(); return; }
    this.enabled = true;
    this.wTime = timeMinutes * 60 * 1000;
    this.bTime = timeMinutes * 60 * 1000;
    this.increment = incrementSeconds * 1000;
    this.activeSide = null;
    this._lowTimePlayed = false;
    this._updateDisplay();
    this._showClocks();
  },

  switchTo(color) {
    // Apply increment to the side that just moved (opposite of color)
    if (this.activeSide && this.activeSide !== color) {
      if (this.activeSide === 'w') this.wTime += this.increment;
      else this.bTime += this.increment;
    }
    this.activeSide = color;
    this._lastTick = performance.now();
    this._updateDisplay();
    if (!this._interval) {
      this._interval = setInterval(() => this._tick(), 100);
    }
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this.activeSide = null;
  },

  _lowTimePlayed: false,

  _tick() {
    if (!this.activeSide) return;
    const now = performance.now();
    const elapsed = now - this._lastTick;
    this._lastTick = now;

    if (this.activeSide === 'w') {
      this.wTime = Math.max(0, this.wTime - elapsed);
      if (this.wTime <= 0) { this.stop(); if (this.onFlag) this.onFlag('w'); return; }
    } else {
      this.bTime = Math.max(0, this.bTime - elapsed);
      if (this.bTime <= 0) { this.stop(); if (this.onFlag) this.onFlag('b'); return; }
    }

    // Play low time warning sound once when player drops below 10s
    const playerColor = Board.playerColor;
    const playerTime = playerColor === 'w' ? this.wTime : this.bTime;
    if (playerTime <= 10000 && playerTime > 0 && !this._lowTimePlayed) {
      this._lowTimePlayed = true;
      Sound.play('tenseconds');
    }

    this._updateDisplay();
  },

  _formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return h + ':' + String(rm).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  },

  _updateDisplay() {
    const topEl = document.getElementById('game-top-clock');
    const botEl = document.getElementById('game-bottom-clock');
    if (!topEl || !botEl) return;

    const topColor = Board.flipped ? 'w' : 'b';
    const botColor = Board.flipped ? 'b' : 'w';

    topEl.textContent = this._formatTime(topColor === 'w' ? this.wTime : this.bTime);
    botEl.textContent = this._formatTime(botColor === 'w' ? this.wTime : this.bTime);

    // Active state
    topEl.classList.toggle('active-clock', this.activeSide === topColor);
    botEl.classList.toggle('active-clock', this.activeSide === botColor);

    // Low time warning (under 30 seconds)
    const topTime = topColor === 'w' ? this.wTime : this.bTime;
    const botTime = botColor === 'w' ? this.wTime : this.bTime;
    topEl.classList.toggle('low-time', topTime <= 30000 && topTime > 0);
    botEl.classList.toggle('low-time', botTime <= 30000 && botTime > 0);

    // Flagged
    topEl.classList.toggle('flagged', topTime <= 0);
    botEl.classList.toggle('flagged', botTime <= 0);
  },

  _showClocks() {
    const topEl = document.getElementById('game-top-clock');
    const botEl = document.getElementById('game-bottom-clock');
    if (topEl) topEl.classList.add('visible');
    if (botEl) botEl.classList.add('visible');
  },

  _hideClocks() {
    const topEl = document.getElementById('game-top-clock');
    const botEl = document.getElementById('game-bottom-clock');
    if (topEl) { topEl.classList.remove('visible', 'active-clock', 'low-time', 'flagged'); topEl.textContent = ''; }
    if (botEl) { botEl.classList.remove('visible', 'active-clock', 'low-time', 'flagged'); botEl.textContent = ''; }
  }
};

// Bot profiles (chess.com style)
const BOT_PROFILES = {
  easy: { name: 'Marvin', rating: 250, desc: 'I just learned the rules!', color: '#7ab648' },
  medium: { name: 'Elena', rating: 1200, desc: "Let's play a solid game.", color: '#e6912e' },
  hard: { name: 'Magnus', rating: 2500, desc: 'Prepare yourself.', color: '#e04040' },
  custom: { name: 'Custom', rating: 800, desc: 'Set your own challenge.', color: '#5b8bb4' },
};

// Custom bot with adjustable depth (runs in setTimeout to avoid blocking UI)
const CustomBot = {
  maxDepth: 2,
  getMove(chess) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const moves = chess.moves({ verbose: true });
        if (moves.length === 0) { resolve(null); return; }
        const isMaximizing = chess.turn() === 'w';
        let bestMove = null;
        let bestScore = isMaximizing ? -Infinity : Infinity;
        moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
        for (const move of moves) {
          chess.move(move);
          const score = CustomBot._minimax(chess, CustomBot.maxDepth - 1, -Infinity, Infinity, !isMaximizing);
          chess.undo();
          if (isMaximizing) { if (score > bestScore) { bestScore = score; bestMove = move; } }
          else { if (score < bestScore) { bestScore = score; bestMove = move; } }
        }
        resolve(bestMove);
      }, 50);
    });
  },
  _minimax(chess, depth, alpha, beta, isMaximizing) {
    if (depth === 0 || chess.game_over()) return evaluate(chess);
    const moves = chess.moves({ verbose: true });
    moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of moves) { chess.move(move); const e = CustomBot._minimax(chess, depth - 1, alpha, beta, false); chess.undo(); maxEval = Math.max(maxEval, e); alpha = Math.max(alpha, e); if (beta <= alpha) break; }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of moves) { chess.move(move); const e = CustomBot._minimax(chess, depth - 1, alpha, beta, true); chess.undo(); minEval = Math.min(minEval, e); beta = Math.min(beta, e); if (beta <= alpha) break; }
      return minEval;
    }
  }
};

// Main app controller
const App = {
  bot: null,
  botColor: 'b',
  difficulty: 'medium',
  playerColor: 'w',
  gameActive: false,
  moveHistory: [],
  customRating: 800,
  timeControl: 'none',
  optionsOpen: true,
  activeBoardId: 'board',
  hintTimeout: null,

  async init() {
    try { Settings.load(); } catch(e) { console.warn('Settings load failed', e); }
    Sound.updateIcon();

    Board.init('board');
    Board.onMoveAttempt = (from, to, promotion) => this.handlePlayerMove(from, to, promotion);

    ChessGame.newGame();
    Board.render(ChessGame.board());

    this.updateBotPreview();

    this.loadStreak();

    if (Account.isLoggedIn()) {
      try {
        const profile = await Account.getProfile();
        if (profile) {
          this.updateUserBar();
          this.hideAuth();
          this._initSocial();
          this.loadStreak();
          return;
        }
      } catch(e) {
        console.warn('Profile fetch failed', e);
      }
    }
    this.showAuth();
  },

  // --- Mode switching ---
  enterHomeMode() {
    document.body.className = 'home-mode';
    document.getElementById('left-nav').style.display = 'flex';
    document.getElementById('home-page').style.display = 'flex';
    document.getElementById('friends-page').style.display = 'none';
    document.getElementById('game-layout').style.display = 'none';
    document.getElementById('stats-page').style.display = 'none';
    document.getElementById('history-page').style.display = 'none';
    document.getElementById('online-search-overlay').style.display = 'none';
    document.getElementById('online-gameover-overlay').style.display = 'none';
    document.getElementById('draw-offer-banner').style.display = 'none';
    document.getElementById('disconnect-banner').style.display = 'none';
    this.showPlayMenu();

    // Update nav active state
    document.querySelectorAll('.left-nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector('.left-nav-items .left-nav-item').classList.add('active');

    Board.init('board');
    Board.onMoveAttempt = (from, to, promotion) => this.handlePlayerMove(from, to, promotion);
    this.activeBoardId = 'board';

    ChessGame.newGame();
    if (Board.flipped) Board.flip();
    Board.render(ChessGame.board());
    Board.clearSelection();
    Board.setCheck(null);
  },

  enterFriendsMode() {
    document.body.className = 'home-mode';
    document.getElementById('left-nav').style.display = 'flex';
    document.getElementById('home-page').style.display = 'none';
    document.getElementById('friends-page').style.display = 'flex';
    document.getElementById('game-layout').style.display = 'none';
    document.getElementById('stats-page').style.display = 'none';
    document.getElementById('history-page').style.display = 'none';

    // Update nav active state
    document.querySelectorAll('.left-nav-item').forEach(el => el.classList.remove('active'));
    // Find the Friends nav item by its text content
    document.querySelectorAll('.left-nav-item span').forEach(sp => {
      if (sp.textContent === 'Friends') sp.parentElement.classList.add('active');
    });

    if (Account.isGuest) {
      document.getElementById('friends-guest-prompt').style.display = 'block';
      document.querySelector('.friend-search').style.display = 'none';
      document.querySelectorAll('.friends-section').forEach(el => el.style.display = 'none');
    } else {
      document.getElementById('friends-guest-prompt').style.display = 'none';
      document.querySelector('.friend-search').style.display = 'block';
      document.querySelectorAll('.friends-section').forEach(el => el.style.display = 'block');
      Friends.loadFriends();
      Friends.loadRequests();
    }
  },

  enterGameMode() {
    document.body.className = 'game-mode';
    document.getElementById('left-nav').style.display = 'none';
    document.getElementById('home-page').style.display = 'none';
    document.getElementById('friends-page').style.display = 'none';
    document.getElementById('stats-page').style.display = 'none';
    document.getElementById('history-page').style.display = 'none';
    document.getElementById('game-layout').style.display = 'flex';

    Board.init('game-board');
    Board.onMoveAttempt = (from, to, promotion) => this.handlePlayerMove(from, to, promotion);
    this.activeBoardId = 'game-board';

    // Restore bot game controls
    const controls = document.querySelector('.game-icon-controls');
    if (controls) {
      controls.innerHTML = `
        <button class="icon-btn" onclick="App.resign()" title="Resign">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V4h10l2 3H22v9H12l-2-3H6v8"/></svg>
        </button>
        <button class="icon-btn" onclick="App.undoMove()" title="Undo">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h10a5 5 0 015 5v2M3 10l5-5M3 10l5 5"/></svg>
        </button>
        <button class="icon-btn" onclick="App.showHint()" title="Hint">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6m-5 3h4M12 2a7 7 0 00-3 13.33V17h6v-1.67A7 7 0 0012 2z"/></svg>
        </button>`;
    }

    // Update sidebar header for bots
    const sidebarHeader = document.querySelector('#game-sidebar .sidebar-header span');
    if (sidebarHeader) sidebarHeader.textContent = 'Play Bots';
  },

  _initSocial() {
    if (typeof Friends !== 'undefined') Friends.init();
    if (typeof Notifications !== 'undefined') Notifications.init();
  },

  // --- Play menu navigation ---
  showPlayMenu() {
    document.getElementById('play-menu').style.display = 'flex';
    document.getElementById('setup-panel').style.display = 'none';
    document.getElementById('online-setup-panel').style.display = 'none';
    document.getElementById('variants-panel').style.display = 'none';
  },

  showBotSetup() {
    document.getElementById('play-menu').style.display = 'none';
    document.getElementById('setup-panel').style.display = 'flex';
    this.updateBotPreview();
  },

  showPlayOnline() {
    document.getElementById('play-menu').style.display = 'none';
    document.getElementById('setup-panel').style.display = 'none';
    document.getElementById('online-setup-panel').style.display = 'flex';
    // Ensure WS connected
    OnlineGame.connect();
  },

  selectOnlineTC(btn) {
    document.querySelectorAll('.online-tc-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    OnlineGame.selectedTC = btn.dataset.tc;
  },

  startOnlineSearch() {
    OnlineGame.findGame(OnlineGame.selectedTC);
  },

  enterOnlineGameMode() {
    document.body.className = 'game-mode';
    document.getElementById('left-nav').style.display = 'none';
    document.getElementById('home-page').style.display = 'none';
    document.getElementById('friends-page').style.display = 'none';
    document.getElementById('stats-page').style.display = 'none';
    document.getElementById('history-page').style.display = 'none';
    document.getElementById('game-layout').style.display = 'flex';

    Board.init('game-board');
    this.activeBoardId = 'game-board';

    // Update sidebar controls for online game
    const controls = document.querySelector('.game-icon-controls');
    if (controls) {
      controls.innerHTML = `
        <button class="icon-btn" onclick="OnlineGame.resign()" title="Resign">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V4h10l2 3H22v9H12l-2-3H6v8"/></svg>
        </button>
        <button class="icon-btn" onclick="OnlineGame.offerDraw()" title="Offer Draw">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-14v4m0 4h.01"/></svg>
        </button>`;
    }
  },

  showPlayFriend() {
    // Placeholder - not implemented yet
  },

  showVariants() {
    document.getElementById('play-menu').style.display = 'none';
    document.getElementById('setup-panel').style.display = 'none';
    document.getElementById('online-setup-panel').style.display = 'none';
    document.getElementById('variants-panel').style.display = 'flex';
  },

  startVariant(variant) {
    // For now, Chess960 is the only playable variant
    if (variant === 'chess960') {
      this.pendingVariant = 'chess960';
      this.showBotSetup();
    } else {
      // Others: show a quick alert for now
      alert('This variant is coming soon!');
    }
  },

  // --- Stats page ---
  async enterStatsMode() {
    document.body.className = 'home-mode';
    document.getElementById('home-page').style.display = 'none';
    document.getElementById('game-layout').style.display = 'none';
    document.getElementById('friends-page').style.display = 'none';
    document.getElementById('left-nav').style.display = 'flex';
    document.getElementById('stats-page').style.display = 'flex';
    document.getElementById('history-page').style.display = 'none';

    // Load profile
    const profile = await Account.getProfile();
    if (profile) {
      document.getElementById('stats-avatar').textContent = profile.username[0].toUpperCase();
      document.getElementById('stats-username').textContent = profile.username;
      const joined = profile.createdAt ? new Date(profile.createdAt) : null;
      document.getElementById('stats-joined').textContent = joined
        ? 'Joined ' + joined.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : '';
      if (joined) {
        const days = Math.floor((Date.now() - joined.getTime()) / 86400000);
        document.getElementById('stats-member-since').textContent =
          days === 0 ? 'Member for less than a day' : `Member for ${days} day${days !== 1 ? 's' : ''}`;
      }
      const stats = profile.stats || { wins: 0, losses: 0, draws: 0 };
      document.getElementById('stat-wins').textContent = stats.wins;
      document.getElementById('stat-losses').textContent = stats.losses;
      document.getElementById('stat-draws').textContent = stats.draws;

      // Win rate bar
      const total = stats.wins + stats.losses + stats.draws;
      document.getElementById('perf-total').textContent = total;
      if (total > 0) {
        const wp = Math.round(stats.wins / total * 100);
        const dp = Math.round(stats.draws / total * 100);
        const lp = 100 - wp - dp;
        document.getElementById('winrate-win').style.width = wp + '%';
        document.getElementById('winrate-draw').style.width = dp + '%';
        document.getElementById('winrate-loss').style.width = lp + '%';
        document.getElementById('winrate-win-pct').textContent = wp + '% Win';
        document.getElementById('winrate-draw-pct').textContent = dp + '% Draw';
        document.getElementById('winrate-loss-pct').textContent = lp + '% Loss';
      } else {
        document.getElementById('winrate-win').style.width = '0%';
        document.getElementById('winrate-draw').style.width = '0%';
        document.getElementById('winrate-loss').style.width = '0%';
        document.getElementById('winrate-win-pct').textContent = '0% Win';
        document.getElementById('winrate-draw-pct').textContent = '0% Draw';
        document.getElementById('winrate-loss-pct').textContent = '0% Loss';
      }
    }

    // Load game history and compute detailed stats
    try {
      const token = localStorage.getItem('ojjychess_token');
      const resp = await fetch('/api/ojjychess/games', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const games = await resp.json();
        this._renderGameHistory(games);
        this._computeDetailedStats(games);
      }
    } catch {}
  },

  _computeDetailedStats(games) {
    const myName = (this.currentUser ? this.currentUser.username : '').toLowerCase();
    let bullet = 0, blitz = 0, rapid = 0, bots = 0;
    let bestStreak = 0, currentStreak = 0, tempStreak = 0;
    let totalMoves = 0, gamesWithMoves = 0;

    // Sort by time ascending for streak calculation
    const sorted = [...games].sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));

    for (const g of sorted) {
      // Count by time control
      const tc = g.timeControl || '';
      const mins = parseInt(tc.split('|')[0]) || 0;
      if (g.white === 'Bot' || g.black === 'Bot' || !g.white || !g.black) {
        bots++;
      } else if (mins <= 2) {
        bullet++;
      } else if (mins <= 5) {
        blitz++;
      } else {
        rapid++;
      }

      // Streaks
      const isWhite = (g.white || '').toLowerCase() === myName;
      const iWon = g.winner && ((g.winner === 'w' && isWhite) || (g.winner === 'b' && !isWhite));
      if (iWon) {
        tempStreak++;
        if (tempStreak > bestStreak) bestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
      currentStreak = tempStreak;

      // Average moves
      if (g.moves && g.moves.length > 0) {
        totalMoves += g.moves.length;
        gamesWithMoves++;
      }
    }

    document.getElementById('tc-bullet').textContent = bullet + ' game' + (bullet !== 1 ? 's' : '');
    document.getElementById('tc-blitz').textContent = blitz + ' game' + (blitz !== 1 ? 's' : '');
    document.getElementById('tc-rapid').textContent = rapid + ' game' + (rapid !== 1 ? 's' : '');
    document.getElementById('tc-bots').textContent = bots + ' game' + (bots !== 1 ? 's' : '');
    document.getElementById('perf-best-streak').textContent = bestStreak;
    document.getElementById('perf-current-streak').textContent = currentStreak;
    document.getElementById('perf-avg-moves').textContent =
      gamesWithMoves > 0 ? Math.round(totalMoves / gamesWithMoves) + ' moves' : '--';
  },

  _renderGameHistory(games) {
    const list = document.getElementById('game-history-list');
    if (!games || games.length === 0) {
      list.innerHTML = '<div class="history-empty">No games played yet</div>';
      return;
    }
    const myName = (this.currentUser ? this.currentUser.username : '').toLowerCase();
    list.innerHTML = games.map(g => {
      const isWhite = (g.white || '').toLowerCase() === myName;
      const opponent = isWhite ? g.black : g.white;
      let resultClass = 'draw';
      let resultText = 'Draw';
      if (g.winner) {
        const iWon = (g.winner === 'w' && isWhite) || (g.winner === 'b' && !isWhite);
        resultClass = iWon ? 'win' : 'loss';
        resultText = iWon ? 'Won' : 'Lost';
      }
      const date = g.endedAt ? new Date(g.endedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const tc = g.timeControl || '';
      const moves = g.moves ? Math.ceil(g.moves.length / 2) + ' moves' : '';
      return `<div class="history-row">
        <span class="history-result ${resultClass}">${resultText}</span>
        <span class="history-opponent">vs ${opponent || 'Unknown'}</span>
        <span class="history-moves">${moves}</span>
        <span class="history-tc">${tc.replace('|', '+')}</span>
        <span class="history-date">${date}</span>
      </div>`;
    }).join('');
  },

  showGameHistory() {
    this.enterHistoryMode();
  },

  // --- Game History page ---
  _historyGames: [],
  _historyFiltered: [],
  _historyPage: 1,
  _historyPerPage: 15,
  _historyTab: 'all',

  async enterHistoryMode() {
    document.body.className = 'home-mode';
    document.getElementById('home-page').style.display = 'none';
    document.getElementById('game-layout').style.display = 'none';
    document.getElementById('friends-page').style.display = 'none';
    document.getElementById('stats-page').style.display = 'none';
    document.getElementById('left-nav').style.display = 'flex';
    document.getElementById('history-page').style.display = 'flex';

    // Fetch games
    try {
      const token = localStorage.getItem('ojjychess_token');
      const resp = await fetch('/api/ojjychess/games', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        this._historyGames = await resp.json();
      } else {
        this._historyGames = [];
      }
    } catch { this._historyGames = []; }

    this._historyTab = 'all';
    this._historyPage = 1;
    document.querySelectorAll('.htab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
    this._applyHistoryFilters();
  },

  setHistoryTab(tab, btn) {
    this._historyTab = tab;
    this._historyPage = 1;
    document.querySelectorAll('.htab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    this._applyHistoryFilters();
  },

  filterHistory() {
    this._historyPage = 1;
    this._applyHistoryFilters();
  },

  resetHistoryFilters() {
    document.getElementById('history-result-filter').value = '';
    document.getElementById('history-opponent-filter').value = '';
    this._historyPage = 1;
    this._applyHistoryFilters();
  },

  _applyHistoryFilters() {
    const myName = (this.currentUser ? this.currentUser.username : '').toLowerCase();
    let games = [...this._historyGames];

    // Tab filter
    if (this._historyTab === 'live') {
      games = games.filter(g => g.white && g.black && g.white !== 'Bot' && g.black !== 'Bot');
    } else if (this._historyTab === 'bot') {
      games = games.filter(g => !g.white || !g.black || g.white === 'Bot' || g.black === 'Bot');
    }

    // Result filter
    const resultFilter = document.getElementById('history-result-filter').value;
    if (resultFilter) {
      games = games.filter(g => {
        const isWhite = (g.white || '').toLowerCase() === myName;
        if (!g.winner) return resultFilter === 'draw';
        const iWon = (g.winner === 'w' && isWhite) || (g.winner === 'b' && !isWhite);
        return (resultFilter === 'win' && iWon) || (resultFilter === 'loss' && !iWon);
      });
    }

    // Opponent filter
    const oppFilter = document.getElementById('history-opponent-filter').value.toLowerCase().trim();
    if (oppFilter) {
      games = games.filter(g => {
        const isWhite = (g.white || '').toLowerCase() === myName;
        const opp = isWhite ? (g.black || '') : (g.white || '');
        return opp.toLowerCase().includes(oppFilter);
      });
    }

    this._historyFiltered = games;
    document.getElementById('history-total').textContent = games.length;
    this._renderHistoryTable();
    this._renderHistoryPagination();
  },

  _renderHistoryTable() {
    const tbody = document.getElementById('history-tbody');
    const emptyMsg = document.getElementById('history-empty-msg');
    const games = this._historyFiltered;
    const start = (this._historyPage - 1) * this._historyPerPage;
    const page = games.slice(start, start + this._historyPerPage);

    if (games.length === 0) {
      tbody.innerHTML = '';
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';

    const myName = (this.currentUser ? this.currentUser.username : '').toLowerCase();

    tbody.innerHTML = page.map(g => {
      const tc = g.timeControl || '';
      const mins = parseInt(tc.split('|')[0]) || 0;
      const inc = parseInt(tc.split('|')[1]) || 0;
      const tcLabel = inc > 0 ? `${mins}|${inc}` : `${mins} min`;

      // TC icon
      let tcIcon;
      if (mins <= 2) {
        tcIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
      } else {
        tcIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
      }

      const white = g.white || 'Unknown';
      const black = g.black || 'Unknown';
      const isWhite = white.toLowerCase() === myName;

      // Result
      const wScore = g.winner === 'w' ? '1' : g.winner === 'b' ? '0' : '\u00BD';
      const bScore = g.winner === 'b' ? '1' : g.winner === 'w' ? '0' : '\u00BD';
      const wClass = g.winner === 'w' ? 'win' : g.winner === 'b' ? 'loss' : 'draw';
      const bClass = g.winner === 'b' ? 'win' : g.winner === 'w' ? 'loss' : 'draw';
      const wIcon = wClass === 'win' ? '<svg viewBox="0 0 12 12"><path d="M2 10l4-4 4 4" stroke-linecap="round"/></svg>'
        : wClass === 'loss' ? '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke-linecap="round"/></svg>'
        : '<svg viewBox="0 0 12 12"><path d="M2 6h8" stroke-linecap="round"/></svg>';
      const bIcon = bClass === 'win' ? '<svg viewBox="0 0 12 12"><path d="M2 10l4-4 4 4" stroke-linecap="round"/></svg>'
        : bClass === 'loss' ? '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke-linecap="round"/></svg>'
        : '<svg viewBox="0 0 12 12"><path d="M2 6h8" stroke-linecap="round"/></svg>';

      const moves = g.moves ? Math.ceil(g.moves.length / 2) : '--';
      const date = g.endedAt ? new Date(g.endedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

      return `<tr>
        <td>
          <div class="ht-cell-players">
            <div class="ht-tc">${tcIcon}<span class="ht-tc-label">${tcLabel}</span></div>
            <div class="ht-names">
              <div class="ht-player-row">
                <span class="ht-color-sq white"></span>
                <span class="ht-player-name ${isWhite ? 'me' : ''}">${white}</span>
              </div>
              <div class="ht-player-row">
                <span class="ht-color-sq black"></span>
                <span class="ht-player-name ${!isWhite ? 'me' : ''}">${black}</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          <div class="ht-cell-result">
            <div class="ht-result-row"><span>${wScore}</span><span class="ht-result-icon ${wClass}">${wIcon}</span></div>
            <div class="ht-result-row"><span>${bScore}</span><span class="ht-result-icon ${bClass}">${bIcon}</span></div>
          </div>
        </td>
        <td class="ht-cell-moves">${moves}</td>
        <td class="ht-cell-date">${date}</td>
      </tr>`;
    }).join('');
  },

  _renderHistoryPagination() {
    const el = document.getElementById('history-pagination');
    const total = this._historyFiltered.length;
    const pages = Math.ceil(total / this._historyPerPage);
    if (pages <= 1) { el.innerHTML = ''; return; }

    let html = `<button class="hp-btn" onclick="App._historyGoPage(${this._historyPage - 1})" ${this._historyPage <= 1 ? 'disabled' : ''}>&lt;</button>`;
    for (let i = 1; i <= pages; i++) {
      html += `<button class="hp-btn ${i === this._historyPage ? 'active' : ''}" onclick="App._historyGoPage(${i})">${i}</button>`;
    }
    html += `<button class="hp-btn" onclick="App._historyGoPage(${this._historyPage + 1})" ${this._historyPage >= pages ? 'disabled' : ''}>&gt;</button>`;
    el.innerHTML = html;
  },

  _historyGoPage(p) {
    const pages = Math.ceil(this._historyFiltered.length / this._historyPerPage);
    if (p < 1 || p > pages) return;
    this._historyPage = p;
    this._renderHistoryTable();
    this._renderHistoryPagination();
  },

  // --- Auth ---
  showAuth() {
    document.getElementById('auth-overlay').classList.remove('hidden');
  },

  hideAuth() {
    document.getElementById('auth-overlay').classList.add('hidden');
  },

  async handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.querySelector('[name="username"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!username || !password) { errEl.textContent = 'fill in all fields'; return; }
    if (username.length < 3) { errEl.textContent = 'username must be 3+ characters'; return; }
    if (password.length < 4) { errEl.textContent = 'password must be 4+ characters'; return; }
    try {
      await Account.register(username, password);
      this.updateUserBar();
      this.hideAuth();
      this._initSocial();
    } catch (err) {
      errEl.textContent = err.message;
    }
  },

  async handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.querySelector('[name="username"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    try {
      await Account.login(username, password);
      this.updateUserBar();
      this.hideAuth();
      this._initSocial();
    } catch (err) {
      errEl.textContent = err.message;
    }
  },

  showGuestForm() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.querySelector('.auth-tabs').style.display = 'none';
    document.querySelector('.auth-skip').style.display = 'none';
    document.getElementById('auth-error').textContent = '';
    document.getElementById('guest-form').style.display = 'block';
  },

  showLoginForm() {
    document.getElementById('guest-form').style.display = 'none';
    document.querySelector('.auth-tabs').style.display = 'flex';
    document.querySelector('.auth-skip').style.display = 'block';
    document.getElementById('login-form').style.display = 'flex';
    document.getElementById('register-form').style.display = 'none';
    document.querySelector('.auth-tabs').children[0].classList.add('active');
    document.querySelector('.auth-tabs').children[1].classList.remove('active');
  },

  async handleGuestName(e) {
    e.preventDefault();
    const input = e.target.querySelector('[name="guestname"]');
    const name = input.value.trim();
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!name || name.length < 2) { errEl.textContent = 'name must be at least 2 characters'; document.getElementById('guest-form').insertBefore(errEl, e.target); return; }
    try {
      await Account.loginAsGuest(name);
      this.updateUserBar();
      this.hideAuth();
    } catch (err) {
      errEl.textContent = err.message;
    }
  },

  skipAuth() {
    this.showGuestForm();
  },

  updateUserBar() {
    const bar = document.getElementById('nav-user-bar');
    if (!bar) return;
    if (Account.user) {
      const letter = Account.user.username[0].toUpperCase();
      const suffix = Account.isGuest ? ' <span class="nav-user-guest">(guest)</span>' : '';
      bar.innerHTML = `<div class="nav-user-avatar${Account.isGuest ? ' guest' : ''}">${letter}</div><span class="nav-user-name">${Account.user.username}${suffix}</span>`;
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  },

  // --- Setup ---
  toggleOptions() {
    this.optionsOpen = !this.optionsOpen;
    const body = document.getElementById('options-body');
    const arrow = document.getElementById('options-arrow');
    if (this.optionsOpen) {
      body.classList.remove('collapsed');
      body.style.maxHeight = body.scrollHeight + 'px';
    } else {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.offsetHeight; // force reflow
      body.classList.add('collapsed');
    }
    arrow.innerHTML = this.optionsOpen ? '&#9650;' : '&#9660;';
  },

  selectColor(color) {
    this.playerColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    document.querySelectorAll('#color-options .color-icon-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#color-options [data-color="${color}"]`).classList.add('selected');
  },

  selectDifficulty(diff) {
    this.difficulty = diff;
    document.querySelectorAll('#diff-options button').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#diff-options [data-diff="${diff}"]`).classList.add('selected');
    const slider = document.getElementById('custom-slider-group');
    if (slider) slider.style.display = diff === 'custom' ? 'flex' : 'none';
    this.updateBotPreview();
  },

  setCustomRating(val) {
    this.customRating = parseInt(val);
    BOT_PROFILES.custom.rating = this.customRating;
    CustomBot.maxDepth = Math.max(1, Math.min(4, Math.floor(this.customRating / 750) + 1));
    document.getElementById('custom-rating-val').textContent = this.customRating;
    this.updateBotPreview();
  },

  selectTime(btn) {
    this.timeControl = btn.dataset.time;
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  },

  updateBotPreview() {
    const bot = BOT_PROFILES[this.difficulty];
    const preview = document.getElementById('bot-preview');
    if (!preview || !bot) return;
    preview.style.display = 'flex';
    document.getElementById('bot-avatar').textContent = bot.name[0];
    document.getElementById('bot-avatar').style.background = bot.color;
    document.getElementById('bot-pv-name').textContent = bot.name;
    document.getElementById('bot-pv-rating').textContent = bot.rating;
    document.getElementById('bot-speech').textContent = bot.desc;
  },

  updateSidebarBot() {
    const el = document.getElementById('sidebar-bot');
    if (!el) return;
    const bot = BOT_PROFILES[this.difficulty] || BOT_PROFILES.medium;
    el.innerHTML = `<div class="sidebar-bot-avatar" style="background:${bot.color}">${bot.name[0]}</div>
      <div class="sidebar-bot-info">
        <span class="sidebar-bot-name">${bot.name}</span>
        <span class="sidebar-bot-rating">${bot.rating}</span>
      </div>`;
  },

  updateOpeningName() {
    const el = document.getElementById('opening-bar');
    if (!el) return;
    const name = (typeof findOpeningName === 'function') ? findOpeningName(ChessGame.engine) : '';
    if (name) {
      el.textContent = name;
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  },

  async startGame() {
    this.enterGameMode();
    this.moveHistory = [];
    this.gameActive = true;

    // Chess960 variant: generate random starting position
    if (this.pendingVariant === 'chess960') {
      ChessGame.newGame(this._generate960Fen());
      this.pendingVariant = null;
    } else {
      ChessGame.newGame();
    }
    this.botColor = this.playerColor === 'w' ? 'b' : 'w';
    Board.playerColor = this.playerColor;

    if (this.playerColor === 'b' && !Board.flipped) Board.flip();
    if (this.playerColor === 'w' && Board.flipped) Board.flip();

    Board.render(ChessGame.board());
    Board.clearResultIcons();
    this.updateMoveList();
    this.updatePlayerBars();
    this.updateSidebarBot();
    this.updateOpeningName();
    Sound.play('game-start');

    // Setup clock
    if (this.timeControl && this.timeControl !== 'none') {
      const [timeStr, incStr] = this.timeControl.split('+');
      Clock.onFlag = (color) => this._onClockFlag(color);
      Clock.start(parseFloat(timeStr), parseInt(incStr || 0));
      // White's clock starts on game start
      Clock.switchTo('w');
    } else {
      Clock.start(0, 0); // disables clocks
    }

    if (this.difficulty === 'custom') {
      this.bot = CustomBot;
    } else {
      this.bot = createBot(this.difficulty);
      if (this.difficulty === 'hard' && StockfishBot.init) {
        try { await StockfishBot.init(); } catch (e) {
          console.warn('Stockfish failed to load, falling back to medium');
          this.bot = MinimaxBot;
        }
      }
    }

    if (this.botColor === 'w') {
      setTimeout(() => this.botMove(), 300);
    }
  },

  // --- Game play ---
  handlePlayerMove(from, to, promotion) {
    if (!this.gameActive) return;
    if (ChessGame.turn() !== this.playerColor) return;

    Board.clearHint();
    if (this.hintTimeout) { clearTimeout(this.hintTimeout); this.hintTimeout = null; }

    const move = ChessGame.makeMove(from, to, promotion);
    if (!move) return;

    this.afterMove(move);

    if (!ChessGame.isGameOver()) {
      setTimeout(() => this.botMove(), 200);
    }
  },

  async botMove() {
    if (!this.gameActive || ChessGame.isGameOver()) return;

    Board.playerColor = '__none__';
    let move;
    try {
      move = await Promise.resolve(this.bot.getMove(ChessGame.engine));
    } catch(e) {
      console.warn('Bot move error', e);
    }

    if (move) {
      const result = ChessGame.makeMove(move.from, move.to, move.promotion);
      if (result) this.afterMove(result);
    }
    Board.playerColor = this.playerColor;
  },

  afterMove(move) {
    Board.render(ChessGame.board());
    Board.animateMove(move.from, move.to);
    if (typeof Settings !== 'undefined' && Settings.current && Settings.current.highlightMoves) {
      Board.setLastMove(move.from, move.to);
    }

    if (ChessGame.inCheck()) {
      const kingSquare = Board.findKing(ChessGame.turn(), ChessGame.board());
      Board.setCheck(kingSquare);
    } else {
      Board.setCheck(null);
    }

    // Play sound based on move type
    if (ChessGame.isGameOver()) {
      Sound.play('game-end');
    } else if (ChessGame.inCheck()) {
      Sound.play('move-check');
    } else if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
      Sound.play('castle');
    } else if (move.captured) {
      Sound.play('capture');
    } else if (move.promotion) {
      Sound.play('promote');
    } else if (move.color === this.playerColor) {
      Sound.play('move-self');
    } else {
      Sound.play('move-opponent');
    }

    this.moveHistory = ChessGame.history({ verbose: true });
    this.updateMoveList();
    this.updatePlayerBars();
    this.updateOpeningName();

    // Switch clock to the side whose turn it now is
    if (Clock.enabled && !ChessGame.isGameOver()) {
      Clock.switchTo(ChessGame.turn());
    }

    if (ChessGame.isGameOver()) {
      this.gameActive = false;
      Clock.stop();
      const result = ChessGame.getResult();
      this.showGameOver(result);
    }
  },

  // --- Hint ---
  showHint() {
    if (!this.gameActive) return;
    if (ChessGame.turn() !== this.playerColor) return;

    Board.clearHint();
    if (this.hintTimeout) { clearTimeout(this.hintTimeout); this.hintTimeout = null; }

    const hintMove = MinimaxBot.getMove(ChessGame.engine);
    if (hintMove) {
      Board.showHint(hintMove.from, hintMove.to);
      this.hintTimeout = setTimeout(() => Board.clearHint(), 3000);
    }
  },

  // --- Undo ---
  undoMove() {
    if (!this.gameActive) return;
    const takebacksOn = document.getElementById('opt-takebacks');
    if (!takebacksOn || !takebacksOn.checked) return;
    // Undo bot's last move and player's last move
    const undo1 = ChessGame.undo();
    const undo2 = ChessGame.undo();
    if (undo1 || undo2) {
      Board.render(ChessGame.board());
      Board.setCheck(null);
      Board.clearSelection();
      Board.clearHint();
      // Re-highlight last move if exists
      const hist = ChessGame.history({ verbose: true });
      if (hist.length > 0) {
        const last = hist[hist.length - 1];
        if (typeof Settings !== 'undefined' && Settings.current && Settings.current.highlightMoves) {
          Board.setLastMove(last.from, last.to);
        }
      } else {
        Board.el.querySelectorAll('.last-move-light, .last-move-dark').forEach(el => {
          el.classList.remove('last-move-light', 'last-move-dark');
        });
      }
      if (ChessGame.inCheck()) {
        Board.setCheck(Board.findKing(ChessGame.turn(), ChessGame.board()));
      }
      this.updateMoveList();
      this.updatePlayerBars();
      this.updateOpeningName();
    }
  },

  // --- UI updates ---
  updateMoveList() {
    const list = document.getElementById('move-list');
    const history = ChessGame.history();
    let html = '';

    for (let i = 0; i < history.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const white = history[i] || '';
      const black = history[i + 1] || '';
      html += `<div class="move-row">
        <span class="move-num">${moveNum}.</span>
        <span class="move-cell${i === history.length - 1 && !black ? ' active' : ''}">${white}</span>
        <span class="move-cell${i + 1 === history.length - 1 ? ' active' : ''}">${black}</span>
      </div>`;
    }

    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  },

  updatePlayerBars() {
    const board = ChessGame.board();
    const captured = { w: [], b: [] };
    const allPieces = { w: { p:8,n:2,b:2,r:2,q:1 }, b: { p:8,n:2,b:2,r:2,q:1 } };
    const currentPieces = { w: { p:0,n:0,b:0,r:0,q:0 }, b: { p:0,n:0,b:0,r:0,q:0 } };

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type !== 'k') currentPieces[p.color][p.type]++;
      }
    }

    for (const color of ['w', 'b']) {
      for (const type of ['q', 'r', 'b', 'n', 'p']) {
        const diff = allPieces[color][type] - currentPieces[color][type];
        for (let i = 0; i < diff; i++) {
          captured[color === 'w' ? 'b' : 'w'].push({ color, type });
        }
      }
    }

    const materialScore = (pieces) => pieces.reduce((s, p) => s + (PIECE_VALUES[p.type] || 0), 0);
    const wScore = materialScore(captured.w);
    const bScore = materialScore(captured.b);

    const topColor = Board.flipped ? 'w' : 'b';
    const bottomColor = Board.flipped ? 'b' : 'w';

    const topNameId = this.activeBoardId === 'game-board' ? 'game-top-name' : 'top-name';
    const bottomNameId = this.activeBoardId === 'game-board' ? 'game-bottom-name' : 'bottom-name';
    const topCapId = this.activeBoardId === 'game-board' ? 'game-top-captured' : 'top-captured';
    const bottomCapId = this.activeBoardId === 'game-board' ? 'game-bottom-captured' : 'bottom-captured';

    this._renderPlayerBar(topCapId, captured[topColor === 'w' ? 'w' : 'b'], topColor === 'w' ? 'b' : 'w',
      topColor === 'w' ? wScore - bScore : bScore - wScore);
    this._renderPlayerBar(bottomCapId, captured[bottomColor === 'w' ? 'w' : 'b'], bottomColor === 'w' ? 'b' : 'w',
      bottomColor === 'w' ? wScore - bScore : bScore - wScore);

    const bot = BOT_PROFILES[this.difficulty] || BOT_PROFILES.medium;
    const playerName = Account.user ? Account.user.username : 'You';
    const playerLetter = Account.user ? Account.user.username[0].toUpperCase() : 'Y';
    const botIsTop = !Board.flipped;

    const topNameEl = document.getElementById(topNameId);
    const bottomNameEl = document.getElementById(bottomNameId);
    if (topNameEl) {
      topNameEl.innerHTML = botIsTop
        ? `<span class="bar-avatar" style="background:${bot.color}">${bot.name[0]}</span>${bot.name} <span class="bar-rating">(${bot.rating})</span>`
        : `<span class="bar-avatar" style="background:#666">${playerLetter}</span>${playerName}`;
    }
    if (bottomNameEl) {
      bottomNameEl.innerHTML = botIsTop
        ? `<span class="bar-avatar" style="background:#666">${playerLetter}</span>${playerName}`
        : `<span class="bar-avatar" style="background:${bot.color}">${bot.name[0]}</span>${bot.name} <span class="bar-rating">(${bot.rating})</span>`;
    }
  },

  _renderPlayerBar(elId, pieces, capturedByColor, scoreDiff) {
    const el = document.getElementById(elId);
    if (!el) return;
    let html = '';
    pieces.forEach(p => {
      const src = (typeof Settings !== 'undefined' && Settings.getPiecePath) ? Settings.getPiecePath(p.color, p.type) : 'assets/pieces/neo/' + p.color + p.type.toUpperCase() + '.png';
      html += `<img src="${src}" alt="">`;
    });
    if (scoreDiff > 0) html += `<span class="score-diff">+${Math.round(scoreDiff / 100)}</span>`;
    el.innerHTML = html;
  },

  // --- Game over ---
  showGameOver(result) {
    const overlay = document.getElementById('gameover-overlay');
    const title = document.getElementById('gameover-title');
    const desc = document.getElementById('gameover-desc');
    const botSection = document.getElementById('gameover-bot-section');
    const bot = BOT_PROFILES[this.difficulty] || BOT_PROFILES.medium;

    // Result icons on kings
    const board = ChessGame.board();
    const playerKing = Board.findKing(this.playerColor, board);
    const botKing = Board.findKing(this.botColor, board);

    if (result.type === 'checkmate' || result.type === 'resignation' || result.type === 'timeout') {
      if (result.winner === this.playerColor) {
        title.textContent = 'You Beat ' + bot.name + '!';
        desc.textContent = result.type === 'resignation' ? 'by resignation' : result.type === 'timeout' ? 'on time' : 'by checkmate';
        if (Account.isLoggedIn()) Account.updateStats('win');
        Board.setResultIcons(playerKing, botKing);
      } else {
        title.textContent = bot.name + ' Wins';
        desc.textContent = result.type === 'resignation' ? 'by resignation' : result.type === 'timeout' ? 'on time' : 'by checkmate';
        if (Account.isLoggedIn()) Account.updateStats('loss');
        Board.setResultIcons(botKing, playerKing);
      }
    } else {
      title.textContent = 'Draw';
      desc.textContent = result.type === 'stalemate' ? 'by stalemate' :
        result.type === 'repetition' ? 'by repetition' :
        result.type === 'insufficient' ? 'insufficient material' : 'draw';
      if (Account.isLoggedIn()) Account.updateStats('draw');
    }

    // Bot avatar + message
    if (botSection) {
      let msg = '';
      if (result.winner === this.playerColor) msg = 'Well played! You got me.';
      else if (result.winner === this.botColor) msg = 'Better luck next time!';
      else msg = 'A hard-fought draw!';
      botSection.innerHTML = `
        <div class="gameover-avatar" style="background:${bot.color}">${bot.name[0]}</div>
        <div class="gameover-msg">${msg}</div>
      `;
    }

    overlay.classList.add('active');
    this.recordStreak();
  },

  closeGameOver() {
    document.getElementById('gameover-overlay').classList.remove('active');
    this.gameActive = false;
    Clock.stop();
    if (Board.el) {
      Board.clearSelection();
      Board.setCheck(null);
      Board.clearHint();
      Board.clearResultIcons();
      Board.el.querySelectorAll('.last-move-light, .last-move-dark').forEach(el => {
        el.classList.remove('last-move-light', 'last-move-dark');
      });
    }
  },

  _generate960Fen() {
    // Generate a valid Chess960 starting position
    const pieces = new Array(8).fill(null);
    const place = (piece, positions) => {
      const idx = positions[Math.floor(Math.random() * positions.length)];
      pieces[idx] = piece;
      return idx;
    };
    // 1. Place bishops on opposite-colored squares
    const lightSqs = [0, 2, 4, 6];
    const darkSqs = [1, 3, 5, 7];
    place('b', lightSqs);
    place('b', darkSqs);
    // 2. Place queen on any empty square
    let empty = () => pieces.map((p, i) => p === null ? i : -1).filter(i => i >= 0);
    place('q', empty());
    // 3. Place knights on any 2 empty squares
    place('n', empty());
    place('n', empty());
    // 4. Place rook, king, rook on remaining 3 squares (king between rooks)
    const rem = empty();
    pieces[rem[0]] = 'r';
    pieces[rem[1]] = 'k';
    pieces[rem[2]] = 'r';

    const rank = pieces.map(p => p).join('');
    const whiteRank = rank.toUpperCase();
    const blackRank = rank;
    return `${blackRank}/pppppppp/8/8/8/8/PPPPPPPP/${whiteRank} w KQkq - 0 1`;
  },

  _onClockFlag(color) {
    if (!this.gameActive) return;
    this.gameActive = false;
    Sound.play('game-end');
    const winner = color === 'w' ? 'b' : 'w';
    this.showGameOver({ type: 'timeout', winner });
  },

  resign() {
    if (!this.gameActive) return;
    this.gameActive = false;
    Clock.stop();
    Sound.play('game-end');
    this.showGameOver({ type: 'resignation', winner: this.botColor });
  },

  newGame() {
    this.closeGameOver();
    this.enterHomeMode();
  },

  // --- Streak ---
  async loadStreak() {
    if (!Account.isLoggedIn() || Account.isGuest) {
      this._renderStreak(0, false, []);
      return;
    }
    try {
      const resp = await fetch('/api/ojjychess/streak', {
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      this._renderStreak(data.streak || 0, data.todayPlayed || false, data.weekDays || []);
    } catch(e) { console.warn('loadStreak failed', e); }
  },

  async recordStreak() {
    if (!Account.isLoggedIn() || Account.isGuest) return;
    try {
      const resp = await fetch('/api/ojjychess/streak', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      this._renderStreak(data.streak || 0, true, data.weekDays || []);
    } catch(e) {}
  },

  _renderStreak(count, todayPlayed, weekDays) {
    const countEl = document.getElementById('streak-count');
    const weekEl = document.getElementById('streak-week');
    const flameEl = document.getElementById('streak-flame');
    if (!countEl || !weekEl || !flameEl) return;

    countEl.textContent = count + (count === 1 ? ' Day' : ' Days');

    // Flame level based on streak count
    let level = 0;
    if (count >= 30) level = 4;
    else if (count >= 14) level = 3;
    else if (count >= 7) level = 2;
    else if (count >= 1) level = 1;

    flameEl.className = 'streak-flame level-' + level;

    // Chess.com's exact SVG paths (from play-streak/small-icons, viewBox 0 0 120 121)
    const outerFlame = 'M90.1233 49.4545C91.1408 57.1943 86.1038 61.3942 81.4828 62.2775C88.5489 37.0525 79.2316 14.8663 51.4199 0C53.1056 3.41137 54.0412 7.14234 54.1638 10.9434C54.054 31.2435 18 48.6982 18 80.8719C18 96.822 26.1705 106.452 34.4105 112.108C48.8339 122.008 69.676 122.735 84.5581 113.083C93.7141 107.145 102 96.8044 102 80.3218C101.505 67.3933 98.6808 59.18 90.1233 49.4545Z';
    const innerFlame = 'M38.5687 68.6526C37.8347 74.2323 41.4686 77.2601 44.8024 77.8969C39.7046 59.7118 46.4265 43.7174 66.491 33C65.2749 35.4593 64.5999 38.149 64.5115 40.8893C64.5907 55.5239 90.6016 68.1074 90.6016 91.302C90.6016 114.497 66.617 119.151 66.617 119.151H54.4953C45.9042 117.889 30.0004 110.287 30.0004 90.9054C30.3575 81.585 32.395 75.6639 38.5687 68.6526Z';
    const pawnUpper = 'M74 93L75.9737 86.1031L69.834 82.0555C71.7595 80.2062 73.0891 77.816 73.6504 75.1952C74.2116 72.5744 73.9786 69.844 72.9815 67.3585C71.9844 64.8729 70.2692 62.7469 68.0587 61.2565C65.8482 59.7661 63.2444 58.98 60.5852 59.0004C58.8383 58.9899 57.1064 59.3265 55.4885 59.9909C53.8706 60.6553 52.3984 61.6345 51.1558 62.8726C49.9132 64.1107 48.9247 65.5835 48.2466 67.2068C47.5686 68.8301 47.2143 70.5721 47.204 72.3335C47.2198 75.9419 48.6319 79.4016 51.1396 81.9762L45 86.0237L47 93H74Z';
    const pawnShadow1 = 'M73.1807 84.2603C68.5 87.5 64.1024 85.9952 64.0217 86.0355C66.1404 85.0266 68.7435 83.2711 69.8427 82.0664L73.1807 84.2603Z';
    const pawnBase = 'M52.9997 93C52.9997 108.979 37.8536 116.429 28.6051 107.326C46.0233 124.469 75.0087 124.329 91.5935 107.332C82.345 116.434 67.9997 108.979 67.9997 93L60.4046 90.3535L52.9997 93Z';
    const pawnShadow2 = 'M69.7868 102.008L53 93H68C67.939 98.1906 69.7868 102.008 69.7868 102.008Z';

    // Colors per level (from chess.com active-1 through active-10)
    const levelColors = [
      null,                                                  // level 0 = inactive
      { outer: '#E3AA24', inner: '#F7C631' },                // level 1: golden amber
      { outer: '#FA742C', inner: '#FFA459' },                // level 2: orange
      { outer: '#940C45', inner: '#C4144F' },                // level 3: deep red
      { outer: '#5D9948', inner: '#81B64C' },                // level 4: chess.com green
    ];

    if (level === 0) {
      // Inactive: single grey flame + pawn (no inner flame, matching chess.com inactive.svg)
      flameEl.innerHTML = `
        <path d="${outerFlame}" fill="#4B4847"/>
        <path d="${pawnUpper}" fill="white"/>
        <path d="${pawnShadow1}" fill="#BEBDB9" opacity="0.3"/>
        <path d="${pawnBase}" fill="white"/>
        <path d="${pawnShadow2}" fill="#BEBDB9" opacity="0.3"/>
      `;
    } else {
      const c = levelColors[level];
      flameEl.innerHTML = `
        <path d="${outerFlame}" fill="${c.outer}"/>
        <path d="${innerFlame}" fill="${c.inner}"/>
        <path d="${pawnUpper}" fill="white"/>
        <path d="${pawnShadow1}" fill="#BEBDB9" opacity="0.3"/>
        <path d="${pawnBase}" fill="white"/>
        <path d="${pawnShadow2}" fill="#BEBDB9" opacity="0.3"/>
      `;
    }

    // Render week days
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    let html = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayIndex = d.getDay();
      const filled = weekDays.includes(dateStr);
      const isToday = dateStr === todayStr;
      html += `<div class="streak-day">
        <span class="streak-day-label">${dayNames[dayIndex]}</span>
        <div class="streak-day-box${filled ? ' filled' : ''}${isToday ? ' today' : ''}"></div>
      </div>`;
    }
    weekEl.innerHTML = html;
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
