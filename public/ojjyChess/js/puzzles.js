// Puzzle data sorted by ascending difficulty (rating)
const PUZZLE_DATA = [
  // === BEGINNER (200-400) ===
  {
    id: 'p1', fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2',
    solution: ['d8h4'], playerColor: 'b',
    theme: 'Checkmate', rating: 200, goal: 'Checkmate in one move'
  },
  {
    id: 'p2', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    solution: ['h5f7'], playerColor: 'w',
    theme: 'Scholar\'s Mate', rating: 250, goal: 'Checkmate in one move'
  },
  {
    id: 'p3', fen: '6k1/5ppp/8/8/8/8/r4PPP/1R4K1 w - - 0 1',
    solution: ['b1b8'], playerColor: 'w',
    theme: 'Back Rank Mate', rating: 300, goal: 'Checkmate in one move'
  },
  {
    id: 'p4', fen: '5rk1/ppp2ppp/3b4/8/8/8/PPP2PPP/4R1K1 w - - 0 1',
    solution: ['e1e8'], playerColor: 'w',
    theme: 'Back Rank Mate', rating: 350, goal: 'Checkmate in one move'
  },
  {
    id: 'p5', fen: 'k7/8/1K6/8/8/8/8/1R6 w - - 0 1',
    solution: ['b1a1'], playerColor: 'w',
    theme: 'Checkmate', rating: 200, goal: 'Checkmate in one move'
  },
  // === EASY (400-600) ===
  {
    id: 'p6', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3 0 3',
    solution: ['e5d4'], playerColor: 'b',
    theme: 'Opening', rating: 400, goal: 'Capture the center pawn'
  },
  {
    id: 'p7', fen: 'rnb1kbnr/ppppqppp/8/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3',
    solution: ['f3e5'], playerColor: 'w',
    theme: 'Hanging Piece', rating: 450, goal: 'Capture the undefended pawn'
  },
  {
    id: 'p8', fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4',
    solution: ['f6e4'], playerColor: 'b',
    theme: 'Tactics', rating: 500, goal: 'Win material with a central grab'
  },
  {
    id: 'p9', fen: 'r2qk2r/ppp2ppp/2n2n2/2bppb2/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w kq - 0 6',
    solution: ['e4d5'], playerColor: 'w',
    theme: 'Opening', rating: 450, goal: 'Win the center pawn'
  },
  {
    id: 'p10', fen: 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    solution: ['f3e5'], playerColor: 'w',
    theme: 'Tactics', rating: 500, goal: 'Exploit the undefended pawn'
  },
  {
    id: 'p11', fen: '2r3k1/pp3ppp/8/3q4/8/1P4P1/PB3P1P/3QR1K1 w - - 0 1',
    solution: ['e1e8'], playerColor: 'w',
    theme: 'Back Rank Mate', rating: 550, goal: 'Deliver checkmate'
  },
  // === INTERMEDIATE (600-800) — mix of 1-move and 2-move ===
  {
    id: 'p12', fen: 'r4rk1/ppp2ppp/2n5/3N4/2BP4/8/PPP2PPP/R3K2R w KQ - 0 1',
    solution: ['d5f6'], playerColor: 'w',
    theme: 'Fork', rating: 600, goal: 'Fork the king and rook'
  },
  {
    id: 'p13', fen: 'r2qk2r/ppp2ppp/2n1bn2/3pp3/4P1b1/3P1N2/PPP1BPPP/RNBQ1RK1 w kq - 0 7',
    solution: ['e2b5'], playerColor: 'w',
    theme: 'Pin', rating: 650, goal: 'Pin the knight to the king'
  },
  {
    id: 'p14', fen: 'r1b1k2r/ppppqppp/2n2n2/2b5/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
    solution: ['e4e5', 'f6d5', 'c3d5'], playerColor: 'w',
    theme: 'Tactics', rating: 700, goal: 'Attack the knight and win material'
  },
  {
    id: 'p15', fen: 'r2q1rk1/pp2ppbp/2np1np1/8/2PNP1b1/2N1BP2/PP2B1PP/R2Q1RK1 w - - 0 10',
    solution: ['f3g4', 'f6g4', 'e3g5'], playerColor: 'w',
    theme: 'Capture + Attack', rating: 700, goal: 'Win the bishop and attack with tempo'
  },
  {
    id: 'p16', fen: 'rnb1k2r/pppp1ppp/5n2/2b1p1q1/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 6 5',
    solution: ['f3e5', 'g5c1', 'd1f3'], playerColor: 'w',
    theme: 'Tactics', rating: 750, goal: 'Sacrifice the knight and win it back with interest'
  },
  {
    id: 'p17', fen: 'r2qkb1r/ppp1pppp/2n2n2/3pN3/3P1Bb1/8/PPP1PPPP/RN1QKB1R b KQkq - 3 4',
    solution: ['g4d1'], playerColor: 'b',
    theme: 'Hanging Piece', rating: 750, goal: 'Win the undefended queen'
  },
  {
    id: 'p18', fen: 'r1bq1rk1/ppp2ppp/2n2n2/3p4/1b1NP3/2N5/PPP1BPPP/R1BQ1RK1 w - - 0 7',
    solution: ['e4d5', 'f6d5', 'c3d5'], playerColor: 'w',
    theme: 'Opening', rating: 650, goal: 'Win the center pawn and recapture'
  },
  // === ADVANCED (800-1000) — mostly multi-move ===
  {
    id: 'p19', fen: 'r2q1rk1/ppp1bppp/2n5/3pN3/3Pn3/3B4/PPP2PPP/R1BQ1RK1 w - - 0 10',
    solution: ['e5f7', 'f8f7', 'd3h7'], playerColor: 'w',
    theme: 'Fork + Attack', rating: 800, goal: 'Fork the rook, then attack the king'
  },
  {
    id: 'p20', fen: '3rr1k1/ppp2ppp/8/3Q4/8/8/PPP2PPP/4RRK1 w - - 0 1',
    solution: ['d5g8', 'e8g8', 'e1e8'], playerColor: 'w',
    theme: 'Sacrifice', rating: 850, goal: 'Sacrifice your queen for a back rank checkmate'
  },
  {
    id: 'p21', fen: 'r1b1kb1r/ppppqppp/2n5/1B2p3/4n3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 5',
    solution: ['b5c6', 'd7c6', 'f3e5'], playerColor: 'w',
    theme: 'Pin + Fork', rating: 900, goal: 'Pin, then exploit the weakened position'
  },
  {
    id: 'p22', fen: '2kr3r/ppp2ppp/2n5/3q4/3P4/2P1BN2/P4PPP/R2Q1RK1 b - - 0 12',
    solution: ['d5f3', 'g2f3', 'h8h2'], playerColor: 'b',
    theme: 'Sacrifice + Attack', rating: 900, goal: 'Sacrifice the queen to crash through on the h-file'
  },
  {
    id: 'p23', fen: 'r1bqr1k1/pppp1ppp/2n2n2/2b5/2B1P3/3P1N2/PPP2PPP/RNBQR1K1 b - - 0 7',
    solution: ['f6g4', 'h2h3', 'g4f2'], playerColor: 'b',
    theme: 'Attack', rating: 950, goal: 'Target the weak f2 square with a knight maneuver'
  },
  {
    id: 'p24', fen: 'r3k2r/ppp2ppp/2n1bn2/3qp3/8/2NP1N2/PPP1BPPP/R2Q1RK1 b kq - 0 8',
    solution: ['d5d3', 'e2d3', 'e6d5'], playerColor: 'b',
    theme: 'Exchange + Centralization', rating: 950, goal: 'Trade queens and centralize the bishop'
  },
  // === EXPERT (1000-1200) — all multi-move ===
  {
    id: 'p25', fen: 'r1bqk2r/2ppbppp/p1n2n2/1p2p3/4P3/1B3N2/PPPP1PPP/RNBQR1K1 w kq - 0 7',
    solution: ['f3e5', 'c6e5', 'e1e5'], playerColor: 'w',
    theme: 'Sacrifice + Recapture', rating: 1000, goal: 'Sacrifice the knight to win back with the rook'
  },
  {
    id: 'p26', fen: 'r4rk1/1bq1bppp/p2ppn2/1p6/3NP3/1BN1BP2/PPPQ2PP/2KR3R w - - 0 13',
    solution: ['d4e6', 'f7e6', 'b3e6'], playerColor: 'w',
    theme: 'Sacrifice + Fork', rating: 1050, goal: 'Sacrifice the knight then recapture with the bishop forking'
  },
  {
    id: 'p27', fen: 'r1b2rk1/ppq2ppp/2n1pn2/2pp4/1b1P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 8',
    solution: ['d4c5', 'b4c5', 'e3d4'], playerColor: 'w',
    theme: 'Pawn Play', rating: 1100, goal: 'Win the pawn and gain the bishop pair'
  },
  {
    id: 'p28', fen: 'r3kb1r/1bqn1ppp/p2ppn2/1p6/3NP3/1BN1BP2/PPPQ2PP/R3K2R w KQkq - 0 10',
    solution: ['d4c6', 'b7c6', 'e4e5'], playerColor: 'w',
    theme: 'Sacrifice + Breakthrough', rating: 1100, goal: 'Sacrifice the knight to shatter the structure then advance'
  },
  {
    id: 'p29', fen: 'r2qr1k1/pp1b1ppp/2n1pn2/2pp4/1bPP4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 8',
    solution: ['c4d5', 'e6d5', 'e3f4'], playerColor: 'w',
    theme: 'Opening + Development', rating: 1150, goal: 'Open the center and activate the bishop'
  },
  {
    id: 'p30', fen: '2r2rk1/pp1qnppp/2n1p3/3pP3/3P4/1PN2N2/P3QPPP/R1B2RK1 w - - 0 14',
    solution: ['f3d2', 'd7c7', 'd2b3'], playerColor: 'w',
    theme: 'Maneuver', rating: 1050, goal: 'Reposition the knight to a stronger outpost'
  },
  // === MASTER (1200-1500) — all multi-move ===
  {
    id: 'p31', fen: '2r1r1k1/pb1n1pp1/1p2pn1p/q1pp4/2PP4/PP1BPN2/1BQN1PPP/R4RK1 w - - 0 16',
    solution: ['c4d5', 'e6d5', 'e3e4'], playerColor: 'w',
    theme: 'Pawn Break', rating: 1200, goal: 'Break through in the center with two pawn moves'
  },
  {
    id: 'p32', fen: 'r1b2rk1/pp3ppp/1qnppn2/8/2PNP3/2N1BP2/PP4PP/R2Q1RK1 w - - 0 10',
    solution: ['d4c6', 'b6c6', 'c3d5'], playerColor: 'w',
    theme: 'Exchange + Outpost', rating: 1250, goal: 'Trade and plant a knight on the dominant square'
  },
  {
    id: 'p33', fen: '2rq1rk1/pp1bppbp/2np1np1/8/2PNP3/2N1BP2/PP2B1PP/R2Q1RK1 w - - 0 10',
    solution: ['e4e5', 'd6e5', 'd4f5'], playerColor: 'w',
    theme: 'Space + Sacrifice', rating: 1300, goal: 'Gain space then jump to an outpost'
  },
  {
    id: 'p34', fen: 'r2q1rk1/1pp2ppp/p1np4/4p1b1/2P1Pn2/2NP2P1/PP3PBP/R1BQ1RK1 w - - 0 11',
    solution: ['g3f4', 'g5f4', 'c1f4', 'e5f4', 'd1g4'], playerColor: 'w',
    theme: 'Capture Chain', rating: 1350, goal: 'Win the knight and open lines to the king'
  },
  {
    id: 'p35', fen: 'r4rk1/1ppq1ppp/p1n1pn2/3p4/1b1P4/2NBPN2/PP1B1PPP/R2Q1RK1 w - - 0 9',
    solution: ['e3e4', 'd5e4', 'd3e4', 'f6e4', 'c3e4'], playerColor: 'w',
    theme: 'Center Control', rating: 1400, goal: 'Seize the center with a pawn exchange sequence'
  },
  // === GRANDMASTER (1500+) — all multi-move ===
  {
    id: 'p36', fen: 'r2qk2r/pp1nbppp/2p1pn2/3p4/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 6',
    solution: ['c4d5', 'e6d5', 'f1d3'], playerColor: 'w',
    theme: 'Pawn Break', rating: 1500, goal: 'Create an IQP position and develop the bishop actively'
  },
  {
    id: 'p37', fen: 'r1bq1rk1/pp2npbp/2npp1p1/2p5/4PP2/2NP1N2/PPP1B1PP/R1BQ1RK1 w - - 0 8',
    solution: ['f4f5', 'g6f5', 'e4f5', 'e6f5', 'c1h6'], playerColor: 'w',
    theme: 'Kingside Attack', rating: 1600, goal: 'Launch a kingside pawn storm and trade the fianchetto bishop'
  },
  {
    id: 'p38', fen: 'r3r1k1/pp1q1ppp/2nb4/3Np3/8/1P2P3/PBQ2PPP/R3KB1R w KQ - 0 15',
    solution: ['d5f6', 'g7f6', 'b2f6', 'd7g4', 'f6h8'], playerColor: 'w',
    theme: 'Fork + Attack', rating: 1650, goal: 'Fork the king and queen then invade'
  },
  {
    id: 'p39', fen: '2r2rk1/pp1qbppp/2n1pn2/3pN3/3P1B2/2PB4/PP3PPP/R2Q1RK1 w - - 0 12',
    solution: ['e5c6', 'd7c6', 'd3h7', 'g8h7', 'd1h5'], playerColor: 'w',
    theme: 'Greek Gift', rating: 1700, goal: 'Sacrifice the bishop on h7 and launch a king hunt'
  },
  {
    id: 'p40', fen: 'r2q1rk1/pb1nbppp/1p2pn2/2p5/2PP4/2N2NP1/PPQ1PPBP/R1B2RK1 w - - 0 9',
    solution: ['d4d5', 'e6d5', 'c4d5', 'f6d5', 'c3d5'], playerColor: 'w',
    theme: 'Pawn Break + Tactics', rating: 1800, goal: 'Sacrifice pawns to open the long diagonal and win material'
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
    const rating = this.currentPuzzle ? this.currentPuzzle.rating : 500;
    if (!Account.isLoggedIn()) {
      // Local-only XP for guests (scaled by difficulty)
      const gain = solved ? Math.max(3, 20 - Math.floor(rating / 100)) : -Math.max(2, Math.floor(rating / 200));
      this.xp = Math.max(0, this.xp + gain);
      return;
    }
    try {
      const resp = await fetch('/api/ojjychess/puzzles/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
        body: JSON.stringify({ solved, rating }),
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
