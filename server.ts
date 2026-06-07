import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";
import { Chess } from "npm:chess.js@0.10.3";

const GITHUB_RAW = "https://raw.githubusercontent.com/jo-jo-home/ojjys-game-hub/master/public";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
  ".wasm": "application/wasm", ".unityweb": "application/octet-stream",
  ".data": "application/octet-stream", ".swf": "application/x-shockwave-flash",
  ".xml": "application/xml", ".txt": "text/plain", ".mem": "application/octet-stream",
};

function getMime(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? (MIME[path.substring(i).toLowerCase()] || "application/octet-stream") : "application/octet-stream";
}

const PASSWORD_HASH = "1779c0ce5c9ca5c69110d3853843a70e797bf3264fbeafa6c65de398fb423b4c";
const sessions = new Set<string>();
let _kv: Deno.Kv | null = null;
async function getKv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}

async function sha256(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function getSessionFromCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

function getSessionToken(req: Request): string | null {
  const cookie = getSessionFromCookie(req);
  if (cookie && sessions.has(cookie)) return cookie;
  const url = new URL(req.url);
  const param = url.searchParams.get("token");
  if (param && sessions.has(param)) return param;
  return null;
}

function isAuthenticated(req: Request): boolean {
  return getSessionToken(req) !== null;
}

// ========== Online chess multiplayer state ==========
interface ActiveGame {
  chess: any;
  white: string; black: string;
  wSocket: WebSocket | null; bSocket: WebSocket | null;
  wTime: number; bTime: number; increment: number;
  lastMoveAt: number; clockRunning: boolean;
  clockInterval: ReturnType<typeof setInterval> | null;
  timeControl: string; startedAt: number;
  moves: string[];
  drawOfferedBy: string | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

const matchmakingQueue = new Map<string, { ws: WebSocket; username: string; timeControl: string; queuedAt: number }>();
const activeGames = new Map<string, ActiveGame>();
const playerGameMap = new Map<string, string>();
const playerSockets = new Map<string, WebSocket>();

function parseTimeControl(tc: string): { time: number; increment: number } {
  const [min, inc] = tc.split("|").map(Number);
  return { time: (min || 5) * 60 * 1000, increment: (inc || 0) * 1000 };
}

function sendWs(ws: WebSocket | null, data: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

async function endGame(gameId: string, result: string, winner: string | null) {
  const game = activeGames.get(gameId);
  if (!game) return;
  if (game.clockInterval) clearInterval(game.clockInterval);
  if (game.disconnectTimer) clearTimeout(game.disconnectTimer);

  const msg = { type: "game_over", result, winner };
  sendWs(game.wSocket, msg);
  sendWs(game.bSocket, msg);

  // Store game in KV for both players
  const kv = await getKv();
  const gameRecord = {
    gameId, white: game.white, black: game.black,
    result, winner, timeControl: game.timeControl,
    moves: game.moves, startedAt: game.startedAt, endedAt: Date.now(),
  };

  await kv.set(["chess_games", game.white.toLowerCase(), gameId], gameRecord);
  await kv.set(["chess_games", game.black.toLowerCase(), gameId], gameRecord);

  // Update stats
  for (const player of [game.white, game.black]) {
    const key = ["chess_users", player.toLowerCase()];
    const userData = await kv.get(key);
    if (!userData.value) continue;
    const u = userData.value as any;
    const stats = u.stats || { wins: 0, losses: 0, draws: 0 };
    if (!winner) {
      stats.draws++;
    } else if ((winner === "w" && player === game.white) || (winner === "b" && player === game.black)) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    await kv.set(key, { ...u, stats });
  }

  // Clean up
  playerGameMap.delete(game.white.toLowerCase());
  playerGameMap.delete(game.black.toLowerCase());
  activeGames.delete(gameId);
}

async function getChessUserByToken(token: string): Promise<{ username: string; isGuest: boolean } | null> {
  const kv = await getKv();
  const session = await kv.get(["chess_sessions", token]);
  if (session.value) return { username: (session.value as any).username, isGuest: false };
  const guest = await kv.get(["chess_guest_sessions", token]);
  if (guest.value) return { username: (guest.value as any).guestName, isGuest: true };
  return null;
}

function handleWebSocket(ws: WebSocket, username: string) {
  const ukey = username.toLowerCase();
  playerSockets.set(ukey, ws);

  // Check if player has an active game (reconnect)
  const existingGameId = playerGameMap.get(ukey);
  if (existingGameId) {
    const game = activeGames.get(existingGameId);
    if (game) {
      const isWhite = game.white.toLowerCase() === ukey;
      if (isWhite) game.wSocket = ws; else game.bSocket = ws;
      if (game.disconnectTimer) { clearTimeout(game.disconnectTimer); game.disconnectTimer = null; }
      // Notify opponent
      const opponentSocket = isWhite ? game.bSocket : game.wSocket;
      sendWs(opponentSocket, { type: "opponent_reconnected" });
      // Compute current clock times (deduct elapsed for active player)
      let wTimeNow = game.wTime, bTimeNow = game.bTime;
      if (game.clockRunning) {
        const elapsed = Date.now() - game.lastMoveAt;
        const turn = game.chess.turn();
        if (turn === "w") wTimeNow = Math.max(0, wTimeNow - elapsed);
        else bTimeNow = Math.max(0, bTimeNow - elapsed);
      }
      // Send current game state
      sendWs(ws, {
        type: "game_start", gameId: existingGameId,
        color: isWhite ? "w" : "b",
        opponent: { username: isWhite ? game.black : game.white },
        wTime: wTimeNow, bTime: bTimeNow, increment: game.increment,
        fen: game.chess.fen(), moves: game.moves,
      });
    }
  }

  ws.onmessage = async (event) => {
    let msg: any;
    try { msg = JSON.parse(event.data as string); } catch { return; }

    if (msg.type === "find_game") {
      // Don't allow if already in a game
      if (playerGameMap.has(ukey)) {
        sendWs(ws, { type: "error", message: "Already in a game" });
        return;
      }
      const tc = msg.timeControl || "5|0";
      // Check queue for a match
      let matched = false;
      for (const [qKey, q] of matchmakingQueue) {
        if (q.timeControl === tc && qKey !== ukey) {
          // Match found
          matchmakingQueue.delete(qKey);
          const gameId = crypto.randomUUID();
          const { time, increment } = parseTimeControl(tc);
          const whiteIsNew = Math.random() < 0.5;
          const white = whiteIsNew ? username : q.username;
          const black = whiteIsNew ? q.username : username;
          const game: ActiveGame = {
            chess: new Chess(),
            white, black,
            wSocket: white === username ? ws : q.ws,
            bSocket: black === username ? ws : q.ws,
            wTime: time, bTime: time, increment,
            lastMoveAt: Date.now(), clockRunning: false,
            clockInterval: null, timeControl: tc,
            startedAt: Date.now(), moves: [],
            drawOfferedBy: null, disconnectTimer: null,
          };
          activeGames.set(gameId, game);
          playerGameMap.set(white.toLowerCase(), gameId);
          playerGameMap.set(black.toLowerCase(), gameId);

          const base = { gameId, wTime: time, bTime: time, increment };
          sendWs(game.wSocket, { type: "game_start", ...base, color: "w", opponent: { username: black } });
          sendWs(game.bSocket, { type: "game_start", ...base, color: "b", opponent: { username: white } });

          // Start clock check interval
          game.clockInterval = setInterval(() => {
            if (!game.clockRunning) return;
            const now = Date.now();
            const elapsed = now - game.lastMoveAt;
            const turn = game.chess.turn();
            if (turn === "w") {
              if (game.wTime - elapsed <= 0) {
                game.wTime = 0;
                endGame(gameId, "timeout", "b");
              }
            } else {
              if (game.bTime - elapsed <= 0) {
                game.bTime = 0;
                endGame(gameId, "timeout", "w");
              }
            }
          }, 500);

          matched = true;
          break;
        }
      }
      if (!matched) {
        matchmakingQueue.set(ukey, { ws, username, timeControl: tc, queuedAt: Date.now() });
        sendWs(ws, { type: "searching", timeControl: tc });
      }

    } else if (msg.type === "cancel_search") {
      matchmakingQueue.delete(ukey);
      sendWs(ws, { type: "search_cancelled" });

    } else if (msg.type === "move") {
      const gameId = playerGameMap.get(ukey);
      if (!gameId) { sendWs(ws, { type: "error", message: "No active game" }); return; }
      const game = activeGames.get(gameId);
      if (!game) return;

      const isWhite = game.white.toLowerCase() === ukey;
      const expectedTurn = game.chess.turn();
      if ((isWhite && expectedTurn !== "w") || (!isWhite && expectedTurn !== "b")) {
        sendWs(ws, { type: "error", message: "Not your turn" });
        return;
      }

      const moveObj: any = { from: msg.from, to: msg.to };
      if (msg.promotion) moveObj.promotion = msg.promotion;
      const result = game.chess.move(moveObj);
      if (!result) {
        sendWs(ws, { type: "error", message: "Invalid move" });
        return;
      }

      // Update clocks
      const now = Date.now();
      if (game.clockRunning) {
        const elapsed = now - game.lastMoveAt;
        if (expectedTurn === "w") {
          game.wTime = Math.max(0, game.wTime - elapsed) + game.increment;
        } else {
          game.bTime = Math.max(0, game.bTime - elapsed) + game.increment;
        }
      }
      game.lastMoveAt = now;
      game.clockRunning = true;
      game.drawOfferedBy = null;
      game.moves.push(result.san);

      const moveMsg = {
        type: "move_made", from: msg.from, to: msg.to,
        promotion: msg.promotion || null, san: result.san,
        fen: game.chess.fen(),
        wTime: game.wTime, bTime: game.bTime,
        turn: game.chess.turn(),
        captured: result.captured || null,
        flags: result.flags,
      };
      sendWs(game.wSocket, moveMsg);
      sendWs(game.bSocket, moveMsg);

      // Check game over
      if (game.chess.game_over()) {
        if (game.chess.in_checkmate()) {
          await endGame(gameId, "checkmate", expectedTurn);
        } else if (game.chess.in_stalemate()) {
          await endGame(gameId, "stalemate", null);
        } else if (game.chess.in_draw()) {
          await endGame(gameId, "draw", null);
        } else if (game.chess.in_threefold_repetition()) {
          await endGame(gameId, "repetition", null);
        }
      }

    } else if (msg.type === "resign") {
      const gameId = playerGameMap.get(ukey);
      if (!gameId) return;
      const game = activeGames.get(gameId);
      if (!game) return;
      const isWhite = game.white.toLowerCase() === ukey;
      await endGame(gameId, "resign", isWhite ? "b" : "w");

    } else if (msg.type === "offer_draw") {
      const gameId = playerGameMap.get(ukey);
      if (!gameId) return;
      const game = activeGames.get(gameId);
      if (!game) return;
      game.drawOfferedBy = ukey;
      const isWhite = game.white.toLowerCase() === ukey;
      sendWs(isWhite ? game.bSocket : game.wSocket, { type: "draw_offered" });

    } else if (msg.type === "accept_draw") {
      const gameId = playerGameMap.get(ukey);
      if (!gameId) return;
      const game = activeGames.get(gameId);
      if (!game || !game.drawOfferedBy || game.drawOfferedBy === ukey) return;
      await endGame(gameId, "draw", null);
    }
  };

  ws.onclose = () => {
    playerSockets.delete(ukey);
    matchmakingQueue.delete(ukey);

    const gameId = playerGameMap.get(ukey);
    if (gameId) {
      const game = activeGames.get(gameId);
      if (game) {
        const isWhite = game.white.toLowerCase() === ukey;
        if (isWhite) game.wSocket = null; else game.bSocket = null;
        const opponentSocket = isWhite ? game.bSocket : game.wSocket;
        sendWs(opponentSocket, { type: "opponent_disconnected" });

        // Auto-resign after 60s
        game.disconnectTimer = setTimeout(() => {
          endGame(gameId, "abandon", isWhite ? "b" : "w");
        }, 60000);
      }
    }
  };
}

// Anti-inspect script injected into all HTML pages
const ANTI_INSPECT = `<script>(function(){document.addEventListener('contextmenu',function(e){e.preventDefault()});document.addEventListener('keydown',function(e){if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&(e.key==='I'||e.key==='J'||e.key==='C'))||(e.ctrlKey&&e.key==='u')||(e.metaKey&&e.altKey&&(e.key==='i'||e.key==='j'||e.key==='c'))||(e.metaKey&&e.altKey&&e.key==='u'))e.preventDefault()})})();</script>`;

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ojjy's game hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background-color:#0a1628;color:#c8d6e5;min-height:100vh;display:flex;align-items:center;justify-content:center}.l{background:#111d2e;border:1px solid #1e3a5f;border-radius:12px;padding:2.5rem;width:100%;max-width:360px;text-align:center}h1{font-size:1.8rem;font-weight:300;color:#e2e8f0;letter-spacing:.05em;margin-bottom:1.5rem}input[type="password"]{display:block;width:100%;padding:.7rem 1rem;border:1px solid #1e3a5f;border-radius:8px;background:#0a1628;color:#e2e8f0;font-size:1rem;outline:none;margin-bottom:1rem}input[type="password"]:focus{border-color:#2e6bbd}input[type="password"]::placeholder{color:#475569}button{width:100%;padding:.7rem;border:1px solid #1e3a5f;border-radius:8px;background:#162a42;color:#e2e8f0;font-size:1rem;cursor:pointer;transition:background .2s,border-color .2s}button:hover{background:#1e3a5f;border-color:#2e6bbd}.e{color:#ef4444;font-size:.85rem;margin-bottom:1rem;display:none}</style>
</head>
<body>
<form class="l" method="POST" action="/login">
<h1>ojjy's game hub</h1>
<p class="e" id="e">wrong password</p>
<input type="password" name="password" placeholder="enter password..." autofocus autocomplete="current-password">
<button type="submit">enter</button>
</form>
${ANTI_INSPECT}
<script>if(location.search.includes('wrong=1'))document.getElementById('e').style.display='block';</script>
</body>
</html>`;

// Game data used to build the hub page dynamically on the server
const GAMES = [
  { id: "bitlife", name: "BitLife", desc: "live your best life", icon: true },
  { id: "chess", name: "Chess", desc: "classic 3D chess", icon: true },
  { id: "crossyroadspace", name: "Crossy Road Space", desc: "dodge the traffic", icon: true },
  { id: "geometrydash", name: "Geometry Dash", desc: "rhythm-based platformer", icon: true },
  { id: "geometrydashlite", name: "Geometry Dash Lite", desc: "jump to the beat", icon: true },
  { id: "spacewaves", name: "Space Waves", desc: "navigate the waves", icon: true },
  { id: "leveldevil", name: "Level Devil", desc: "tricky platformer", icon: true },
  { id: "stickmanhook", name: "Stickman Hook", desc: "swing and fly", icon: true },
  { id: "gladihoppers", name: "Gladihoppers", desc: "gladiator combat", icon: true },
  { id: "drifthunters", name: "Drift Hunters", desc: "drift and upgrade", icon: true },
  { id: "driftboss", name: "Drift Boss", desc: "drift to survive", icon: true },
  { id: "drivemad", name: "Drive Mad", desc: "crazy driving physics", icon: true },
  { id: "ducklife1", name: "Duck Life 1", desc: "train your duck", icon: true },
  { id: "ducklife2", name: "Duck Life 2", desc: "world champion duck", icon: true },
  { id: "ducklife3", name: "Duck Life 3", desc: "evolution awaits", icon: true },
  { id: "ducklife4", name: "Duck Life 4", desc: "adventure continues", icon: true },
  { id: "ducklife5", name: "Duck Life 5", desc: "treasure hunt", icon: true },
  { id: "ducklife6", name: "Duck Life 6", desc: "space adventure", icon: true },
  { id: "rocketgoalio", name: "Rocket Goal IO", desc: "rocket-powered soccer", icon: true },
  { id: "motox3m", name: "MotoX3M", desc: "extreme bike stunts", icon: true },
  { id: "ojjyclient", name: "ojjyclient", desc: "custom client made by jonas:)", icon: true },
  { id: "subwayssurfersny", name: "Subway Surfers NY", desc: "surf the subway", icon: true },
  { id: "ngon", name: "NGON", desc: "physics shooter", icon: true },
  { id: "ovo", name: "OvO", desc: "precision platformer", icon: true },
  { id: "fallguys", name: "Fall Guys", desc: "stumble and survive", icon: true },
  { id: "retrobowl", name: "Retro Bowl", desc: "retro football fun", icon: true },
  { id: "gettingoverit", name: "Getting Over It", desc: "scratch edition", icon: true },
  { id: "coreball", name: "Coreball", desc: "pin the pins", icon: true },
  { id: "cookieclicker", name: "Cookie Clicker", desc: "click the cookie", icon: true },
  { id: "ojjyChess", name: "ojjyChess", desc: "chess.com-style chess", icon: true },
];

function buildHubPage(token: string): string {
  const cards = GAMES.map(g => {
    const iconHtml = g.icon ? `<img src="/icons/${g.id}.png" alt="${g.name}">` : "";
    return `<a href="/${g.id}/" class="gc" data-n="${g.id}"><button class="sb" data-g="${g.id}">&#9734;</button>${iconHtml}<h2>${g.name}</h2><p>${g.desc}</p></a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ojjy's game hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background-color:#0a1628;color:#c8d6e5;min-height:100vh;display:flex;flex-direction:column}header{text-align:center;padding:3rem 1rem 2rem;position:relative}header h1{font-size:2.4rem;font-weight:300;color:#e2e8f0;letter-spacing:.05em}header p{margin-top:.5rem;font-size:.95rem;color:#64748b}.stg-btn{position:absolute;top:1.2rem;right:1.2rem;background:#111d2e;border:1px solid #1e3a5f;border-radius:8px;padding:6px 14px;color:#64748b;font-size:.8rem;cursor:pointer;transition:background .2s,border-color .2s,color .2s;text-decoration:none}.stg-btn:hover{background:#162a42;border-color:#2e6bbd;color:#c8d6e5}main{flex:1;max-width:900px;width:100%;margin:0 auto;padding:2rem 1.5rem}.sr{display:block;width:100%;max-width:400px;margin:0 auto 2rem;padding:.7rem 1rem;border:1px solid #1e3a5f;border-radius:8px;background:#111d2e;color:#e2e8f0;font-size:1rem;outline:none}.sr:focus{border-color:#2e6bbd}.sr::placeholder{color:#475569}.gg{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1.2rem}.gc{background:#111d2e;border:1px solid #1e3a5f;border-radius:12px;padding:2rem 1.5rem;text-align:center;text-decoration:none;color:#c8d6e5;transition:background .2s,border-color .2s;position:relative}.gc:hover{background:#162a42;border-color:#2e6bbd}.gc img{width:64px;height:64px;object-fit:contain;margin-bottom:.8rem}.gc h2{font-size:1.15rem;font-weight:500;color:#e2e8f0}.gc p{margin-top:.4rem;font-size:.85rem;color:#64748b}.sb{position:absolute;top:8px;right:8px;background:none;border:none;font-size:1.2rem;cursor:pointer;color:#475569;line-height:1;padding:4px}.sb:hover{color:#f0c040}.sb.a{color:#f0c040}footer{text-align:center;padding:2rem 1rem;font-size:.85rem;color:#475569;border-top:1px solid #1e293b}footer a{color:#475569;margin-left:.5rem;text-decoration:none;cursor:pointer;transition:color .2s}footer a:hover{color:#64748b}.cm-ov{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(10,22,40,.95);z-index:900;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:2rem 1rem}.cm-ov.open{display:flex}.cm{width:100%;max-width:520px;margin-top:2rem}.cm-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}.cm-hd h2{font-size:1.4rem;font-weight:300;color:#e2e8f0;letter-spacing:.03em}.cm-hd button{background:none;border:none;color:#64748b;font-size:1.5rem;cursor:pointer;padding:4px 8px;line-height:1}.cm-hd button:hover{color:#e2e8f0}.cm-sum{font-size:.85rem;color:#64748b;margin-bottom:1.2rem}.cm-it{background:#111d2e;border:1px solid #1e3a5f;border-radius:10px;padding:1rem 1.2rem;margin-bottom:.7rem;transition:border-color .2s}.cm-it:hover{border-color:#2e6bbd}.cm-it-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem}.cm-it-name{font-size:.95rem;color:#e2e8f0;font-weight:500}.cm-it-btn{background:#162a42;border:1px solid #1e3a5f;border-radius:6px;padding:4px 12px;color:#c8d6e5;font-size:.78rem;cursor:pointer;transition:background .2s,border-color .2s}.cm-it-btn:hover{background:#1e3a5f;border-color:#2e6bbd}.cm-it-meta{display:flex;gap:.8rem;font-size:.78rem;color:#64748b;flex-wrap:wrap}.cm-it-meta span{display:flex;align-items:center;gap:3px}.cm-it-keys{margin-top:.5rem;font-size:.75rem;color:#475569;word-break:break-all}.cm-sep{border:none;border-top:1px solid #1e293b;margin:1.2rem 0}.cm-da{display:flex;justify-content:center;margin-top:.5rem}.cm-da button{background:#2a1a1a;border:1px solid #4a2020;border-radius:8px;padding:8px 24px;color:#e05555;font-size:.85rem;cursor:pointer;transition:background .2s}.cm-da button:hover{background:#3a2020}.cm-empty{text-align:center;color:#475569;padding:2rem;font-size:.9rem}.cm-it-tags{display:flex;gap:5px;margin-top:.4rem;flex-wrap:wrap}.cm-tag{display:inline-block;font-size:.65rem;font-weight:400;color:#64748b;background:#1a2a3f;border:1px solid #1e3a5f;border-radius:4px;padding:2px 7px}</style>
</head>
<body>
<header><h1>ojjy's game hub</h1><p>a collection of games, made by jonas:)</p><a class="stg-btn" onclick="openCM()">manage storage</a></header>
<main>
<input type="text" class="sr" id="s" placeholder="search ${GAMES.length} games..." autocomplete="off">
<div class="gg" id="g">${cards}</div>
</main>
<footer>made by Jonas Lee</footer>
<div class="cm-ov" id="cm-ov"><div class="cm" id="cm"></div></div>
${ANTI_INSPECT}
<script>
var _t='${token}';
var _0x=[JSON.parse(localStorage.getItem('favorites')||'[]'),document.getElementById('g'),document.getElementById('s'),[].slice.call(document.querySelectorAll('.gc')).map(function(c){return c.dataset.n})];
function _r(){document.querySelectorAll('.sb').forEach(function(b){var c=b.closest('.gc'),n=c.dataset.n;if(_0x[0].includes(n)){b.classList.add('a');b.innerHTML='\\u2605'}else{b.classList.remove('a');b.innerHTML='\\u2606'}})}
function _s(){var c=[].slice.call(_0x[1].children);var o=_0x[3];c.sort(function(a,b){var af=_0x[0].includes(a.dataset.n)?0:1;var bf=_0x[0].includes(b.dataset.n)?0:1;if(af!==bf)return af-bf;return o.indexOf(a.dataset.n)-o.indexOf(b.dataset.n)});c.forEach(function(x){_0x[1].appendChild(x)})}
document.querySelectorAll('.sb').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var n=b.dataset.g,i=_0x[0].indexOf(n);if(i>=0)_0x[0].splice(i,1);else _0x[0].push(n);localStorage.setItem('favorites',JSON.stringify(_0x[0]));_r();_s()})});
document.querySelectorAll('.gc').forEach(function(c){c.addEventListener('click',function(e){if(e.target.closest('.sb'))return;e.preventDefault();var u=c.getAttribute('href')+'?token='+_t,w=window.open('about:blank','_blank');if(w){w.document.write('<!DOCTYPE html><html><head><title>ojjy\\'s game hub</title><style>*{margin:0;padding:0}html,body,iframe{width:100%;height:100%;border:none;overflow:hidden}</style></head><body><iframe src=\"'+window.location.origin+u+'\" allowfullscreen></iframe><script>window.addEventListener(\"beforeunload\",function(e){e.preventDefault()});<\\/script></body></html>');w.document.close()}})});
_0x[2].addEventListener('input',function(){var q=_0x[2].value.toLowerCase();document.querySelectorAll('.gc').forEach(function(c){c.style.display=c.dataset.n.includes(q)?'':'none'})});
_r();_s();
var _km={
'favorites':'hub favorites','ojjychess_token':'ojjyChess',
'CookieClickerGame':'Cookie Clicker','CookieClickerGameBeta':'Cookie Clicker','CookieClickerGameBetaDungeons':'Cookie Clicker','CookieClickerGameOld':'Cookie Clicker','CookieClickerGamev10466':'Cookie Clicker',
'startup-time':'Drive Mad',
'pokiMigrated':'Crossy Road Space','crossyScore':'Crossy Road Space','currentWorld':'Crossy Road Space','selectedChar':'Crossy Road Space','hasPlayedBefore':'Crossy Road Space','giftsGiven':'Crossy Road Space','coins':'Crossy Road Space','first_round_finished':'Crossy Road Space','unlockedCharacters':'Crossy Road Space','highScore':'Crossy Road Space','totalCoins':'Crossy Road Space',
'minilogSettings':'Geometry Dash','minilog':'Geometry Dash',
'localSettings':'NGON',
'__c2save':'OvO'
};
var _kp=[['CookieClicker','Cookie Clicker'],['subway.','Subway Surfers NY'],['subsurf','Subway Surfers NY']];
function _gn(k){if(_km[k])return _km[k];if(k.startsWith('_ts_'))return null;for(var i=0;i<_kp.length;i++){if(k.indexOf(_kp[i][0])>=0)return _kp[i][1]}return null}
function _sz(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB'}
function _ago(ts){if(!ts)return'unknown';var d=Date.now()-ts,s=Math.floor(d/1000),m=Math.floor(s/60),h=Math.floor(m/60),dy=Math.floor(h/24);if(dy>0)return dy+'d ago';if(h>0)return h+'h ago';if(m>0)return m+'m ago';return'just now'}
var _cim={'_C2SaveStates':'OvO','localforage':'OvO','IDBFS':'Space Waves','firebaseLocalStorageDb':'Rocket Goal IO'};
var _cip=[['eagler','ojjyClient'],['_EaS','ojjyClient'],['EaglerSP','ojjyClient'],['c3offline','Fall Guys'],['construct','Fall Guys']];
function _cin(n){if(_cim[n])return _cim[n];for(var i=0;i<_cip.length;i++){if(n.indexOf(_cip[i][0])>=0)return _cip[i][1]}return null}
function _buildGroups(cb){
var groups={};
function grp(name){if(!groups[name])groups[name]={name:name,ls:[],lsSize:0,lsKeys:[],caches:[],idbs:[],lastSaved:null};return groups[name]}
var total=0;
for(var i=0;i<localStorage.length;i++){
var k=localStorage.key(i);if(k.startsWith('_ts_'))continue;
var gname=_gn(k);
var v=localStorage.getItem(k)||'';var sz=k.length+v.length;
var ts=localStorage.getItem('_ts_'+k);ts=ts?parseInt(ts):null;
var g=grp(gname||'other');
g.ls.push(k);g.lsSize+=sz;g.lsKeys.push(k);
if(ts&&(!g.lastSaved||ts>g.lastSaved))g.lastSaved=ts;
total+=sz;
}
var scanC=new Promise(function(res){
if(!window.caches){res([]);return}
caches.keys().then(function(names){res(names)}).catch(function(){res([])});
});
var scanI=new Promise(function(res){
if(!indexedDB.databases){res([]);return}
indexedDB.databases().then(function(dbs){res(dbs)}).catch(function(){res([])});
});
Promise.all([scanC,scanI]).then(function(r){
var cNames=r[0],iDbs=r[1];
cNames.forEach(function(n){var gname=_cin(n);var g=grp(gname||n);g.caches.push(n)});
iDbs.forEach(function(db){var gname=_cin(db.name);var g=grp(gname||db.name);g.idbs.push(db.name)});
var sorted=Object.values(groups).sort(function(a,b){return b.lsSize-a.lsSize});
cb(sorted,total);
});
}
function renderCM(){_buildGroups(function(groups,total){
var el=document.getElementById('cm');
var h='<div class="cm-hd"><h2>storage manager</h2><button onclick="closeCM()">&times;</button></div>';
h+='<div class="cm-sum">'+_sz(total)+' total across '+groups.length+' items</div>';
if(groups.length===0){h+='<div class="cm-empty">no cached data found</div>';el.innerHTML=h;return}
window._cmGroups=groups;
groups.forEach(function(g,i){
h+='<div class="cm-it"><div class="cm-it-hd"><span class="cm-it-name">'+g.name+'</span><button class="cm-it-btn" onclick="clearGroup('+i+')">clear</button></div>';
h+='<div class="cm-it-meta">';
if(g.lsSize>0)h+='<span>'+_sz(g.lsSize)+'</span>';
h+='<span>'+_ago(g.lastSaved)+'</span>';
h+='</div>';
var tags=[];
if(g.ls.length>0)tags.push(g.ls.length+' local storage key'+(g.ls.length>1?'s':''));
if(g.caches.length>0)tags.push(g.caches.length+' cache'+(g.caches.length>1?'s':''));
if(g.idbs.length>0)tags.push(g.idbs.length+' database'+(g.idbs.length>1?'s':''));
h+='<div class="cm-it-tags">'+tags.map(function(t){return'<span class="cm-tag">'+t+'</span>'}).join('')+'</div>';
var allKeys=g.lsKeys.concat(g.caches.map(function(c){return'cache: '+c})).concat(g.idbs.map(function(d){return'db: '+d}));
if(allKeys.length>0)h+='<div class="cm-it-keys">'+allKeys.join(', ')+'</div>';
h+='</div>';
});
h+='<hr class="cm-sep"><div class="cm-da"><button onclick="clearAll()">clear all data</button></div>';
el.innerHTML=h;
})}
function clearGroup(i){var g=window._cmGroups[i];if(!g)return;
g.ls.forEach(function(k){localStorage.removeItem(k);localStorage.removeItem('_ts_'+k)});
g.caches.forEach(function(n){caches.delete(n)});
g.idbs.forEach(function(n){try{indexedDB.deleteDatabase(n)}catch(e){}});
if(g.name==='hub favorites'){_0x[0]=[];_r();_s()}
renderCM();}
function clearAll(){for(var i=localStorage.length-1;i>=0;i--)localStorage.removeItem(localStorage.key(i));_0x[0]=[];_r();_s();if(window.caches)caches.keys().then(function(n){n.forEach(function(k){caches.delete(k)})});if(indexedDB.databases)indexedDB.databases().then(function(dbs){dbs.forEach(function(db){try{indexedDB.deleteDatabase(db.name)}catch(e){}})});renderCM()}
function openCM(){document.getElementById('cm-ov').classList.add('open');renderCM()}
function closeCM(){document.getElementById('cm-ov').classList.remove('open')}
document.getElementById('cm-ov').addEventListener('click',function(e){if(e.target===this)closeCM()});
</script>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Handle login POST
  if (url.pathname === "/login" && req.method === "POST") {
    const form = await req.formData();
    const password = form.get("password") as string || "";
    const hashed = await sha256(password);
    if (hashed === PASSWORD_HASH) {
      const token = generateToken();
      sessions.add(token);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=86400`,
        },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { "Location": "/login?wrong=1" },
    });
  }

  // Serve login page
  if (url.pathname === "/login") {
    return new Response(LOGIN_PAGE, {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
    });
  }

  // --- ojjyChess auth helper ---
  async function getChessUser(req: Request): Promise<{ username: string; isGuest: boolean } | null> {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return null;
    const session = await (await getKv()).get(["chess_sessions", token]);
    if (session.value) return { username: (session.value as any).username, isGuest: false };
    const guest = await (await getKv()).get(["chess_guest_sessions", token]);
    if (guest.value) return { username: (guest.value as any).guestName, isGuest: true };
    return null;
  }

  const JSON_HEADERS = { "Content-Type": "application/json" };

  // --- ojjyChess API routes (before auth check — these use their own auth) ---
  if (url.pathname === "/api/ojjychess/register" && req.method === "POST") {
    try {
      const { username, password } = await req.json();
      if (!username || !password) return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (username.length < 3) return new Response(JSON.stringify({ error: "username must be 3+ characters" }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (password.length < 4) return new Response(JSON.stringify({ error: "password must be 4+ characters" }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (!/^[a-zA-Z0-9_]+$/.test(username)) return new Response(JSON.stringify({ error: "username: letters, numbers, underscores only" }), { status: 400, headers: { "Content-Type": "application/json" } });

      const existing = await (await getKv()).get(["chess_users", username.toLowerCase()]);
      if (existing.value) return new Response(JSON.stringify({ error: "username taken" }), { status: 409, headers: { "Content-Type": "application/json" } });

      const passwordHash = await sha256(password);
      const user = { username, passwordHash, createdAt: Date.now(), stats: { wins: 0, losses: 0, draws: 0 } };
      await (await getKv()).set(["chess_users", username.toLowerCase()], user);

      const token = generateToken();
      await (await getKv()).set(["chess_sessions", token], { username, createdAt: Date.now() }, { expireIn: 86400000 });

      return new Response(JSON.stringify({ token, user: { username, stats: user.stats } }), { headers: { "Content-Type": "application/json" } });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === "/api/ojjychess/login" && req.method === "POST") {
    try {
      const { username, password } = await req.json();
      if (!username || !password) return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { "Content-Type": "application/json" } });

      const entry = await (await getKv()).get(["chess_users", username.toLowerCase()]);
      if (!entry.value) return new Response(JSON.stringify({ error: "invalid username or password" }), { status: 401, headers: { "Content-Type": "application/json" } });

      const passwordHash = await sha256(password);
      const ev = entry.value as any;
      if (ev.passwordHash !== passwordHash) return new Response(JSON.stringify({ error: "invalid username or password" }), { status: 401, headers: { "Content-Type": "application/json" } });

      const token = generateToken();
      await (await getKv()).set(["chess_sessions", token], { username: ev.username, createdAt: Date.now() }, { expireIn: 86400000 });

      return new Response(JSON.stringify({ token, user: { username: ev.username, stats: ev.stats } }), { headers: { "Content-Type": "application/json" } });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === "/api/ojjychess/me" && req.method === "GET") {
    const authHeader = req.headers.get("Authorization") || "";
    const chessToken = authHeader.replace("Bearer ", "");

    // Check registered session first
    const session = await (await getKv()).get(["chess_sessions", chessToken]);
    if (session.value) {
      const sv = session.value as any;
      const user = await (await getKv()).get(["chess_users", sv.username.toLowerCase()]);
      if (!user.value) return new Response(JSON.stringify({ error: "user not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const uv = user.value as any;
      return new Response(JSON.stringify({ username: uv.username, stats: uv.stats, isGuest: false, createdAt: uv.createdAt }), { headers: { "Content-Type": "application/json" } });
    }

    // Check guest session
    const guest = await (await getKv()).get(["chess_guest_sessions", chessToken]);
    if (guest.value) {
      return new Response(JSON.stringify({ username: (guest.value as any).guestName, isGuest: true }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "not logged in" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  if (url.pathname === "/api/ojjychess/stats" && req.method === "POST") {
    const authHeader = req.headers.get("Authorization") || "";
    const chessToken = authHeader.replace("Bearer ", "");
    const statSession = await (await getKv()).get(["chess_sessions", chessToken]);
    if (!statSession.value) return new Response(JSON.stringify({ error: "not logged in" }), { status: 401, headers: { "Content-Type": "application/json" } });

    try {
      const { result } = await req.json();
      if (!["win", "loss", "draw"].includes(result)) return new Response(JSON.stringify({ error: "invalid result" }), { status: 400, headers: { "Content-Type": "application/json" } });

      const ssv = statSession.value as any;
      const userKey = ["chess_users", ssv.username.toLowerCase()];
      const user = await (await getKv()).get(userKey);
      if (!user.value) return new Response(JSON.stringify({ error: "user not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

      const uv = user.value as any;
      const stats = uv.stats || { wins: 0, losses: 0, draws: 0 };
      if (result === "win") stats.wins++;
      else if (result === "loss") stats.losses++;
      else stats.draws++;

      await (await getKv()).set(userKey, { ...uv, stats });
      return new Response(JSON.stringify({ stats }), { headers: { "Content-Type": "application/json" } });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  // --- Guest session ---
  if (url.pathname === "/api/ojjychess/guest" && req.method === "POST") {
    try {
      const { name } = await req.json();
      if (!name || typeof name !== "string") return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 20) return new Response(JSON.stringify({ error: "name must be 2-20 characters" }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (!/^[a-zA-Z0-9_ ]+$/.test(trimmed)) return new Response(JSON.stringify({ error: "letters, numbers, spaces, underscores only" }), { status: 400, headers: { "Content-Type": "application/json" } });

      const token = generateToken();
      await (await getKv()).set(["chess_guest_sessions", token], { guestName: trimmed, createdAt: Date.now() }, { expireIn: 86400000 });

      return new Response(JSON.stringify({ token, guestName: trimmed }), { headers: { "Content-Type": "application/json" } });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === "/api/ojjychess/logout" && req.method === "POST") {
    const authHeader = req.headers.get("Authorization") || "";
    const chessToken = authHeader.replace("Bearer ", "");
    await (await getKv()).delete(["chess_sessions", chessToken]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // --- ojjyChess Social API routes ---

  // User search
  if (url.pathname === "/api/ojjychess/users/search" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    if (!q) return new Response(JSON.stringify({ users: [] }), { headers: JSON_HEADERS });
    const kv = await getKv();
    const results: { username: string }[] = [];
    const iter = kv.list({ start: ["chess_users", q], end: ["chess_users", q + "\xff"] });
    for await (const entry of iter) {
      const u = (entry.value as any).username;
      if (u.toLowerCase() !== user.username.toLowerCase()) results.push({ username: u });
      if (results.length >= 10) break;
    }
    return new Response(JSON.stringify({ users: results }), { headers: JSON_HEADERS });
  }

  // Get friends list
  if (url.pathname === "/api/ojjychess/friends" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    const kv = await getKv();
    const friends: { username: string; online: boolean; since: number }[] = [];
    const iter = kv.list({ prefix: ["chess_friends", user.username.toLowerCase()] });
    for await (const entry of iter) {
      const friendKey = entry.key[2] as string;
      const data = entry.value as any;
      // Get display name from user record
      const friendUser = await kv.get(["chess_users", friendKey]);
      const displayName = friendUser.value ? (friendUser.value as any).username : friendKey;
      // Check online status
      const online = await kv.get(["chess_online", friendKey]);
      friends.push({ username: displayName, online: !!online.value, since: data.since });
    }
    return new Response(JSON.stringify({ friends }), { headers: JSON_HEADERS });
  }

  // Send friend request
  if (url.pathname === "/api/ojjychess/friends/request" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    try {
      const { username } = await req.json();
      if (!username) return new Response(JSON.stringify({ error: "username required" }), { status: 400, headers: JSON_HEADERS });
      const targetKey = username.toLowerCase();
      const selfKey = user.username.toLowerCase();
      if (targetKey === selfKey) return new Response(JSON.stringify({ error: "cannot friend yourself" }), { status: 400, headers: JSON_HEADERS });
      const kv = await getKv();
      // Check target exists
      const targetUser = await kv.get(["chess_users", targetKey]);
      if (!targetUser.value) return new Response(JSON.stringify({ error: "user not found" }), { status: 404, headers: JSON_HEADERS });
      // Check not already friends
      const existing = await kv.get(["chess_friends", selfKey, targetKey]);
      if (existing.value) return new Response(JSON.stringify({ error: "already friends" }), { status: 400, headers: JSON_HEADERS });
      // Check if they already sent us a request — auto-accept
      const theirRequest = await kv.get(["chess_friend_requests", selfKey, targetKey]);
      if (theirRequest.value) {
        await kv.atomic()
          .delete(["chess_friend_requests", selfKey, targetKey])
          .delete(["chess_friend_requests_sent", targetKey, selfKey])
          .set(["chess_friends", selfKey, targetKey], { since: Date.now() })
          .set(["chess_friends", targetKey, selfKey], { since: Date.now() })
          .commit();
        return new Response(JSON.stringify({ ok: true, autoAccepted: true }), { headers: JSON_HEADERS });
      }
      // Check not already sent
      const alreadySent = await kv.get(["chess_friend_requests_sent", selfKey, targetKey]);
      if (alreadySent.value) return new Response(JSON.stringify({ error: "request already sent" }), { status: 400, headers: JSON_HEADERS });
      // Send request
      await kv.atomic()
        .set(["chess_friend_requests", targetKey, selfKey], { sentAt: Date.now(), senderUsername: user.username })
        .set(["chess_friend_requests_sent", selfKey, targetKey], { sentAt: Date.now() })
        .commit();
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
  }

  // Get pending friend requests
  if (url.pathname === "/api/ojjychess/friends/requests" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    const kv = await getKv();
    const requests: { from: string; sentAt: number }[] = [];
    const iter = kv.list({ prefix: ["chess_friend_requests", user.username.toLowerCase()] });
    for await (const entry of iter) {
      const data = entry.value as any;
      requests.push({ from: data.senderUsername, sentAt: data.sentAt });
    }
    return new Response(JSON.stringify({ requests }), { headers: JSON_HEADERS });
  }

  // Accept friend request
  if (url.pathname === "/api/ojjychess/friends/accept" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    try {
      const { username } = await req.json();
      if (!username) return new Response(JSON.stringify({ error: "username required" }), { status: 400, headers: JSON_HEADERS });
      const senderKey = username.toLowerCase();
      const selfKey = user.username.toLowerCase();
      const kv = await getKv();
      const request = await kv.get(["chess_friend_requests", selfKey, senderKey]);
      if (!request.value) return new Response(JSON.stringify({ error: "no pending request" }), { status: 404, headers: JSON_HEADERS });
      await kv.atomic()
        .delete(["chess_friend_requests", selfKey, senderKey])
        .delete(["chess_friend_requests_sent", senderKey, selfKey])
        .set(["chess_friends", selfKey, senderKey], { since: Date.now() })
        .set(["chess_friends", senderKey, selfKey], { since: Date.now() })
        .commit();
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
  }

  // Decline friend request
  if (url.pathname === "/api/ojjychess/friends/decline" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    try {
      const { username } = await req.json();
      if (!username) return new Response(JSON.stringify({ error: "username required" }), { status: 400, headers: JSON_HEADERS });
      const senderKey = username.toLowerCase();
      const selfKey = user.username.toLowerCase();
      const kv = await getKv();
      await kv.atomic()
        .delete(["chess_friend_requests", selfKey, senderKey])
        .delete(["chess_friend_requests_sent", senderKey, selfKey])
        .commit();
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
  }

  // Remove friend
  if (url.pathname === "/api/ojjychess/friends/remove" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    try {
      const { username } = await req.json();
      if (!username) return new Response(JSON.stringify({ error: "username required" }), { status: 400, headers: JSON_HEADERS });
      const friendKey = username.toLowerCase();
      const selfKey = user.username.toLowerCase();
      const kv = await getKv();
      await kv.atomic()
        .delete(["chess_friends", selfKey, friendKey])
        .delete(["chess_friends", friendKey, selfKey])
        .commit();
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
  }

  // --- Messaging API routes ---

  // Helper: build conversation ID from two usernames
  function getConversationId(a: string, b: string): string {
    return [a.toLowerCase(), b.toLowerCase()].sort().join("::");
  }

  // Get all conversations
  if (url.pathname === "/api/ojjychess/messages/conversations" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    const kv = await getKv();
    const conversations: any[] = [];
    const iter = kv.list({ prefix: ["chess_conversations", user.username.toLowerCase()] });
    for await (const entry of iter) {
      conversations.push(entry.value);
    }
    conversations.sort((a: any, b: any) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    return new Response(JSON.stringify({ conversations }), { headers: JSON_HEADERS });
  }

  // Get messages with a user / Send message / Mark read
  if (url.pathname.startsWith("/api/ojjychess/messages/") && url.pathname !== "/api/ojjychess/messages/conversations") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });

    const parts = url.pathname.split("/");
    const targetUsername = decodeURIComponent(parts[4] || "");
    if (!targetUsername) return new Response(JSON.stringify({ error: "username required" }), { status: 400, headers: JSON_HEADERS });

    const kv = await getKv();
    const selfKey = user.username.toLowerCase();
    const targetKey = targetUsername.toLowerCase();
    const convId = getConversationId(selfKey, targetKey);

    // Mark read
    if (parts[5] === "read" && req.method === "POST") {
      const convEntry = await kv.get(["chess_conversations", selfKey, convId]);
      if (convEntry.value) {
        await kv.set(["chess_conversations", selfKey, convId], { ...(convEntry.value as any), unreadCount: 0 });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }

    // Get messages
    if (req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const before = url.searchParams.get("before");
      const messages: any[] = [];
      const listOpts: any = { prefix: ["chess_messages", convId], limit, reverse: true };
      if (before) listOpts.end = ["chess_messages", convId, parseInt(before)];
      const iter = kv.list(listOpts);
      for await (const entry of iter) {
        messages.push(entry.value);
      }
      messages.reverse();
      return new Response(JSON.stringify({ messages }), { headers: JSON_HEADERS });
    }

    // Send message
    if (req.method === "POST") {
      try {
        const { text } = await req.json();
        if (!text || typeof text !== "string") return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: JSON_HEADERS });
        const trimmed = text.trim();
        if (!trimmed || trimmed.length > 500) return new Response(JSON.stringify({ error: "message must be 1-500 characters" }), { status: 400, headers: JSON_HEADERS });

        // Verify target user exists
        const targetUser = await kv.get(["chess_users", targetKey]);
        if (!targetUser.value) return new Response(JSON.stringify({ error: "user not found" }), { status: 404, headers: JSON_HEADERS });

        const now = Date.now();
        const message = { from: user.username, text: trimmed, sentAt: now };
        const targetDisplayName = (targetUser.value as any).username;
        const preview = trimmed.length > 40 ? trimmed.slice(0, 40) + "..." : trimmed;

        // Get current unread count for recipient
        const recipientConv = await kv.get(["chess_conversations", targetKey, convId]);
        const currentUnread = recipientConv.value ? (recipientConv.value as any).unreadCount || 0 : 0;

        await kv.atomic()
          .set(["chess_messages", convId, now], message)
          .set(["chess_conversations", selfKey, convId], { otherUser: targetDisplayName, lastMessage: preview, lastMessageAt: now, unreadCount: 0 })
          .set(["chess_conversations", targetKey, convId], { otherUser: user.username, lastMessage: preview, lastMessageAt: now, unreadCount: currentUnread + 1 })
          .commit();

        return new Response(JSON.stringify({ message }), { headers: JSON_HEADERS });
      } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
    }
  }

  // --- Streak ---
  if (url.pathname === "/api/ojjychess/streak" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ streak: 0, todayPlayed: false, weekDays: [] }), { headers: JSON_HEADERS });
    const kv = await getKv();
    const streakData = await kv.get(["chess_streaks", user.username.toLowerCase()]);
    if (!streakData.value) return new Response(JSON.stringify({ streak: 0, todayPlayed: false, weekDays: [] }), { headers: JSON_HEADERS });
    const data = streakData.value as any;
    // Check if streak is still valid (last activity within 48 hours to account for timezone)
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const lastDate = data.lastDate || '';
    const isValid = lastDate === today || lastDate === yesterday;
    const todayPlayed = lastDate === today;
    return new Response(JSON.stringify({
      streak: isValid ? (data.streak || 0) : 0,
      todayPlayed,
      weekDays: data.weekDays || [],
    }), { headers: JSON_HEADERS });
  }

  if (url.pathname === "/api/ojjychess/streak" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ streak: 0 }), { headers: JSON_HEADERS });
    const kv = await getKv();
    const key = ["chess_streaks", user.username.toLowerCase()];
    const existing = await kv.get(key);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    let data = existing.value as any || { streak: 0, lastDate: '', weekDays: [] };
    if (data.lastDate === today) {
      // Already recorded today
      return new Response(JSON.stringify({ streak: data.streak, todayPlayed: true, weekDays: data.weekDays }), { headers: JSON_HEADERS });
    }

    if (data.lastDate === yesterday) {
      data.streak = (data.streak || 0) + 1;
    } else {
      data.streak = 1;
    }
    data.lastDate = today;

    // Track last 7 days
    if (!Array.isArray(data.weekDays)) data.weekDays = [];
    data.weekDays.push(today);
    if (data.weekDays.length > 7) data.weekDays = data.weekDays.slice(-7);

    await kv.set(key, data);
    return new Response(JSON.stringify({ streak: data.streak, todayPlayed: true, weekDays: data.weekDays }), { headers: JSON_HEADERS });
  }

  // --- Notification Settings ---
  if (url.pathname === "/api/ojjychess/settings/notifications" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    const kv = await getKv();
    const userData = await kv.get(["chess_users", user.username.toLowerCase()]);
    const settings = (userData.value as any)?.notificationSettings || { friendRequests: true, messages: true, sounds: true };
    return new Response(JSON.stringify(settings), { headers: JSON_HEADERS });
  }

  if (url.pathname === "/api/ojjychess/settings/notifications" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    try {
      const settings = await req.json();
      const kv = await getKv();
      const userKey = ["chess_users", user.username.toLowerCase()];
      const userData = await kv.get(userKey);
      if (!userData.value) return new Response(JSON.stringify({ error: "user not found" }), { status: 404, headers: JSON_HEADERS });
      await kv.set(userKey, { ...(userData.value as any), notificationSettings: {
        friendRequests: !!settings.friendRequests,
        messages: !!settings.messages,
        sounds: !!settings.sounds,
      }});
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
  }

  // --- WebSocket endpoint for online play ---
  if (url.pathname === "/api/ojjychess/ws") {
    const token = url.searchParams.get("token");
    if (!token) return new Response("Missing token", { status: 401 });
    const user = await getChessUserByToken(token);
    if (!user) return new Response("Invalid token", { status: 401 });
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket, user.username);
    return response;
  }

  // --- Game history endpoint ---
  if (url.pathname === "/api/ojjychess/games" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    const kv = await getKv();
    const games: any[] = [];
    const iter = kv.list({ prefix: ["chess_games", user.username.toLowerCase()] });
    for await (const entry of iter) {
      games.push(entry.value);
    }
    games.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
    return new Response(JSON.stringify(games.slice(0, 200)), { headers: JSON_HEADERS });
  }

  // Record a bot game
  if (url.pathname === "/api/ojjychess/games" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    try {
      const body = await req.json();
      const { white, black, winner, result, timeControl, moves, startedAt, endedAt } = body;
      if (!white || !black || !result) return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: JSON_HEADERS });
      const kv = await getKv();
      const gameId = crypto.randomUUID();
      const gameRecord = { gameId, white, black, winner: winner || null, result, timeControl: timeControl || "bot", moves: moves || [], startedAt: startedAt || Date.now(), endedAt: endedAt || Date.now() };
      await kv.set(["chess_games", user.username.toLowerCase(), gameId], gameRecord);

      // Update stats
      const userKey = ["chess_users", user.username.toLowerCase()];
      const userData = await kv.get(userKey);
      if (userData.value) {
        const uv = userData.value as any;
        const stats = uv.stats || { wins: 0, losses: 0, draws: 0 };
        const myColor = white.toLowerCase() === user.username.toLowerCase() ? "w" : "b";
        if (!winner) stats.draws++;
        else if (winner === myColor) stats.wins++;
        else stats.losses++;
        await kv.set(userKey, { ...uv, stats });
      }

      return new Response(JSON.stringify({ ok: true, gameId }), { headers: JSON_HEADERS });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
  }

  // --- Poll endpoint ---
  if (url.pathname === "/api/ojjychess/poll" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user || user.isGuest) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    const kv = await getKv();
    const selfKey = user.username.toLowerCase();

    // Update online presence (60s TTL)
    await kv.set(["chess_online", selfKey], { lastSeen: Date.now() }, { expireIn: 60000 });

    // Count unread messages
    let unreadMessages = 0;
    const convIter = kv.list({ prefix: ["chess_conversations", selfKey] });
    for await (const entry of convIter) {
      unreadMessages += (entry.value as any).unreadCount || 0;
    }

    // Count pending friend requests
    let pendingFriendRequests = 0;
    const reqIter = kv.list({ prefix: ["chess_friend_requests", selfKey] });
    for await (const entry of reqIter) {
      pendingFriendRequests++;
    }

    return new Response(JSON.stringify({ unreadMessages, pendingFriendRequests }), { headers: JSON_HEADERS });
  }

  // Check auth for everything else
  if (!isAuthenticated(req)) {
    return new Response(null, {
      status: 302,
      headers: { "Location": "/login" },
    });
  }

  // Serve actual hub page at /hub
  if (url.pathname === "/hub") {
    const token = getSessionToken(req)!;
    return new Response(buildHubPage(token), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
    });
  }

  // Landing page opens hub in about:blank
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const token = getSessionToken(req)!;
    const launcher = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ojjy's game hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a1628;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:1rem}button{padding:.8rem 2rem;border:1px solid #1e3a5f;border-radius:8px;background:#162a42;color:#e2e8f0;font-size:1.1rem;cursor:pointer;transition:background .2s,border-color .2s}button:hover{background:#1e3a5f;border-color:#2e6bbd}a{color:#2e6bbd;font-size:.9rem}</style>
</head><body>
<h1 style="font-weight:300;letter-spacing:.05em">ojjy's game hub</h1>
<button onclick="var w=window.open('about:blank','_blank');if(w){w.document.write('<!DOCTYPE html><html><head><title>ojjy\\'s game hub</title><style>*{margin:0;padding:0}html,body,iframe{width:100%;height:100%;border:none;overflow:hidden}</style></head><body><iframe src=&quot;'+window.location.origin+'/hub?token=${token}&quot; allowfullscreen></iframe></body></html>');w.document.close()}else{window.location.href='/hub'}">open in about:blank</button>
<a href="/hub">or open normally</a>
${ANTI_INSPECT}
</body></html>`;
    return new Response(launcher, {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
    });
  }

  // Serve game files statically (local first, then GitHub proxy)
  const resp = await serveDir(req, { fsRoot: "public" });

  if (resp.status === 404) {
    // File not on disk — proxy from GitHub raw content
    try {
      const ghHeaders: Record<string, string> = {};
      if (GITHUB_TOKEN) ghHeaders["Authorization"] = `token ${GITHUB_TOKEN}`;
      // raw.githubusercontent.com doesn't resolve directories to index.html
      let ghPath = url.pathname;
      if (ghPath.endsWith("/")) ghPath += "index.html";
      const ghResp = await fetch(`${GITHUB_RAW}${ghPath}`, { headers: ghHeaders });
      if (ghResp.ok) {
        const mime = getMime(ghPath);
        if (mime === "text/html") {
          const html = await ghResp.text();
          return new Response(html.replace("</head>", ANTI_INSPECT + "</head>"), {
            headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
          });
        }
        return new Response(ghResp.body, {
          headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
        });
      }
    } catch { /* fall through to 404 */ }
  }

  // Inject anti-inspect into local HTML pages
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    const html = await resp.text();
    const injected = html.replace("</head>", ANTI_INSPECT + "</head>");
    return new Response(injected, {
      status: resp.status,
      headers: { ...Object.fromEntries(resp.headers), "Cache-Control": "no-store" },
    });
  }

  // Let non-HTML game assets cache normally
  return resp;
});
