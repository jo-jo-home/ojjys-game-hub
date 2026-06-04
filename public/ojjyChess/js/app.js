// Main app controller
const App = {
  bot: null,
  botColor: 'b',
  difficulty: 'medium',
  playerColor: 'w',
  gameActive: false,
  moveHistory: [],

  async init() {
    Board.init('board');
    Board.onMoveAttempt = (from, to, promotion) => this.handlePlayerMove(from, to, promotion);

    // Try to restore session
    if (Account.isLoggedIn()) {
      const profile = await Account.getProfile();
      if (profile) {
        this.updateUserBar();
        this.hideAuth();
        this.showSetup();
        return;
      }
    }
    this.showAuth();
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
      this.showSetup();
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
      this.showSetup();
    } catch (err) {
      errEl.textContent = err.message;
    }
  },

  skipAuth() {
    this.hideAuth();
    this.showSetup();
  },

  updateUserBar() {
    const bar = document.getElementById('user-bar');
    if (Account.user) {
      const s = Account.user.stats || { wins: 0, losses: 0, draws: 0 };
      bar.innerHTML = `<span class="username">${Account.user.username}</span>
        <span class="stats">${s.wins}W ${s.losses}L ${s.draws}D</span>`;
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  },

  // --- Setup ---
  showSetup() {
    document.getElementById('setup-panel').style.display = 'flex';
    document.getElementById('game-sidebar').style.display = 'none';
  },

  hideSetup() {
    document.getElementById('setup-panel').style.display = 'none';
    document.getElementById('game-sidebar').style.display = 'flex';
  },

  selectColor(color) {
    this.playerColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    document.querySelectorAll('#color-options button').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#color-options [data-color="${color}"]`).classList.add('selected');
  },

  selectDifficulty(diff) {
    this.difficulty = diff;
    document.querySelectorAll('#diff-options button').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#diff-options [data-diff="${diff}"]`).classList.add('selected');
  },

  async startGame() {
    this.hideSetup();
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

    // Create bot
    this.bot = createBot(this.difficulty);
    if (this.difficulty === 'hard' && StockfishBot.init) {
      try { await StockfishBot.init(); } catch (e) {
        console.warn('Stockfish failed to load, falling back to medium');
        this.bot = MinimaxBot;
      }
    }

    // If bot plays first (player is black)
    if (this.botColor === 'w') {
      setTimeout(() => this.botMove(), 300);
    }
  },

  // --- Game play ---
  handlePlayerMove(from, to, promotion) {
    if (!this.gameActive) return;
    if (ChessGame.turn() !== this.playerColor) return;

    const move = ChessGame.makeMove(from, to, promotion);
    if (!move) return;

    this.afterMove(move);

    // Bot responds
    if (!ChessGame.isGameOver()) {
      setTimeout(() => this.botMove(), 200);
    }
  },

  async botMove() {
    if (!this.gameActive || ChessGame.isGameOver()) return;

    Board.playerColor = '__none__'; // Disable player clicks during bot turn
    let move;
    if (this.bot.getMove.constructor.name === 'AsyncFunction' || this.bot === StockfishBot) {
      move = await this.bot.getMove(ChessGame.engine);
    } else {
      move = this.bot.getMove(ChessGame.engine);
    }

    if (move) {
      const result = ChessGame.makeMove(move.from, move.to, move.promotion);
      if (result) this.afterMove(result);
    }
    Board.playerColor = this.playerColor;
  },

  afterMove(move) {
    Board.render(ChessGame.board());
    Board.setLastMove(move.from, move.to);

    // Check highlight
    if (ChessGame.inCheck()) {
      const kingSquare = Board.findKing(ChessGame.turn(), ChessGame.board());
      Board.setCheck(kingSquare);
    } else {
      Board.setCheck(null);
    }

    this.moveHistory = ChessGame.history({ verbose: true });
    this.updateMoveList();
    this.updatePlayerBars();

    if (ChessGame.isGameOver()) {
      this.gameActive = false;
      const result = ChessGame.getResult();
      this.showGameOver(result);
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
        if (p && p.type !== 'k') {
          currentPieces[p.color][p.type]++;
        }
      }
    }

    for (const color of ['w', 'b']) {
      for (const type of ['q', 'r', 'b', 'n', 'p']) {
        const diff = allPieces[color][type] - currentPieces[color][type];
        for (let i = 0; i < diff; i++) {
          // Captured by the OTHER player
          captured[color === 'w' ? 'b' : 'w'].push({ color, type });
        }
      }
    }

    // Score advantage
    const materialScore = (pieces) => pieces.reduce((s, p) => s + (PIECE_VALUES[p.type] || 0), 0);
    const wScore = materialScore(captured.w);
    const bScore = materialScore(captured.b);

    const topColor = Board.flipped ? 'w' : 'b';
    const bottomColor = Board.flipped ? 'b' : 'w';

    this._renderPlayerBar('top-captured', captured[topColor === 'w' ? 'w' : 'b'], topColor === 'w' ? 'b' : 'w',
      topColor === 'w' ? wScore - bScore : bScore - wScore);
    this._renderPlayerBar('bottom-captured', captured[bottomColor === 'w' ? 'w' : 'b'], bottomColor === 'w' ? 'b' : 'w',
      bottomColor === 'w' ? wScore - bScore : bScore - wScore);

    // Names
    const botName = this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1) + ' Bot';
    const playerName = Account.user ? Account.user.username : 'You';
    document.getElementById('top-name').textContent = Board.flipped ? playerName : botName;
    document.getElementById('bottom-name').textContent = Board.flipped ? botName : playerName;
  },

  _renderPlayerBar(elId, pieces, capturedByColor, scoreDiff) {
    const el = document.getElementById(elId);
    let html = '';
    pieces.forEach(p => {
      html += `<img src="assets/pieces/${p.color}${p.type.toUpperCase()}.svg" alt="">`;
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
  },

  closeGameOver() {
    document.getElementById('gameover-overlay').classList.remove('active');
    this.showSetup();
    Board.clearSelection();
    Board.setCheck(null);
    Board.el.querySelectorAll('.last-move-light, .last-move-dark').forEach(el => {
      el.classList.remove('last-move-light', 'last-move-dark');
    });
  },

  resign() {
    if (!this.gameActive) return;
    this.gameActive = false;
    this.showGameOver({ type: 'checkmate', winner: this.botColor });
  },

  newGame() {
    this.closeGameOver();
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
