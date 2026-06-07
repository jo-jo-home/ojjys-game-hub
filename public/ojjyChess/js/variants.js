// ---- Variants Page Module ----
const Variants = {
  activeId: '4-player',
  _category: 'most-popular',
  _searchQuery: '',
  _toastTimeout: null,

  DATA: [
    // Most Popular
    {
      id: '4-player', title: '4 Player Chess',
      desc: 'Team up or play free-for-all with up to 4 players on a special board.',
      players: '2-4', category: 'most-popular', playable: false,
      theme: 'default',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
    },
    {
      id: 'crazyhouse', title: 'Crazyhouse',
      desc: 'Captured pieces can be dropped back onto the board as your own.',
      players: '2', category: 'most-popular', playable: false,
      theme: 'crazyhouse',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"/></svg>',
    },
    {
      id: 'chess960', title: 'Chess960',
      desc: 'Fischer Random Chess. Back rank pieces are shuffled for fresh openings.',
      players: '2', category: 'most-popular', playable: false,
      theme: 'chess960',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    },
    {
      id: 'king-hill', title: 'King of the Hill',
      desc: 'Win by moving your king to one of the center four squares.',
      players: '2', category: 'most-popular', playable: false,
      theme: 'king-hill',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l8 18H4L12 2z"/><circle cx="12" cy="10" r="2"/></svg>',
    },
    // Featured
    {
      id: 'spell', title: 'Spell Chess',
      desc: 'Cast powerful spells to alter the game. Strategy meets magic.',
      players: '2', category: 'featured', playable: false,
      theme: 'spell',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.86L12 17.77 5.82 21l1.18-6.86-5-4.87 6.91-1.01L12 2z"/></svg>',
    },
    {
      id: 'fog', title: 'Fog of War',
      desc: 'You can only see squares your pieces can move to. The rest is hidden.',
      players: '2', category: 'featured', playable: false,
      theme: 'fog',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><path d="M1 1l22 22" stroke-width="2"/></svg>',
    },
    {
      id: 'duck', title: 'Duck Chess',
      desc: 'After each move, place a duck on any empty square to block it.',
      players: '2', category: 'featured', playable: false,
      theme: 'duck',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#f0c040" stroke-width="1.5"><circle cx="12" cy="10" r="6"/><path d="M8 14c0 4 2 6 4 6s4-2 4-6M7 8c-1-1-2 0-2 1M15 7a1.5 1.5 0 100-3"/></svg>',
    },
    {
      id: 'atomic', title: 'Atomic',
      desc: 'Captures cause explosions that destroy all surrounding pieces.',
      players: '2', category: 'featured', playable: false,
      theme: 'atomic',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></svg>',
    },
    // More
    {
      id: '3-check', title: '3-Check',
      desc: 'Give check three times to win. Aggressive play is rewarded.',
      players: '2', category: 'more', playable: false,
      theme: '3-check',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/><text x="17" y="20" font-size="10" fill="currentColor" font-weight="bold" stroke="none">3</text></svg>',
    },
    {
      id: 'giveaway', title: 'Giveaway',
      desc: 'Win by losing all your pieces or getting stalemated. Captures are forced.',
      players: '2', category: 'more', playable: false,
      theme: 'default',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6m8-8v8m-4-4l4 4 4-4M12 3a1 1 0 110-2 1 1 0 010 2z"/></svg>',
    },
    {
      id: 'chaturaji', title: 'Chaturaji',
      desc: 'Ancient 4-player Indian chess variant with dice and unique piece rules.',
      players: '4', category: 'more', playable: false,
      theme: 'default',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C10.5 2 9 3 9 5c0 1.5 1 2.5 1 2.5L8 10H6l-1 3h3l-1.5 7h11L16 13h3l-1-3h-2l-2-2.5S15 6.5 15 5c0-2-1.5-3-3-3z"/><path d="M7 2h2m6 0h2" stroke-width="2"/></svg>',
    },
    {
      id: 'setup', title: 'Setup Chess',
      desc: 'Place your pieces however you want before the game begins.',
      players: '2', category: 'more', playable: false,
      theme: 'setup',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91A6 6 0 013.73 2.73l3.77 3.77a1 1 0 001.4 0l1.6-1.6a1 1 0 000-1.4z"/></svg>',
    },
  ],

  init() {
    this._renderList();
    this._renderBoard();
  },

  show() {
    const page = document.getElementById('variants-page');
    if (page) page.style.display = 'flex';
    this.setActiveVariant(this.activeId);
  },

  hide() {
    const page = document.getElementById('variants-page');
    if (page) page.style.display = 'none';
  },

  setActiveVariant(id) {
    this.activeId = id;
    const variant = this.DATA.find(v => v.id === id);
    if (!variant) return;

    // Update active row
    document.querySelectorAll('.vp-row').forEach(row => {
      row.classList.toggle('active', row.dataset.id === id);
    });

    // Update page theme class
    const page = document.getElementById('variants-page');
    if (page) {
      // Remove all theme classes
      page.className = 'variants-page';
      page.classList.add('vp-theme-' + variant.theme);
    }

    // Show/hide spell cards
    const spellTop = document.getElementById('vp-spell-top');
    const spellBottom = document.getElementById('vp-spell-bottom');
    if (spellTop) spellTop.style.display = variant.theme === 'spell' ? 'flex' : 'none';
    if (spellBottom) spellBottom.style.display = variant.theme === 'spell' ? 'flex' : 'none';

    // Show/hide pocket trays
    const pocketTop = document.getElementById('vp-pocket-top');
    const pocketBottom = document.getElementById('vp-pocket-bottom');
    if (pocketTop) pocketTop.style.display = variant.theme === 'crazyhouse' ? 'flex' : 'none';
    if (pocketBottom) pocketBottom.style.display = variant.theme === 'crazyhouse' ? 'flex' : 'none';

    // Render board preview
    this._renderBoard();
  },

  setCategory(cat) {
    this._category = cat;
    this._searchQuery = '';
    const input = document.querySelector('.vp-search');
    if (input) input.value = '';
    document.querySelectorAll('.vp-cat').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === cat);
    });
    this._renderList();
  },

  filter(query) {
    this._searchQuery = query.toLowerCase().trim();
    this._renderList();
  },

  _renderList() {
    const container = document.getElementById('vp-list');
    if (!container) return;

    let items = this.DATA;
    if (this._searchQuery) {
      items = items.filter(v =>
        v.title.toLowerCase().includes(this._searchQuery) ||
        v.desc.toLowerCase().includes(this._searchQuery)
      );
    } else {
      items = items.filter(v => v.category === this._category);
    }

    container.innerHTML = items.map(v => `
      <div class="vp-row${v.id === this.activeId ? ' active' : ''}" data-id="${v.id}"
           onmouseenter="Variants.setActiveVariant('${v.id}')"
           onclick="Variants._handleClick('${v.id}')">
        <div class="vp-row-icon">${v.icon}</div>
        <div class="vp-row-info">
          <div class="vp-row-title">${v.title}</div>
          <div class="vp-row-desc">${v.desc}</div>
        </div>
        <div class="vp-row-players">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          ${v.players}
        </div>
      </div>
    `).join('');
  },

  _handleClick(id) {
    this._showToast('Coming soon');
  },

  // ---- Board Preview ----

  _renderBoard() {
    const container = document.getElementById('vp-board');
    if (!container) return;

    const variant = this.DATA.find(v => v.id === this.activeId);
    const position = this._getPosition(variant);
    const highlights = this._getHighlights(variant);
    const pieceSet = (typeof Settings !== 'undefined' && Settings.current)
      ? Settings.current.pieceSet || 'neo' : 'neo';

    let html = '';
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const isLight = (r + f) % 2 === 0;
        const piece = position[r][f];
        const sqName = String.fromCharCode(97 + f) + (8 - r);
        const hl = highlights.includes(sqName);

        html += `<div class="vp-sq ${isLight ? 'light' : 'dark'}${hl ? ' vp-hl' : ''}">`;

        if (piece) {
          html += `<img class="vp-piece" src="assets/pieces/${pieceSet}/${piece}.png" draggable="false">`;
        }

        // Duck marker
        if (variant && variant.id === 'duck' && sqName === 'd5') {
          html += '<div class="vp-duck"></div>';
        }

        html += '</div>';
      }
    }

    container.innerHTML = html;

    // 3-Check badges
    if (variant && variant.theme === '3-check') {
      this._add3CheckBadges(container);
    }

    // Crazyhouse pockets
    if (variant && variant.theme === 'crazyhouse') {
      this._renderPockets(pieceSet);
    }
  },

  _getPosition(variant) {
    if (!variant) return this._standardPos();
    switch (variant.id) {
      case 'chess960': return this._960Pos();
      case 'setup': return this._setupPos();
      default: return this._standardPos();
    }
  },

  _getHighlights(variant) {
    if (variant && variant.id === 'king-hill') return ['d4', 'd5', 'e4', 'e5'];
    return [];
  },

  _standardPos() {
    return [
      ['bR','bN','bB','bQ','bK','bB','bN','bR'],
      ['bP','bP','bP','bP','bP','bP','bP','bP'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['wP','wP','wP','wP','wP','wP','wP','wP'],
      ['wR','wN','wB','wQ','wK','wB','wN','wR'],
    ];
  },

  _960Pos() {
    return [
      ['bR','bK','bB','bQ','bN','bB','bN','bR'],
      ['bP','bP','bP','bP','bP','bP','bP','bP'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['wP','wP','wP','wP','wP','wP','wP','wP'],
      ['wR','wK','wB','wQ','wN','wB','wN','wR'],
    ];
  },

  _setupPos() {
    return [
      [null,null,null,'bQ','bK',null,null,null],
      [null,null,'bP',null,null,'bP',null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,'wP',null,null,'wP',null,null],
      [null,null,null,'wQ','wK',null,null,null],
    ];
  },

  _add3CheckBadges(container) {
    const squares = container.querySelectorAll('.vp-sq');
    squares.forEach((sq, i) => {
      const r = Math.floor(i / 8);
      const f = i % 8;
      const sqName = String.fromCharCode(97 + f) + (8 - r);
      if (sqName === 'e1' || sqName === 'e8') {
        const badge = document.createElement('div');
        badge.className = 'vp-check-badge';
        badge.textContent = '0/3';
        sq.appendChild(badge);
      }
    });
  },

  _renderPockets(pieceSet) {
    const top = document.getElementById('vp-pocket-top');
    const bottom = document.getElementById('vp-pocket-bottom');
    if (!top || !bottom) return;
    top.innerHTML = ['bP','bN','bP'].map(p =>
      `<img class="vp-pocket-piece" src="assets/pieces/${pieceSet}/${p}.png">`
    ).join('');
    bottom.innerHTML = ['wP','wB'].map(p =>
      `<img class="vp-pocket-piece" src="assets/pieces/${pieceSet}/${p}.png">`
    ).join('');
  },

  _showToast(msg) {
    let toast = document.getElementById('vp-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vp-toast';
      toast.className = 'vp-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2500);
  },
};
