// Settings manager for ojjyChess
const Settings = {
  defaults: {
    boardTheme: 'green',
    pieceSet: 'neo',
    showCoords: true,
    highlightMoves: true,
  },

  boardThemes: {
    green:  { name: 'Green',  light: '#ebecd0', dark: '#779556' },
    wood:   { name: 'Wood',   light: '#e8c98e', dark: '#b48764' },
    brown:  { name: 'Brown',  light: '#f0d9b5', dark: '#b58863' },
    blue:   { name: 'Blue',   light: '#dee3e6', dark: '#8ca2ad' },
    purple: { name: 'Purple', light: '#e8daf0', dark: '#9b72b0' },
    grey:   { name: 'Grey',   light: '#cccccc', dark: '#888888' },
  },

  pieceSets: {
    neo:     { name: 'Neo' },
    classic: { name: 'Classic' },
    wood:    { name: 'Wood' },
    glass:   { name: 'Glass' },
  },

  current: null,

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('ojjychess_settings') || '{}');
      this.current = Object.assign({}, this.defaults, saved);
    } catch {
      this.current = Object.assign({}, this.defaults);
    }
    this.apply();
  },

  save() {
    localStorage.setItem('ojjychess_settings', JSON.stringify(this.current));
    this.apply();
  },

  apply() {
    const theme = this.boardThemes[this.current.boardTheme] || this.boardThemes.green;
    document.documentElement.style.setProperty('--sq-light', theme.light);
    document.documentElement.style.setProperty('--sq-dark', theme.dark);

    // Update piece images if board is rendered
    this._updatePieceImages();

    // Coordinates
    document.querySelectorAll('.coord-file, .coord-rank').forEach(el => {
      el.style.display = this.current.showCoords ? '' : 'none';
    });

    // Highlight moves
    if (!this.current.highlightMoves) {
      document.querySelectorAll('.last-move-light, .last-move-dark').forEach(el => {
        el.classList.remove('last-move-light', 'last-move-dark');
      });
    }
  },

  _updatePieceImages() {
    const set = this.current.pieceSet || 'neo';
    document.querySelectorAll('.piece').forEach(img => {
      const old = img.src;
      // Extract piece filename like wK.png
      const match = old.match(/([wb][KQRBNP])\.png/);
      if (match) {
        img.src = `assets/pieces/${set}/${match[1]}.png`;
      }
    });
    // Also update drag ghost if present
    const ghost = document.querySelector('.drag-ghost');
    if (ghost) {
      const match = ghost.src.match(/([wb][KQRBNP])\.png/);
      if (match) ghost.src = `assets/pieces/${set}/${match[1]}.png`;
    }
  },

  getPiecePath(color, type) {
    return `assets/pieces/${this.current.pieceSet || 'neo'}/${color}${type.toUpperCase()}.png`;
  },

  // --- Settings UI ---
  open() {
    const overlay = document.getElementById('settings-overlay');
    overlay.classList.add('active');
    this._renderBoards();
    this._renderPieces();
    this._renderToggles();
  },

  close() {
    document.getElementById('settings-overlay').classList.remove('active');
  },

  _renderBoards() {
    const container = document.getElementById('settings-boards');
    let html = '';
    for (const [id, theme] of Object.entries(this.boardThemes)) {
      const sel = id === this.current.boardTheme ? ' selected' : '';
      html += `<div class="theme-card${sel}" onclick="Settings.selectBoard('${id}')">
        <div class="theme-preview">
          <div class="tp-sq" style="background:${theme.light}"></div>
          <div class="tp-sq" style="background:${theme.dark}"></div>
          <div class="tp-sq" style="background:${theme.dark}"></div>
          <div class="tp-sq" style="background:${theme.light}"></div>
        </div>
        <span class="theme-name">${theme.name}</span>
      </div>`;
    }
    container.innerHTML = html;
  },

  _renderPieces() {
    const container = document.getElementById('settings-pieces');
    let html = '';
    for (const [id, set] of Object.entries(this.pieceSets)) {
      const sel = id === this.current.pieceSet ? ' selected' : '';
      html += `<div class="theme-card${sel}" onclick="Settings.selectPieces('${id}')">
        <div class="piece-preview">
          <img src="assets/pieces/${id}/wN.png" alt=""><img src="assets/pieces/${id}/bQ.png" alt="">
          <img src="assets/pieces/${id}/wP.png" alt=""><img src="assets/pieces/${id}/bP.png" alt="">
        </div>
        <span class="theme-name">${set.name}</span>
      </div>`;
    }
    container.innerHTML = html;
  },

  _renderToggles() {
    document.getElementById('toggle-coords').checked = this.current.showCoords;
    document.getElementById('toggle-highlight').checked = this.current.highlightMoves;
  },

  selectBoard(id) {
    this.current.boardTheme = id;
    this.save();
    this._renderBoards();
  },

  selectPieces(id) {
    this.current.pieceSet = id;
    this.save();
    this._renderPieces();
    // Re-render board pieces
    if (typeof ChessGame !== 'undefined' && ChessGame.engine) {
      Board.render(ChessGame.board());
    }
  },

  toggleCoords(val) {
    this.current.showCoords = val;
    this.save();
  },

  toggleHighlight(val) {
    this.current.highlightMoves = val;
    this.save();
  },
};
