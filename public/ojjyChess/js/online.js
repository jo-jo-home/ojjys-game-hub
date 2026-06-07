// Online multiplayer game via WebSocket
const OnlineGame = {
  ws: null,
  gameId: null,
  playerColor: null,
  opponentName: null,
  searching: false,
  isOnlineGame: false,
  selectedTC: '5|0',
  localChess: null, // local Chess instance for board state
  clockInterval: null,
  wTime: 0,
  bTime: 0,
  increment: 0,
  lastSyncAt: 0,
  moveHistory: [],

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const token = localStorage.getItem('ojjychess_token');
    if (!token) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/api/ojjychess/ws?token=${token}`);

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.ws = null;
      // Reconnect after 3s if we were in a game
      if (this.isOnlineGame) {
        setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {};
  },

  _handleMessage(msg) {
    switch (msg.type) {
      case 'searching':
        this.searching = true;
        break;

      case 'search_cancelled':
        this.searching = false;
        document.getElementById('online-search-overlay').style.display = 'none';
        break;

      case 'game_start':
        this._onGameStart(msg);
        break;

      case 'move_made':
        this._onMoveMade(msg);
        break;

      case 'game_over':
        this._onGameOver(msg);
        break;

      case 'draw_offered':
        document.getElementById('draw-offer-banner').style.display = 'flex';
        break;

      case 'opponent_disconnected':
        document.getElementById('disconnect-banner').style.display = 'flex';
        break;

      case 'opponent_reconnected':
        document.getElementById('disconnect-banner').style.display = 'none';
        break;

      case 'error':
        console.warn('Server:', msg.message);
        break;
    }
  },

  _onGameStart(msg) {
    this.searching = false;
    this.isOnlineGame = true;
    this.gameId = msg.gameId;
    this.playerColor = msg.color;
    this.opponentName = msg.opponent.username;
    this.wTime = msg.wTime;
    this.bTime = msg.bTime;
    this.increment = msg.increment;
    this.lastSyncAt = Date.now();
    this.moveHistory = [];

    // Hide search overlay
    document.getElementById('online-search-overlay').style.display = 'none';

    // Init local chess for board rendering
    this.localChess = new Chess();

    // If reconnecting with existing moves, replay them
    if (msg.moves && msg.moves.length > 0) {
      msg.moves.forEach(san => this.localChess.move(san));
      this.moveHistory = [...msg.moves];
    }
    if (msg.fen) {
      this.localChess = new Chess(msg.fen);
      this.moveHistory = msg.moves || [];
    }

    // Enter game mode
    App.enterOnlineGameMode();

    // Set board orientation
    Board.playerColor = this.playerColor;
    Board.flipped = this.playerColor === 'b';
    Board.el.innerHTML = '';
    Board._createSquares();
    Board.render(this._getBoard());

    // Override move handler
    Board.onMoveAttempt = (from, to, promotion) => {
      this.sendMove(from, to, promotion);
    };

    // Update player bars
    this._updatePlayerBars();

    // Start local clock display
    this._startLocalClock();

    // Update sidebar header
    const sidebarHeader = document.querySelector('#game-sidebar .sidebar-header span');
    if (sidebarHeader) sidebarHeader.textContent = 'Online Game';
  },

  _onMoveMade(msg) {
    // Apply move locally
    this.localChess.move({ from: msg.from, to: msg.to, promotion: msg.promotion });
    this.moveHistory.push(msg.san);

    // Sync clocks from server
    this.wTime = msg.wTime;
    this.bTime = msg.bTime;
    this.lastSyncAt = Date.now();

    // Render board
    Board.render(this._getBoard());
    Board.animateMove(msg.from, msg.to);
    Board.setLastMove(msg.from, msg.to);

    // Check highlight
    if (this.localChess.in_check()) {
      const turn = this.localChess.turn();
      const kingSquare = Board.findKing(turn, this._getBoard());
      Board.setCheck(kingSquare);
    } else {
      Board.setCheck(null);
    }

    // Play sound
    if (msg.captured) {
      Sound.play('capture');
    } else {
      Sound.play('move');
    }
    if (this.localChess.in_check()) {
      Sound.play('check');
    }

    // Update move list
    this._updateMoveList();

    // Update clock display
    this._updateClockDisplay();

    // Clear draw offer banner on any move
    document.getElementById('draw-offer-banner').style.display = 'none';
  },

  _onGameOver(msg) {
    this.isOnlineGame = false;
    this._stopLocalClock();

    // Determine result text
    let title = 'Game Over';
    let desc = '';
    const iWon = (msg.winner === this.playerColor);
    const isDraw = !msg.winner;

    if (msg.result === 'checkmate') {
      title = iWon ? 'You Won!' : 'You Lost';
      desc = 'by checkmate';
      Sound.play('gameover');
    } else if (msg.result === 'resign') {
      title = iWon ? 'You Won!' : 'You Lost';
      desc = 'by resignation';
      Sound.play('gameover');
    } else if (msg.result === 'timeout') {
      title = iWon ? 'You Won!' : 'You Lost';
      desc = 'on time';
      Sound.play('gameover');
    } else if (msg.result === 'abandon') {
      title = iWon ? 'You Won!' : 'You Lost';
      desc = 'opponent abandoned';
      Sound.play('gameover');
    } else if (msg.result === 'draw') {
      title = 'Draw';
      desc = 'by agreement';
    } else if (msg.result === 'stalemate') {
      title = 'Draw';
      desc = 'by stalemate';
    } else if (msg.result === 'repetition') {
      title = 'Draw';
      desc = 'by repetition';
    }

    // Show result icons on kings
    const board = this._getBoard();
    if (msg.winner) {
      const winColor = msg.winner;
      const loseColor = msg.winner === 'w' ? 'b' : 'w';
      Board.setResultIcons(Board.findKing(winColor, board), Board.findKing(loseColor, board));
    }

    // Show game over overlay
    document.getElementById('online-gameover-title').textContent = title;
    document.getElementById('online-gameover-desc').textContent = desc;

    const playersEl = document.getElementById('online-gameover-players');
    const myName = App.currentUser ? App.currentUser.username : 'You';
    playersEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin:12px 0;font-size:0.95rem">
        <span style="color:${iWon ? '#81b64c' : isDraw ? '#bababa' : '#e04040'};font-weight:700">${myName}</span>
        <span style="color:#8b8987">vs</span>
        <span style="color:${iWon ? '#e04040' : isDraw ? '#bababa' : '#81b64c'};font-weight:700">${this.opponentName}</span>
      </div>`;

    document.getElementById('online-gameover-overlay').style.display = 'flex';

    // Hide banners
    document.getElementById('draw-offer-banner').style.display = 'none';
    document.getElementById('disconnect-banner').style.display = 'none';
  },

  _getBoard() {
    // chess.js board() returns 8x8 array
    return this.localChess.board();
  },

  _updatePlayerBars() {
    const topName = document.getElementById('game-top-name');
    const bottomName = document.getElementById('game-bottom-name');
    const myName = App.currentUser ? App.currentUser.username : 'You';

    if (this.playerColor === 'w') {
      topName.textContent = this.opponentName;
      bottomName.textContent = myName;
    } else {
      topName.textContent = this.opponentName;
      bottomName.textContent = myName;
    }
  },

  _startLocalClock() {
    this._stopLocalClock();
    this.clockInterval = setInterval(() => this._updateClockDisplay(), 100);
    // Make clocks visible
    const topClock = document.getElementById('game-top-clock');
    const botClock = document.getElementById('game-bottom-clock');
    topClock.classList.add('visible');
    botClock.classList.add('visible');
    this._updateClockDisplay();
  },

  _stopLocalClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  },

  _updateClockDisplay() {
    const elapsed = Date.now() - this.lastSyncAt;
    const turn = this.localChess.turn();
    let wDisplay = this.wTime;
    let bDisplay = this.bTime;

    // Only deduct from the active player's clock
    if (this.moveHistory.length >= 2 || (this.moveHistory.length === 1)) {
      if (turn === 'w') wDisplay = Math.max(0, wDisplay - elapsed);
      else bDisplay = Math.max(0, bDisplay - elapsed);
    }

    const topClock = document.getElementById('game-top-clock');
    const botClock = document.getElementById('game-bottom-clock');

    const topTime = this.playerColor === 'w' ? bDisplay : wDisplay;
    const botTime = this.playerColor === 'w' ? wDisplay : bDisplay;

    const topTurn = this.playerColor === 'w' ? 'b' : 'w';
    const botTurn = this.playerColor;

    topClock.textContent = this._formatTime(topTime);
    botClock.textContent = this._formatTime(botTime);

    // Active clock styling
    topClock.classList.toggle('active-clock', turn === topTurn && this.moveHistory.length > 0);
    botClock.classList.toggle('active-clock', turn === botTurn && this.moveHistory.length > 0);

    // Low time warning
    topClock.classList.toggle('low-time', topTime < 30000 && topTime > 0);
    botClock.classList.toggle('low-time', botTime < 30000 && botTime > 0);
  },

  _formatTime(ms) {
    if (ms <= 0) return '0:00';
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  _updateMoveList() {
    const moveList = document.getElementById('move-list');
    if (!moveList) return;
    moveList.innerHTML = '';
    for (let i = 0; i < this.moveHistory.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const row = document.createElement('div');
      row.className = 'move-row';
      row.innerHTML = `<span class="move-num">${moveNum}.</span>` +
        `<span class="move-san">${this.moveHistory[i]}</span>` +
        (this.moveHistory[i + 1] ? `<span class="move-san">${this.moveHistory[i + 1]}</span>` : '');
      moveList.appendChild(row);
    }
    moveList.scrollTop = moveList.scrollHeight;
  },

  // Player actions
  sendMove(from, to, promotion) {
    const msg = { type: 'move', from, to };
    if (promotion) msg.promotion = promotion;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  },

  resign() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resign' }));
    }
  },

  offerDraw() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'offer_draw' }));
    }
  },

  acceptDraw() {
    document.getElementById('draw-offer-banner').style.display = 'none';
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'accept_draw' }));
    }
  },

  declineDraw() {
    document.getElementById('draw-offer-banner').style.display = 'none';
  },

  cancelSearch() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'cancel_search' }));
    }
    this.searching = false;
    document.getElementById('online-search-overlay').style.display = 'none';
  },

  findGame(timeControl) {
    this.connect();
    // Wait for connection then send
    const send = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'find_game', timeControl }));
        document.getElementById('online-search-overlay').style.display = 'flex';
      } else {
        setTimeout(send, 200);
      }
    };
    send();
  },

  rematch() {
    document.getElementById('online-gameover-overlay').style.display = 'none';
    Board.clearResultIcons();
    this.findGame(this.selectedTC);
  },

  backToHome() {
    document.getElementById('online-gameover-overlay').style.display = 'none';
    Board.clearResultIcons();
    this._stopLocalClock();
    this.isOnlineGame = false;
    this.gameId = null;
    App.enterHomeMode();
  },

  closeGameOver() {
    document.getElementById('online-gameover-overlay').style.display = 'none';
    Board.clearResultIcons();
  },
};
