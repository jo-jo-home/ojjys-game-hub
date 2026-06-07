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
  getLegalMovesFor: null, // callback(square) → move[] — set per mode
  _listenersAttached: false,

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
    this._startSq = null;

    // Remove old board listener when switching containers
    if (this._boardDown && this._prevEl) {
      this._prevEl.removeEventListener('pointerdown', this._boardDown);
    }

    this._boardDown = (e) => {
      const sq = e.target.closest('.square');
      if (!sq) return;
      const sqName = sq.dataset.square;

      if (this.selectedSquare && this.legalMoves.some(m => m.to === sqName)) {
        this._attemptMove(this.selectedSquare, sqName);
        return;
      }

      const pieceEl = sq.querySelector('.piece');
      if (!pieceEl) { this.clearSelection(); return; }
      if (pieceEl.dataset.color !== this.playerColor) { this.clearSelection(); return; }

      this._startSq = sqName;
      this.selectSquare(sqName);

      this.dragPiece = pieceEl;
      pieceEl.classList.add('dragging');

      this.dragGhost = document.createElement('img');
      this.dragGhost.src = pieceEl.src;
      this.dragGhost.className = 'drag-ghost';
      document.body.appendChild(this.dragGhost);
      this._moveDragGhost(e.clientX, e.clientY);
      e.preventDefault();
    };
    this.el.addEventListener('pointerdown', this._boardDown);
    this._prevEl = this.el;

    // Document-level listeners only once
    if (this._listenersAttached) return;
    this._listenersAttached = true;

    document.addEventListener('pointermove', (e) => {
      if (!this.dragGhost) return;
      this._moveDragGhost(e.clientX, e.clientY);
    });

    document.addEventListener('pointerup', (e) => {
      if (!this.dragGhost) return;

      this.dragGhost.style.display = 'none';
      const dropEl = document.elementFromPoint(e.clientX, e.clientY);
      this.dragGhost.style.display = '';

      const sq = dropEl ? dropEl.closest('.square') : null;

      if (this.dragPiece) this.dragPiece.classList.remove('dragging');
      this.dragGhost.remove();
      this.dragGhost = null;
      this.dragPiece = null;

      if (sq && this._startSq) {
        const targetSq = sq.dataset.square;
        if (targetSq !== this._startSq && this.legalMoves.some(m => m.to === targetSq)) {
          this._attemptMove(this._startSq, targetSq);
        }
      }
      this._startSq = null;
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

    // Show legal moves via mode-specific callback
    const getMoves = this.getLegalMovesFor || (typeof ChessGame !== 'undefined' ? (sq) => ChessGame.getLegalMoves(sq) : null);
    if (getMoves) {
      this.legalMoves = getMoves(sqName);
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

  // FLIP animation: after render, slide piece from old square to new
  animateMove(from, to) {
    const fromEl = this._getSquareEl(from);
    const toEl = this._getSquareEl(to);
    if (!fromEl || !toEl) return;
    const piece = toEl.querySelector('.piece');
    if (!piece) return;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;

    piece.style.transition = 'none';
    piece.style.transform = `translate(${dx}px, ${dy}px)`;
    piece.style.zIndex = '20';
    piece.offsetHeight; // force reflow
    piece.style.transition = 'transform 0.15s ease';
    piece.style.transform = '';
    piece.addEventListener('transitionend', () => {
      piece.style.transition = '';
      piece.style.zIndex = '';
    }, { once: true });
  },

  setResultIcons(winnerSq, loserSq) {
    this.clearResultIcons();
    if (winnerSq) {
      const el = this._getSquareEl(winnerSq);
      if (el) {
        const icon = document.createElement('div');
        icon.className = 'result-icon winner';
        icon.innerHTML = '<svg viewBox="0 0 36 36" width="28" height="28"><circle cx="18" cy="18" r="16" fill="#81b64c"/><path d="M18 8l3 6 3-3v10H12V11l3 3z" fill="white"/></svg>';
        el.appendChild(icon);
      }
    }
    if (loserSq) {
      const el = this._getSquareEl(loserSq);
      if (el) {
        const icon = document.createElement('div');
        icon.className = 'result-icon loser';
        icon.innerHTML = '<svg viewBox="0 0 36 36" width="28" height="28"><circle cx="18" cy="18" r="16" fill="#e04040"/><path d="M13 13l10 10M23 13l-10 10" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>';
        el.appendChild(icon);
      }
    }
  },

  clearResultIcons() {
    if (!this.el) return;
    this.el.querySelectorAll('.result-icon').forEach(el => el.remove());
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
