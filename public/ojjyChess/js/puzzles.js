// Puzzle data, engine, settings, and UI
const PUZZLE_DATA = [
  {
    id: 'p1', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    solution: ['h5f7'], playerColor: 'w',
    theme: 'Scholar\'s Mate', rating: 400, goal: 'Checkmate in one move'
  },
  {
    id: 'p2', fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4',
    solution: ['f6e4'], playerColor: 'b',
    theme: 'Tactics', rating: 500, goal: 'Win material with a fork threat'
  },
  {
    id: 'p3', fen: '6k1/5ppp/8/8/8/8/r4PPP/1R4K1 w - - 0 1',
    solution: ['b1b8'], playerColor: 'w',
    theme: 'Back Rank Mate', rating: 600, goal: 'Checkmate in one move'
  },
  {
    id: 'p4', fen: 'r2qk2r/ppp2ppp/2n1bn2/3pp3/4P1b1/3P1N2/PPP1BPPP/RNBQ1RK1 w kq - 0 7',
    solution: ['e2b5'], playerColor: 'w',
    theme: 'Pin', rating: 700, goal: 'Pin the knight to the king'
  },
  {
    id: 'p5', fen: '2r3k1/pp3ppp/8/3q4/8/1P4P1/PB3P1P/3QR1K1 w - - 0 1',
    solution: ['e1e8'], playerColor: 'w',
    theme: 'Back Rank Mate', rating: 800, goal: 'Deliver checkmate'
  },
  {
    id: 'p6', fen: 'r4rk1/ppp2ppp/2n5/3N4/2BP4/8/PPP2PPP/R3K2R w KQ - 0 1',
    solution: ['d5f6'], playerColor: 'w',
    theme: 'Fork', rating: 650, goal: 'Fork the king and rook'
  },
  {
    id: 'p7', fen: 'rnb1kbnr/ppppqppp/8/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3',
    solution: ['f3e5'], playerColor: 'w',
    theme: 'Tactics', rating: 550, goal: 'Win the undefended pawn'
  },
  {
    id: 'p8', fen: '3rr1k1/ppp2ppp/8/3Q4/8/8/PPP2PPP/4RRK1 w - - 0 1',
    solution: ['d5g8', 'e8g8', 'e1e8'], playerColor: 'w',
    theme: 'Sacrifice', rating: 1000, goal: 'Sacrifice your queen for checkmate'
  },
  {
    id: 'p9', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3 0 3',
    solution: ['e5d4'], playerColor: 'b',
    theme: 'Opening', rating: 450, goal: 'Capture the center pawn'
  },
  {
    id: 'p10', fen: 'r1b1k2r/ppppqppp/2n2n2/2b5/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
    solution: ['e4e5'], playerColor: 'w',
    theme: 'Tactics', rating: 750, goal: 'Attack the knight with tempo'
  },
  {
    id: 'p11', fen: '5rk1/ppp2ppp/3b4/8/8/8/PPP2PPP/4R1K1 w - - 0 1',
    solution: ['e1e8'], playerColor: 'w',
    theme: 'Back Rank Mate', rating: 550, goal: 'Checkmate in one move'
  },
  {
    id: 'p12', fen: 'r2q1rk1/ppp1bppp/2n5/3pN3/3Pn3/3B4/PPP2PPP/R1BQ1RK1 w - - 0 10',
    solution: ['e5f7'], playerColor: 'w',
    theme: 'Fork', rating: 850, goal: 'Fork the queen and rook'
  },
];

const RANK_THRESHOLDS = [
  { xp: 0, name: 'Beginner', color: '#8b8987' },
  { xp: 100, name: 'Learner', color: '#5ba4cf' },
  { xp: 300, name: 'Tactician', color: '#81b64c' },
  { xp: 700, name: 'Specialist', color: '#e8c040' },
  { xp: 1500, name: 'Expert', color: '#e07020' },
  { xp: 3000, name: 'Master', color: '#e04040' },
  { xp: 6000, name: 'Grandmaster', color: '#b040e0' },
];

function getRank(xp) {
  let rank = RANK_THRESHOLDS[0];
  for (const t of RANK_THRESHOLDS) {
    if (xp >= t.xp) rank = t;
  }
  return rank;
}

function getNextRank(xp) {
  for (const t of RANK_THRESHOLDS) {
    if (xp < t.xp) return t;
  }
  return null;
}

