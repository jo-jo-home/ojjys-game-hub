// Board rendering, drag-drop, move highlighting
const Board = {
  el: null,
  flipped: false,
  selectedSquare: null,
  legalMoves: [],
  lastMove: null,
  dragPiece: null,
  dragGhost: null,
  playerColor: 'w',
  onMoveAttempt: null, // callback(from, to)
  onPromotionNeeded: null, // callback(from, to, resolve)

  init(containerId) {
    this.el = document.getElementById(containerId);
    this.el.innerHTML = '';
    this.el.classList.add('board');
    this._createSquares();
    this._setupDragDrop();
    return this;
  },

  _createSquares() {
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = document.createElement('div');
        const rank = this.flipped ? r + 1 : 8 - r;
        const file = this.flipped ? 7 - f : f;
        const isLight = (rank + file) % 2 === 0;
        const sqName = String.fromCharCode(97 + file) + rank;

        sq.className = `square ${isLight ? 'light' : 'dark'}`;
        sq.dataset.square = sqName;

        // Coordinate labels
        if (f === 7 || (this.flipped && f === 0)) {
          const coordRank = document.createElement('span');
          coordRank.className = 'coord-file';
          coordRank.textContent = rank;
          if (this.flipped ? f === 0 : f === 7) sq.appendChild(coordRank);
        }
        if (r === 7 || (this.flipped && r === 0)) {
          const coordFile = document.createElement('span');
          coordFile.className = 'coord-file';
          coordFile.textContent = String.fromCharCode(97 + file);
          if (this.flipped ? r === 0 : r === 7) sq.appendChild(coordFile);
        }
        // Rank label on left column
        if ((this.flipped ? f === 7 : f === 0)) {
          const coordRank = document.createElement('span');
          coordRank.className = 'coord-rank';
          coordRank.textContent = rank;
          sq.appendChild(coordRank);
        }

        this.el.appendChild(sq);
      }
    }
  },

  _getSquareEl(sqName) {
    return this.el.querySelector(`[data-square="${sqName}"]`);
  },

  _setupDragDrop() {
    let startSq = null;

    this.el.addEventListener('pointerdown', (e) => {
      const sq = e.target.closest('.square');
      if (!sq) return;
      const sqName = sq.dataset.square;

      // If we already selected a square and click a legal move target
      if (this.selectedSquare && this.legalMoves.some(m => m.to === sqName)) {
        this._attemptMove(this.selectedSquare, sqName);
        return;
      }

      // Check if there's a piece here that belongs to the current player
      const pieceEl = sq.querySelector('.piece');
      if (!pieceEl) {
        this.clearSelection();
        return;
      }

      const pieceColor = pieceEl.dataset.color;
      if (pieceColor !== this.playerColor) {
        this.clearSelection();
        return;
      }

      // Select this square
      startSq = sqName;
      this.selectSquare(sqName);

      // Start drag
      this.dragPiece = pieceEl;
      pieceEl.classList.add('dragging');

      // Create ghost
      this.dragGhost = document.createElement('img');
      this.dragGhost.src = pieceEl.src;
      this.dragGhost.className = 'drag-ghost';
      document.body.appendChild(this.dragGhost);
      this._moveDragGhost(e.clientX, e.clientY);

      e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
      if (!this.dragGhost) return;
      this._moveDragGhost(e.clientX, e.clientY);
    });

    document.addEventListener('pointerup', (e) => {
      if (!this.dragGhost) return;

      // Find which square we dropped on
      this.dragGhost.style.display = 'none';
      const dropEl = document.elementFromPoint(e.clientX, e.clientY);
      this.dragGhost.style.display = '';

      const sq = dropEl ? dropEl.closest('.square') : null;

      // Clean up drag
      if (this.dragPiece) this.dragPiece.classList.remove('dragging');
      this.dragGhost.remove();
      this.dragGhost = null;
      this.dragPiece = null;

      if (sq && startSq) {
        const targetSq = sq.dataset.square;
        if (targetSq !== startSq && this.legalMoves.some(m => m.to === targetSq)) {
          this._attemptMove(startSq, targetSq);
        }
      }
      startSq = null;
    });
  },

  _moveDragGhost(x, y) {
    if (!this.dragGhost) return;
    this.dragGhost.style.left = x + 'px';
    this.dragGhost.style.top = y + 'px';
  },

  async _attemptMove(from, to) {
    // Check if this is a pawn promotion
    const moves = this.legalMoves.filter(m => m.from === from && m.to === to);
    if (moves.length > 0 && moves[0].promotion) {
      // Need to ask user for promotion piece
      const piece = await this._showPromotionDialog(from, to);
      if (piece && this.onMoveAttempt) this.onMoveAttempt(from, to, piece);
    } else {
      if (this.onMoveAttempt) this.onMoveAttempt(from, to);
    }
    this.clearSelection();
  },

  _showPromotionDialog(from, to) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('promo-overlay');
      const box = overlay.querySelector('.promo-box');
      const color = this.playerColor;
      const pieces = ['q', 'r', 'b', 'n'];

      box.innerHTML = '';
      pieces.forEach(p => {
        const img = document.createElement('img');
        img.src = (typeof Settings !== 'undefined') ? Settings.getPiecePath(color, p) : `assets/pieces/neo/${color === 'w' ? 'w' : 'b'}${p.toUpperCase()}.png`;
        img.addEventListener('click', () => {
          overlay.classList.remove('active');
          resolve(p);
        });
        box.appendChild(img);
      });

      overlay.classList.add('active');
    });
  },

  selectSquare(sqName) {
    this.clearSelection();
    this.selectedSquare = sqName;
    const el = this._getSquareEl(sqName);
    if (el) el.classList.add('selected');

    // Show legal moves
    if (typeof ChessGame !== 'undefined') {
      this.legalMoves = ChessGame.getLegalMoves(sqName);
      this.legalMoves.forEach(m => {
        const targetEl = this._getSquareEl(m.to);
        if (!targetEl) return;
        if (m.captured) {
          const ring = document.createElement('div');
          ring.className = 'capture-ring';
          targetEl.appendChild(ring);
        } else {
          const dot = document.createElement('div');
          dot.className = 'move-dot';
          targetEl.appendChild(dot);
        }
      });
    }
  },

  clearSelection() {
    this.selectedSquare = null;
    this.legalMoves = [];
    this.el.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    this.el.querySelectorAll('.move-dot, .capture-ring').forEach(el => el.remove());
  },

  setLastMove(from, to) {
    // Clear old highlights
    this.el.querySelectorAll('.last-move-light, .last-move-dark').forEach(el => {
      el.classList.remove('last-move-light', 'last-move-dark');
    });

    this.lastMove = { from, to };
    [from, to].forEach(sq => {
      const el = this._getSquareEl(sq);
      if (!el) return;
      if (el.classList.contains('light')) {
        el.classList.add('last-move-light');
      } else {
        el.classList.add('last-move-dark');
      }
    });
  },

  setCheck(sqName) {
    this.el.querySelectorAll('.check').forEach(el => el.classList.remove('check'));
    if (sqName) {
      const el = this._getSquareEl(sqName);
      if (el) el.classList.add('check');
    }
  },

  render(boardState) {
    // Clear all pieces
    this.el.querySelectorAll('.piece').forEach(el => el.remove());

    // Place pieces from board state
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = boardState[r][f];
        if (!piece) continue;

        const rank = 8 - r;
        const file = String.fromCharCode(97 + f);
        const sqName = file + rank;
        const sqEl = this._getSquareEl(sqName);
        if (!sqEl) continue;

        const img = document.createElement('img');
        img.className = 'piece';
        img.dataset.color = piece.color;
        img.src = (typeof Settings !== 'undefined') ? Settings.getPiecePath(piece.color, piece.type) : `assets/pieces/neo/${piece.color}${piece.type.toUpperCase()}.png`;
        img.draggable = false;
        sqEl.appendChild(img);
      }
    }
  },

  flip() {
    this.flipped = !this.flipped;
    this.el.innerHTML = '';
    this._createSquares();
    // Re-render will be called by app
  },

  showHint(from, to) {
    this.clearHint();
    [from, to].forEach(sq => {
      const el = this._getSquareEl(sq);
      if (el) el.classList.add('hint-highlight');
    });
  },

  clearHint() {
    if (!this.el) return;
    this.el.querySelectorAll('.hint-highlight').forEach(el => el.classList.remove('hint-highlight'));
  },

  findKing(color, boardState) {
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = boardState[r][f];
        if (p && p.type === 'k' && p.color === color) {
          return String.fromCharCode(97 + f) + (8 - r);
        }
      }
    }
    return null;
  }
};
