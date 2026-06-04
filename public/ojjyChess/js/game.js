// Game state wrapper around chess.js (v0.10.x API)
const ChessGame = {
  engine: null,
  onMoveCallback: null,
  onGameOverCallback: null,

  newGame(fen) {
    this.engine = new Chess(fen);
    return this;
  },

  makeMove(from, to, promotion) {
    const move = this.engine.move({ from, to, promotion: promotion || undefined });
    if (!move) return null;
    if (this.onMoveCallback) this.onMoveCallback(move);
    if (this.isGameOver() && this.onGameOverCallback) {
      this.onGameOverCallback(this.getResult());
    }
    return move;
  },

  getLegalMoves(square) {
    return this.engine.moves({ square, verbose: true });
  },

  getAllMoves() {
    return this.engine.moves({ verbose: true });
  },

  undo() {
    return this.engine.undo();
  },

  isGameOver() {
    return this.engine.game_over();
  },

  inCheck() {
    return this.engine.in_check();
  },

  turn() {
    return this.engine.turn();
  },

  fen() {
    return this.engine.fen();
  },

  board() {
    return this.engine.board();
  },

  history(options) {
    return this.engine.history(options);
  },

  getResult() {
    if (this.engine.in_checkmate()) {
      return { type: 'checkmate', winner: this.engine.turn() === 'w' ? 'b' : 'w' };
    }
    if (this.engine.in_stalemate()) return { type: 'stalemate', winner: null };
    if (this.engine.in_draw()) return { type: 'draw', winner: null };
    if (this.engine.in_threefold_repetition()) return { type: 'repetition', winner: null };
    if (this.engine.insufficient_material()) return { type: 'insufficient', winner: null };
    return null;
  },

  onMove(cb) { this.onMoveCallback = cb; },
  onGameOver(cb) { this.onGameOverCallback = cb; },
};