// ---- Puzzle Settings ----
const PuzzleSettings = {
  _key: 'ojjychess_puzzle_settings',
  _defaults: {
    difficulty: 'standard',
    collectPoints: true,
    alwaysShowRating: false,
    showGoals: true,
    showMistakeFeedback: true,
    showChatHints: true,
    showTimer: true,
  },

  get() {
    try {
      const raw = localStorage.getItem(this._key);
      return raw ? { ...this._defaults, ...JSON.parse(raw) } : { ...this._defaults };
    } catch { return { ...this._defaults }; }
  },

  set(settings) {
    localStorage.setItem(this._key, JSON.stringify(settings));
  },

  update(key, value) {
    const s = this.get();
    s[key] = value;
    this.set(s);
  },
};

// ---- Puzzle Engine ----
const Puzzles = {
  chess: null,
  currentPuzzle: null,
  solutionIndex: 0,
  solved: false,
  failed: false,
  puzzleIndex: 0,
  streak: 0,
  xp: 0,
  timer: 0,
  timerInterval: null,
  leaderboardData: [],
  activeTab: 'puzzle', // 'puzzle' or 'leaderboard'

  async init() {
    await this.loadStats();
    this.loadPuzzle(0);
  },

  async loadStats() {
    if (!Account.isLoggedIn()) {
      this.xp = 0; this.streak = 0;
      return;
    }
    try {
      const resp = await fetch('/api/ojjychess/puzzles/stats', {
        headers: { 'Authorization': 'Bearer ' + Account.token },
      });
      if (resp.ok) {
        const data = await resp.json();
        this.xp = data.xp || 0;
        this.streak = data.streak || 0;
      }
    } catch {}
  },

  loadPuzzle(index) {
    if (index >= PUZZLE_DATA.length) index = 0;
    this.puzzleIndex = index;
    this.currentPuzzle = PUZZLE_DATA[index];
    this.solutionIndex = 0;
    this.solved = false;
    this.failed = false;
    this.timer = 0;
    this._stopTimer();

    // Create fresh chess instance from puzzle FEN
    this.chess = new Chess(this.currentPuzzle.fen);

    // Set up board
    Board.playerColor = this.currentPuzzle.playerColor;
    Board.flipped = this.currentPuzzle.playerColor === 'b';
    Board.el.innerHTML = '';
    Board._createSquares();
    Board.render(this.chess.board());
    Board.clearSelection();
    Board.setCheck(null);
    Board.setLastMove && Board.setLastMove(null, null);

    Board.onMoveAttempt = (from, to, promo) => this.handleMove(from, to, promo);
    Board.getLegalMovesFor = (sq) => this.chess.moves({ square: sq, verbose: true });

    this.renderUI();

    const settings = PuzzleSettings.get();
    if (settings.showTimer) this._startTimer();
  },

  handleMove(from, to, promotion) {
    if (this.solved || this.failed) return;

    const expected = this.currentPuzzle.solution[this.solutionIndex];
    const moveStr = from + to + (promotion || '');

    if (moveStr === expected || (from + to) === expected) {
      // Correct move
      const result = this.chess.move({ from, to, promotion: promotion || undefined });
      if (!result) return;

      this.solutionIndex++;
      Board.render(this.chess.board());
      Board.setLastMove(from, to);
      Sound.play(result.captured ? 'capture' : 'move-self');

      if (this.chess.in_check()) {
        const turn = this.chess.turn();
        const board = this.chess.board();
        Board.setCheck(Board.findKing(turn, board));
        Sound.play('move-check');
      } else {
        Board.setCheck(null);
      }

      if (this.solutionIndex >= this.currentPuzzle.solution.length) {
        // Puzzle solved!
        this.solved = true;
        this._stopTimer();
        this.streak++;
        Sound.play('notify');
        this._reportResult(true);
        this.renderUI();
      } else {
        // Play opponent's response after a short delay
        setTimeout(() => this._playOpponentMove(), 400);
      }
    } else {
      // Wrong move
      Sound.play('illegal');
      this.failed = true;
      this._stopTimer();
      this.streak = 0;
      this._reportResult(false);
      this.renderUI();
    }
  },

  _playOpponentMove() {
    if (this.solutionIndex >= this.currentPuzzle.solution.length) return;
    const moveStr = this.currentPuzzle.solution[this.solutionIndex];
    const from = moveStr.slice(0, 2);
    const to = moveStr.slice(2, 4);
    const promo = moveStr.length > 4 ? moveStr[4] : undefined;

    const result = this.chess.move({ from, to, promotion: promo });
    if (!result) return;

    this.solutionIndex++;
    Board.render(this.chess.board());
    Board.animateMove(from, to);
    Board.setLastMove(from, to);
    Sound.play(result.captured ? 'capture' : 'move-opponent');

    if (this.chess.in_check()) {
      const turn = this.chess.turn();
      Board.setCheck(Board.findKing(turn, this.chess.board()));
    } else {
      Board.setCheck(null);
    }
  },

  async _reportResult(solved) {
    const settings = PuzzleSettings.get();
    if (!settings.collectPoints) return;
    if (!Account.isLoggedIn()) {
      // Local-only XP for guests
      this.xp = Math.max(0, this.xp + (solved ? 10 : -5));
      return;
    }
    try {
      const resp = await fetch('/api/ojjychess/puzzles/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
        body: JSON.stringify({ solved }),
      });
      if (resp.ok) {
        const data = await resp.json();
        this.xp = data.xp;
        this.streak = data.streak;
        this.renderUI();
      }
    } catch {}
  },

  nextPuzzle() {
    this.loadPuzzle(this.puzzleIndex + 1);
  },

  retryPuzzle() {
    this.loadPuzzle(this.puzzleIndex);
  },

  _startTimer() {
    this._stopTimer();
    this.timer = 0;
    this.timerInterval = setInterval(() => {
      this.timer++;
      const el = document.getElementById('puzzle-timer');
      if (el) el.textContent = this._fmtTime(this.timer);
    }, 1000);
  },

  _stopTimer() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  },

  _fmtTime(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  },

  // ---- Leaderboard ----
  async loadLeaderboard() {
    try {
      const resp = await fetch('/api/ojjychess/puzzles/leaderboard');
      if (resp.ok) this.leaderboardData = await resp.json();
    } catch {}
    this.renderLeaderboard();
  },

  renderLeaderboard() {
    const container = document.getElementById('puzzle-leaderboard-body');
    if (!container) return;
    const myName = (Account.user ? Account.user.username : '').toLowerCase();
    if (!this.leaderboardData.length) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#8b8987">No data yet</div>';
      return;
    }
    container.innerHTML = this.leaderboardData.map((u, i) => {
      const rank = getRank(u.xp);
      const isMe = u.username.toLowerCase() === myName;
      return `<div class="lb-row${isMe ? ' lb-me' : ''}">
        <span class="lb-pos">${i + 1}</span>
        <span class="lb-name">${u.username}</span>
        <span class="lb-rank" style="color:${rank.color}">${rank.name}</span>
        <span class="lb-xp">${u.xp} XP</span>
      </div>`;
    }).join('');
  },

  setTab(tab) {
    this.activeTab = tab;
    document.getElementById('puzzle-tab-puzzle').classList.toggle('active', tab === 'puzzle');
    document.getElementById('puzzle-tab-lb').classList.toggle('active', tab === 'leaderboard');
    document.getElementById('puzzle-main-content').style.display = tab === 'puzzle' ? 'flex' : 'none';
    document.getElementById('puzzle-leaderboard-panel').style.display = tab === 'leaderboard' ? 'flex' : 'none';
    if (tab === 'leaderboard') this.loadLeaderboard();
  },

  // ---- Settings Modal ----
  openSettings() {
    document.getElementById('puzzle-settings-overlay').style.display = 'flex';
    this._renderSettingsModal();
  },

  closeSettings() {
    document.getElementById('puzzle-settings-overlay').style.display = 'none';
  },

  _renderSettingsModal() {
    const s = PuzzleSettings.get();
    const body = document.getElementById('puzzle-settings-body');
    body.innerHTML = `
      <div class="ps-row">
        <span class="ps-label">Difficulty</span>
        <select class="ps-select" onchange="PuzzleSettings.update('difficulty',this.value);Puzzles._renderSettingsModal()">
          ${['standard','easy','medium','hard'].map(d =>
            `<option value="${d}"${s.difficulty === d ? ' selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="ps-desc">All difficulty options are personalized to your skill level.</div>
      ${this._toggleRow('collectPoints', 'Collect Puzzle Points', 'Level up with points for each puzzle you solve!', s)}
      ${this._toggleRow('alwaysShowRating', 'Always Show Rating', 'Keep your rating in view as you earn Puzzle Points.', s)}
      ${this._toggleRow('showGoals', 'Show Puzzle Goals', 'Coach will advise you on the main goal of each Puzzle.', s)}
      ${this._toggleRow('showMistakeFeedback', 'Show Mistake Feedback', 'Coach will help explain your mistakes.', s)}
      ${this._toggleRow('showChatHints', 'Show Chat Hints', 'Get advice from Coach when you ask for a hint.', s)}
      ${this._toggleRow('showTimer', 'Show Timer', 'Display a timer while solving puzzles.', s)}
    `;
  },

  _toggleRow(key, title, desc, settings) {
    const checked = settings[key] ? 'checked' : '';
    return `<div class="ps-toggle-row">
      <div class="ps-toggle-info">
        <span class="ps-toggle-title">${title}</span>
        <span class="ps-toggle-desc">${desc}</span>
      </div>
      <label class="ps-switch">
        <input type="checkbox" ${checked} onchange="PuzzleSettings.update('${key}',this.checked);Puzzles.renderUI()">
        <span class="ps-slider"></span>
      </label>
    </div>`;
  },

  // ---- Main UI ----
  renderUI() {
    const settings = PuzzleSettings.get();
    const puzzle = this.currentPuzzle;
    if (!puzzle) return;

    const rank = getRank(this.xp);
    const next = getNextRank(this.xp);
    const progress = next ? Math.round(((this.xp - rank.xp) / (next.xp - rank.xp)) * 100) : 100;

    // XP bar
    const xpEl = document.getElementById('puzzle-xp-bar');
    if (xpEl) {
      xpEl.innerHTML = `
        <div class="pxp-rank" style="color:${rank.color}">${rank.name}</div>
        <div class="pxp-bar"><div class="pxp-fill" style="width:${progress}%;background:${rank.color}"></div></div>
        <div class="pxp-text">${this.xp} XP${next ? ` / ${next.xp} XP` : ''}</div>
      `;
    }

    // Rating
    const ratingEl = document.getElementById('puzzle-rating');
    if (ratingEl) {
      ratingEl.style.display = settings.alwaysShowRating ? 'block' : 'none';
      ratingEl.textContent = 'Rating: ' + (puzzle.rating || '?');
    }

    // Goal
    const goalEl = document.getElementById('puzzle-goal');
    if (goalEl) {
      goalEl.style.display = settings.showGoals ? 'block' : 'none';
      goalEl.textContent = puzzle.goal || '';
    }

    // Theme
    const themeEl = document.getElementById('puzzle-theme');
    if (themeEl) themeEl.textContent = puzzle.theme || '';

    // Streak
    const streakEl = document.getElementById('puzzle-streak');
    if (streakEl) streakEl.textContent = this.streak;

    // Timer
    const timerWrap = document.getElementById('puzzle-timer-wrap');
    if (timerWrap) timerWrap.style.display = settings.showTimer ? 'flex' : 'none';

    // Puzzle number
    const numEl = document.getElementById('puzzle-number');
    if (numEl) numEl.textContent = `Puzzle ${this.puzzleIndex + 1} of ${PUZZLE_DATA.length}`;

    // Status / feedback
    const statusEl = document.getElementById('puzzle-status');
    if (statusEl) {
      if (this.solved) {
        statusEl.innerHTML = '<span class="ps-success">Puzzle Solved!</span>';
      } else if (this.failed) {
        const fb = settings.showMistakeFeedback
          ? '<span class="ps-fail">Incorrect. The correct move was highlighted.</span>'
          : '<span class="ps-fail">Incorrect.</span>';
        statusEl.innerHTML = fb;
        // Show correct move highlight
        if (this.currentPuzzle.solution[this.solutionIndex]) {
          const m = this.currentPuzzle.solution[this.solutionIndex];
          Board.showHint(m.slice(0, 2), m.slice(2, 4));
        }
      } else {
        const turnLabel = this.chess.turn() === 'w' ? 'White' : 'Black';
        statusEl.innerHTML = `<span class="ps-turn">${turnLabel} to move</span>`;
      }
    }

    // Chat hint area
    const hintEl = document.getElementById('puzzle-hint-area');
    if (hintEl) {
      hintEl.style.display = settings.showChatHints ? 'flex' : 'none';
    }

    // Controls
    const ctrlEl = document.getElementById('puzzle-controls');
    if (ctrlEl) {
      let html = '';
      if (this.solved) {
        html = '<button class="pz-btn pz-btn-next" onclick="Puzzles.nextPuzzle()">Next Puzzle</button>';
      } else if (this.failed) {
        html = '<button class="pz-btn pz-btn-retry" onclick="Puzzles.retryPuzzle()">Retry</button>';
        html += '<button class="pz-btn pz-btn-next" onclick="Puzzles.nextPuzzle()">Next Puzzle</button>';
      }
      ctrlEl.innerHTML = html;
    }
  },
};
