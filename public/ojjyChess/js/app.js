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
    document.getElementById('setup-panel').style.display = 'flex';

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
    document.getElementById('game-layout').style.display = 'flex';

    Board.init('game-board');
    Board.onMoveAttempt = (from, to, promotion) => this.handlePlayerMove(from, to, promotion);
    this.activeBoardId = 'game-board';
  },

  _initSocial() {
    if (typeof Friends !== 'undefined') Friends.init();
    if (typeof Notifications !== 'undefined') Notifications.init();
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
    body.style.display = this.optionsOpen ? 'flex' : 'none';
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

    ChessGame.newGame();
    this.botColor = this.playerColor === 'w' ? 'b' : 'w';
    Board.playerColor = this.playerColor;

    if (this.playerColor === 'b' && !Board.flipped) Board.flip();
    if (this.playerColor === 'w' && Board.flipped) Board.flip();

    Board.render(ChessGame.board());
    this.updateMoveList();
    this.updatePlayerBars();
    this.updateSidebarBot();
    this.updateOpeningName();

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
    if (typeof Settings !== 'undefined' && Settings.current && Settings.current.highlightMoves) {
      Board.setLastMove(move.from, move.to);
    }

    if (ChessGame.inCheck()) {
      const kingSquare = Board.findKing(ChessGame.turn(), ChessGame.board());
      Board.setCheck(kingSquare);
    } else {
      Board.setCheck(null);
    }

    this.moveHistory = ChessGame.history({ verbose: true });
    this.updateMoveList();
    this.updatePlayerBars();
    this.updateOpeningName();

    if (ChessGame.isGameOver()) {
      this.gameActive = false;
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

    if (result.type === 'checkmate') {
      if (result.winner === this.playerColor) {
        title.textContent = 'You Win!';
        desc.textContent = 'by checkmate';
        if (Account.isLoggedIn()) Account.updateStats('win');
      } else {
        title.textContent = 'You Lose';
        desc.textContent = 'by checkmate';
        if (Account.isLoggedIn()) Account.updateStats('loss');
      }
    } else {
      title.textContent = 'Draw';
      desc.textContent = result.type === 'stalemate' ? 'by stalemate' :
        result.type === 'repetition' ? 'by repetition' :
        result.type === 'insufficient' ? 'insufficient material' : 'draw';
      if (Account.isLoggedIn()) Account.updateStats('draw');
    }

    overlay.classList.add('active');

    // Record streak (any completed game counts)
    this.recordStreak();
  },

  closeGameOver() {
    document.getElementById('gameover-overlay').classList.remove('active');
    this.gameActive = false;
    if (Board.el) {
      Board.clearSelection();
      Board.setCheck(null);
      Board.clearHint();
      Board.el.querySelectorAll('.last-move-light, .last-move-dark').forEach(el => {
        el.classList.remove('last-move-light', 'last-move-dark');
      });
    }
  },

  resign() {
    if (!this.gameActive) return;
    this.gameActive = false;
    this.showGameOver({ type: 'checkmate', winner: this.botColor });
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

    // Flame SVG and level based on streak count
    let level = 0;
    if (count >= 30) level = 4;
    else if (count >= 14) level = 3;
    else if (count >= 7) level = 2;
    else if (count >= 1) level = 1;

    flameEl.className = 'streak-flame level-' + level;

    // Simple pawn silhouette — small, centered in lower half of flame (chess.com style)
    const pawnPath = 'M32 28 C30 28 28.5 26.5 28.5 24.5 C28.5 23 29.5 21.8 31 21.5 C31 20.5 30.2 19.5 30.2 18.8 C30.2 17.2 31 16.5 32 16.5 C33 16.5 33.8 17.2 33.8 18.8 C33.8 19.5 33 20.5 33 21.5 C34.5 21.8 35.5 23 35.5 24.5 C35.5 26.5 34 28 32 28Z M29 28.5 L35 28.5 C37 29.5 38.5 31.5 38.5 34 L25.5 34 C25.5 31.5 27 29.5 29 28.5Z M25 35 L39 35 L39 37 C39 37.5 38.5 38 38 38 L26 38 C25.5 38 25 37.5 25 37 Z M24 39 L40 39 L40 41 C40 41.5 39.5 42 39 42 L25 42 C24.5 42 24 41.5 24 41 Z';

    if (level === 0) {
      // Grey flame with darker pawn (chess.com 0-day style)
      flameEl.innerHTML = `
        <defs>
          <linearGradient id="greyFlame" x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stop-color="#8a8a8a"/>
            <stop offset="100%" stop-color="#5a5a5a"/>
          </linearGradient>
        </defs>
        <path d="M32 4 Q24 16 20 26 Q15 38 18 46 Q22 56 32 58 Q42 56 46 46 Q49 38 44 26 Q40 16 32 4Z" fill="url(#greyFlame)"/>
        <path d="M32 14 Q28 22 26 30 Q23 40 26 46 Q28 52 32 54 Q36 52 38 46 Q41 40 38 30 Q36 22 32 14Z" fill="#7a7a7a" opacity="0.5"/>
        <path d="${pawnPath}" fill="#3a3a3a" opacity="0.7"/>
      `;
    } else {
      // Warm golden/amber flame with white pawn (chess.com style)
      const fireColors = [
        null,
        ['#e8b730', '#d4952a', '#c07b22'],  // level 1 — golden amber
        ['#edc33a', '#d9a02e', '#c58524'],  // level 2
        ['#f2d044', '#e4ac32', '#d09028'],  // level 3
        ['#f7dd4e', '#eab836', '#dc9b2c'],  // level 4
      ];
      const c = fireColors[level];

      let svg = `
        <defs>
          <linearGradient id="fireGrad" x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stop-color="${c[0]}"/>
            <stop offset="60%" stop-color="${c[1]}"/>
            <stop offset="100%" stop-color="${c[2]}"/>
          </linearGradient>
        </defs>
        <!-- Outer flame -->
        <path d="M32 4 Q24 16 20 26 Q15 38 18 46 Q22 56 32 58 Q42 56 46 46 Q49 38 44 26 Q40 16 32 4Z" fill="url(#fireGrad)"/>
        <!-- Inner lighter flame -->
        <path d="M32 14 Q28 22 26 30 Q23 40 26 46 Q28 52 32 54 Q36 52 38 46 Q41 40 38 30 Q36 22 32 14Z" fill="${c[0]}" opacity="0.6"/>
      `;

      // Bright inner core for level 2+
      if (level >= 2) {
        svg += `<path d="M32 22 Q29 28 28 34 Q27 42 30 47 Q31 50 32 51 Q33 50 34 47 Q37 42 36 34 Q35 28 32 22Z" fill="#f5e06b" opacity="0.5"/>`;
      }

      // White-hot center for level 3+
      if (level >= 3) {
        svg += `<path d="M32 30 Q30 34 30 38 Q29 44 31 47 L32 48 L33 47 Q35 44 34 38 Q34 34 32 30Z" fill="#fff8c4" opacity="0.5"/>`;
      }

      // White pawn silhouette (chess.com style)
      svg += `<path d="${pawnPath}" fill="rgba(255,255,255,0.9)"/>`;

      flameEl.innerHTML = svg;
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
