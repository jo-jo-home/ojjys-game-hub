// Bot AI implementations

// --- Piece-square tables for positional evaluation ---
const PST = {
  p: [ // Pawn
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [ // Knight
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [ // Bishop
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [ // Rook
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [ // Queen
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [ // King (middlegame)
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function evaluate(chess) {
  const board = chess.board();
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const val = PIECE_VALUES[piece.type] || 0;
      // PST index: for white, use r*8+f; for black, mirror vertically
      const pstIdx = piece.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const pst = PST[piece.type] ? PST[piece.type][pstIdx] : 0;
      const total = val + pst;
      score += piece.color === 'w' ? total : -total;
    }
  }
  return score;
}

// --- Easy Bot: Random moves ---
const RandomBot = {
  getMove(chess) {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;
    return moves[Math.floor(Math.random() * moves.length)];
  }
};

// --- Medium Bot: Minimax with alpha-beta ---
const MinimaxBot = {
  maxDepth: 3,

  getMove(chess) {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;

    const isMaximizing = chess.turn() === 'w';
    let bestMove = null;
    let bestScore = isMaximizing ? -Infinity : Infinity;

    // Order moves: captures first for better pruning
    moves.sort((a, b) => {
      const aCapture = a.captured ? 1 : 0;
      const bCapture = b.captured ? 1 : 0;
      return bCapture - aCapture;
    });

    for (const move of moves) {
      chess.move(move);
      const score = this._minimax(chess, this.maxDepth - 1, -Infinity, Infinity, !isMaximizing);
      chess.undo();

      if (isMaximizing) {
        if (score > bestScore) { bestScore = score; bestMove = move; }
      } else {
        if (score < bestScore) { bestScore = score; bestMove = move; }
      }
    }
    return bestMove;
  },

  _minimax(chess, depth, alpha, beta, isMaximizing) {
    if (depth === 0 || chess.game_over()) {
      return evaluate(chess);
    }

    const moves = chess.moves({ verbose: true });
    // Move ordering
    moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of moves) {
        chess.move(move);
        const eval_ = this._minimax(chess, depth - 1, alpha, beta, false);
        chess.undo();
        maxEval = Math.max(maxEval, eval_);
        alpha = Math.max(alpha, eval_);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of moves) {
        chess.move(move);
        const eval_ = this._minimax(chess, depth - 1, alpha, beta, true);
        chess.undo();
        minEval = Math.min(minEval, eval_);
        beta = Math.min(beta, eval_);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }
};

// --- Hard Bot: Stockfish WASM via Web Worker ---
const StockfishBot = {
  worker: null,
  ready: false,
  loading: false,

  async init() {
    if (this.ready || this.loading) return;
    this.loading = true;

    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker('lib/stockfish/stockfish.js');
        this.worker.onmessage = (e) => {
          if (e.data === 'uciok' || e.data.includes('uciok')) {
            this.worker.postMessage('isready');
          }
          if (e.data === 'readyok' || e.data.includes('readyok')) {
            this.ready = true;
            this.loading = false;
            resolve();
          }
        };
        this.worker.onerror = (err) => {
          this.loading = false;
          reject(err);
        };
        this.worker.postMessage('uci');
      } catch (err) {
        this.loading = false;
        reject(err);
      }
    });
  },

  getMove(chess) {
    if (!this.ready) return Promise.resolve(MinimaxBot.getMove(chess));

    return new Promise((resolve) => {
      const fen = chess.fen();
      let bestMove = null;

      const handler = (e) => {
        const line = e.data;
        if (typeof line === 'string' && line.startsWith('bestmove')) {
          this.worker.removeEventListener('message', handler);
          const parts = line.split(' ');
          const moveStr = parts[1];
          if (moveStr && moveStr !== '(none)') {
            const from = moveStr.substring(0, 2);
            const to = moveStr.substring(2, 4);
            const promotion = moveStr.length > 4 ? moveStr[4] : undefined;
            // Validate move
            const moves = chess.moves({ verbose: true });
            bestMove = moves.find(m => m.from === from && m.to === to &&
              (!promotion || m.promotion === promotion));
          }
          resolve(bestMove || MinimaxBot.getMove(chess));
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage('position fen ' + fen);
      this.worker.postMessage('go depth 12');

      // Timeout fallback
      setTimeout(() => {
        this.worker.removeEventListener('message', handler);
        if (!bestMove) resolve(MinimaxBot.getMove(chess));
      }, 5000);
    });
  },

  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.ready = false;
    }
  }
};

// Bot factory
function createBot(difficulty) {
  switch (difficulty) {
    case 'easy': return RandomBot;
    case 'medium': return MinimaxBot;
    case 'hard': return StockfishBot;
    default: return RandomBot;
  }
}
