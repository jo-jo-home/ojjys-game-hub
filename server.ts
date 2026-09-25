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
  ".webmanifest": "application/manifest+json",
};

// Offline mode files, served before the password check on purpose: the
// browser re-fetches sw.js periodically to look for updates, and if a cold
// isolate answered that with a redirect to /login the browser would throw
// the service worker away and offline mode would quietly stop working.
// Nothing here is secret — the game list is already on the hub page.
// The two app icons are here too: the browser reads them when offering to
// install, and an installed app's icon must not depend on a live session.
const OFFLINE_FILES: Record<string, string> = {
  "/sw.js": "application/javascript",
  "/offline.js": "application/javascript",
  "/cloak.js": "application/javascript",
  "/themes.js": "application/javascript",
  "/hub-ui.js": "application/javascript",
  "/admin.js": "application/javascript",
  "/theme-presets.js": "application/javascript",
  "/chess-theme.css": "text/css",
  "/bg.js": "application/javascript",
  "/theme.css": "text/css",
  "/hub.css": "text/css",
  "/offline-manifest.json": "application/json",
  "/manifest.webmanifest": "application/manifest+json",
  "/icons/hub-192.png": "image/png",
  "/icons/hub-512.png": "image/png",
};

// Read once per isolate and kept with a content ETag. These files can't
// change under a running deployment, so there is no reason to touch the disk
// or rehash them per request.
type StaticFile = { body: Uint8Array<ArrayBuffer>; etag: string };
const staticFiles = new Map<string, StaticFile>();
async function getStaticFile(path: string): Promise<StaticFile> {
  const hit = staticFiles.get(path);
  if (hit) return hit;
  const body = await Deno.readFile(`public${path}`);
  const digest = await crypto.subtle.digest("SHA-1", body);
  const etag = `"${Array.from(new Uint8Array(digest)).slice(0, 10)
    .map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
  const entry = { body, etag };
  staticFiles.set(path, entry);
  return entry;
}

// The commit sha offline downloads are pinned to. Branch refs on
// raw.githubusercontent.com have been seen to 404 for files that resolve
// fine by sha, and a sha also stops a push mid-download from mixing two
// versions of a game together. Cached for an hour per isolate.
let _rev = { sha: "", at: 0 };
async function getRev(): Promise<string> {
  if (_rev.sha && Date.now() - _rev.at < 3600_000) return _rev.sha;
  try {
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "ojjys-game-hub",
    };
    if (GITHUB_TOKEN) headers["Authorization"] = `token ${GITHUB_TOKEN}`;
    const resp = await fetch(
      "https://api.github.com/repos/jo-jo-home/ojjys-game-hub/commits/master",
      { headers },
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.sha) _rev = { sha: data.sha, at: Date.now() };
    }
  } catch { /* keep whatever we had */ }
  return _rev.sha || "master";
}

function getMime(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? (MIME[path.substring(i).toLowerCase()] || "application/octet-stream") : "application/octet-stream";
}

const JSON_CT = { "Content-Type": "application/json" };

// Sent on every HTML page. Session tokens travel in ?token= on /hub URLs,
// and no-referrer stops that URL being handed to any third party a game
// happens to load (ads, analytics, fonts) in a Referer header.
const HTML_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const PASSWORD_HASH = "1779c0ce5c9ca5c69110d3853843a70e797bf3264fbeafa6c65de398fb423b4c";

// Sessions live in KV, not in memory. Deno Deploy starts and stops isolates
// freely and runs several at once, so an in-memory Set meant everyone was
// logged out whenever that happened, and a login on one isolate was not
// recognised by another.
// A day was too short: the cookie was never refreshed, so everybody was
// logged out roughly 24 hours after signing in, which reads as "it logs me
// out at random". It is a month now, and it slides — every page load pushes
// it forward, so only real inactivity ends a session.
const SESSION_TTL_MS = 30 * 86_400_000; // matches the cookie's Max-Age

// A page pulls hundreds of files and every one passes the auth check, so
// tokens verified against KV are remembered briefly to keep that to one read
// rather than one per request.
const SESSION_CACHE_MS = 60_000;
// `at` is when they signed in and fixes the expiry; `seen` is the last time
// they loaded a page, which is what tells the panel who is actually here.
type SessionInfo = { at: number; code: string; label: string; role: string; seen?: number };
const SEEN_INTERVAL_MS = 300_000;   // don't write KV more often than this
const verifiedSessions = new Map<string, { at: number; info: SessionInfo }>();

// ---- who has access -------------------------------------------------------
//
// The hub had one shared password and sessions recorded nothing but a
// timestamp, so every visitor was indistinguishable: there was no way to see
// who was using it and no way to remove one person without changing the
// password for everybody.
//
// Access is now a set of codes, one per person, each with a label only the
// owner sees. KV holds a hash of the code, never the code itself, so a dump of
// the database does not hand out access.
//
//   ["hub_codes", sha256(code)]        { label, role, createdAt, revokedAt,
//                                        lastSeen, opens }
//   ["hub_sessions", token]            { at, code, label, role, seen }
//   ["hub_activity", ts, code, row]    { game, label }   expires on its own
//
// Activity is keyed by time first because KV sorts by the whole key: with the
// code first, "the newest rows" would mean the newest rows of whichever code
// sorts last, not the newest overall.
//
// The old shared password still works, as a built-in code labelled "shared
// password", so nothing breaks the day this ships. It can be switched off from
// the admin panel once everyone has their own.
const ACTIVITY_TTL_MS = 14 * 86_400_000;
const SHARED_CODE = "shared";

// Set ADMIN_CODE in the deployment's environment to bootstrap. It is checked
// directly rather than stored, so the first admin needs no seeded database,
// and it keeps working even if every code in KV is revoked.
const ADMIN_CODE = Deno.env.get("ADMIN_CODE") || "";

type CodeRecord = {
  label: string;
  role: "user" | "admin";
  createdAt: number;
  revokedAt: number | null;
  lastSeen: number;
  opens: number;
};

// No 0/O/1/I/L: these get read aloud and typed by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i % 4 === 3 && i < 15) out += "-";
  }
  return out;   // e.g. 7K2P-QW9F-MN3T-XR6B
}

function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function getCode(hash: string): Promise<CodeRecord | null> {
  const entry = await (await getKv()).get<CodeRecord>(["hub_codes", hash]);
  return entry.value ?? null;
}

async function touchCode(hash: string, opened: boolean): Promise<void> {
  if (hash === SHARED_CODE || hash === "owner") return;   // not KV-backed
  const record = await getCode(hash);
  if (!record) return;
  record.lastSeen = Date.now();
  if (opened) record.opens = (record.opens || 0) + 1;
  await (await getKv()).set(["hub_codes", hash], record);
}

// Is the built-in shared password still accepted? Cached briefly, and it
// answers "yes" if the database cannot be reached: the alternative is that a
// KV hiccup locks every single person out of the site at once. The cost of
// failing this way round is that a freshly retired password may keep working
// for up to a minute.
// Short, because retiring the shared password should take effect now rather
// than eventually. The isolate that makes the change clears it immediately;
// this window only applies to the others.
const SHARED_FLAG_CACHE_MS = 10_000;
let sharedFlag: { at: number; on: boolean } | null = null;
async function sharedPasswordEnabled(): Promise<boolean> {
  if (sharedFlag && Date.now() - sharedFlag.at < SHARED_FLAG_CACHE_MS) return sharedFlag.on;
  try {
    const entry = await (await getKv()).get<{ off: boolean }>(["hub_settings", "shared"]);
    sharedFlag = { at: Date.now(), on: !entry.value?.off };
    return sharedFlag.on;
  } catch {
    return sharedFlag ? sharedFlag.on : true;
  }
}

// Resolves what was typed into the login box. Returns null when it is not
// anything we accept.
async function identify(input: string): Promise<SessionInfo | null> {
  const typed = input.trim();
  if (!typed) return null;

  // the bootstrap owner code, straight from the environment
  if (ADMIN_CODE && normaliseCode(typed) === normaliseCode(ADMIN_CODE)) {
    return { at: Date.now(), code: "owner", label: "owner", role: "admin" };
  }

  // The original shared password, unless it has been retired. Checked before
  // the code lookup because it is pure computation: until this was reordered,
  // signing in with the password everyone already uses depended on two
  // database reads that the old code never needed, so a KV blip looked
  // exactly like "the password stopped working".
  if ((await sha256(typed)) === PASSWORD_HASH && await sharedPasswordEnabled()) {
    return { at: Date.now(), code: SHARED_CODE, label: "shared password", role: "user" };
  }

  // a minted access code
  try {
    const hash = await sha256(normaliseCode(typed));
    const record = await getCode(hash);
    if (record && !record.revokedAt) {
      return { at: Date.now(), code: hash, label: record.label, role: record.role };
    }
  } catch { /* unreachable database: fall through rather than reject the login */ }

  return null;
}

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

function sessionCookie(token: string): string {
  return `session=${token}; Path=/; HttpOnly; SameSite=None; Secure; ` +
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

async function addSession(token: string, info: SessionInfo): Promise<void> {
  await (await getKv()).set(["hub_sessions", token], info, {
    expireIn: SESSION_TTL_MS,
  });
  verifiedSessions.set(token, { at: Date.now(), info });
}

async function readSession(token: string): Promise<SessionInfo | null> {
  const seen = verifiedSessions.get(token);
  if (seen && Date.now() - seen.at < SESSION_CACHE_MS) return seen.info;
  const entry = await (await getKv()).get<SessionInfo>(["hub_sessions", token]);
  if (!entry.value) {
    verifiedSessions.delete(token);
    return null;
  }
  // Sessions created before access codes existed hold only { at }, so fill in
  // the gaps rather than logging those people out.
  const info: SessionInfo = {
    at: entry.value.at || Date.now(),
    code: entry.value.code || SHARED_CODE,
    label: entry.value.label || "shared password",
    role: entry.value.role || "user",
    seen: entry.value.seen || entry.value.at || undefined,
  };
  verifiedSessions.set(token, { at: Date.now(), info });
  return info;
}

// Records that this session is still being used, and pushes its expiry out.
// Rate-limited, and it never throws: nothing about a request should fail
// because the bookkeeping did.
async function touchSession(req: Request): Promise<void> {
  let token: string | null = null;
  let info: SessionInfo | null = null;
  try {
    token = await getSessionToken(req);
    info = token ? await readSession(token) : null;
  } catch { return; }
  if (!token || !info) return;
  const now = Date.now();
  if (now - (info.seen || info.at) < SEEN_INTERVAL_MS) return;
  info.seen = now;
  try {
    // A full window from now, not what was left of the old one: the session
    // should end after a month of not being used, not a month after signing in.
    await (await getKv()).set(["hub_sessions", token], info, { expireIn: SESSION_TTL_MS });
    verifiedSessions.set(token, { at: now, info });
  } catch { /* the heartbeat is never worth failing a request over */ }
}

async function hasSession(token: string): Promise<boolean> {
  return (await readSession(token)) !== null;
}

// The identity behind a request, or null when there isn't one.
async function getSession(req: Request): Promise<SessionInfo | null> {
  const token = await getSessionToken(req);
  return token ? await readSession(token) : null;
}

async function isAdmin(req: Request): Promise<boolean> {
  const info = await getSession(req);
  return info?.role === "admin";
}

async function getSessionToken(req: Request): Promise<string | null> {
  const cookie = getSessionFromCookie(req);
  if (cookie && await hasSession(cookie)) return cookie;
  const url = new URL(req.url);
  const param = url.searchParams.get("token");
  // Checked against the same shape as the cookie so a junk query string
  // can't turn into a KV lookup.
  if (param && /^[a-f0-9]{64}$/.test(param) && await hasSession(param)) return param;
  return null;
}

async function isAuthenticated(req: Request): Promise<boolean> {
  return (await getSessionToken(req)) !== null;
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

// Applied before first paint so the real title never flashes. Deliberately
// inline and tiny rather than part of cloak.js, which would load too late.
// The stored value already holds the resolved title and favicon, so this
// needs no knowledge of the presets. Games set their own titles at various
// points, hence the head observer and the short burst of retries.
const CLOAK_SCRIPT = `<script>(function(){try{
var c=JSON.parse(localStorage.getItem('hub_cloak')||'null');if(!c||!c.title)return;
var ic=c.icon||'data:,',link=null;
function ap(){if(document.title!==c.title)document.title=c.title;
if(!link||!link.parentNode){link=document.querySelector("link[rel~='icon']");
if(!link){link=document.createElement('link');link.rel='icon';(document.head||document.documentElement).appendChild(link)}}
if(link.getAttribute('href')!==ic)link.setAttribute('href',ic)}
ap();document.addEventListener('DOMContentLoaded',ap);
var n=0,iv=setInterval(function(){ap();if(++n>40)clearInterval(iv)},250);
if(window.MutationObserver&&document.head)new MutationObserver(ap).observe(document.head,{childList:true,subtree:true,characterData:true});
}catch(e){}})();</script>`;


// ===== Theme engine (client-side customization, shared by login/landing/hub) =====

// Pre-paint: applies saved theme before first render to avoid flash
// Runs before the first paint on every page, and on the ojjyChess page via the
// game-HTML injection. It owns two jobs nothing else can do this early:
// migrating the stored shape to v2, and resolving the active theme to
// attributes plus inline properties. Everything after it can assume v2.
const THEME_SCRIPT = `<script>(function(){try{
var K='hub_theme',de=document.documentElement,t=null;
try{t=JSON.parse(localStorage.getItem(K)||'null')}catch(e){}
if(!t||typeof t!=='object')t={};
if(t.v!==2){var o=t,th={},ac='p:default';
if(o.preset==='custom'&&o.colors){var q=o.colors;th.c1={id:'c1',name:'custom',base:'default',colors:{bg:q.bg||null,card:q.card||null,border:q.border||null,accent:q.accent||null,text:q.text||null,bg3:null,text2:null,dim:null,faint:null,overlay:null}};ac='c:c1'}
else if(o.preset&&o.preset!=='custom')ac='p:'+o.preset;
t={v:2,active:ac,bg:o.bg||'none',chess:o.chess||'own',adv:false,order:Object.keys(th),themes:th};
try{localStorage.setItem(K,JSON.stringify(t))}catch(e){}}
var M={bg:'--bg',card:'--bg2',border:'--border',accent:'--accent',text:'--text',bg3:'--bg3',text2:'--text2',dim:'--dim',faint:'--faint',overlay:'--overlay'};
var a=t.active||'p:default',cu=a.slice(0,2)==='c:'?(t.themes||{})[a.slice(2)]||null:null;
de.setAttribute('data-theme',(cu?cu.base:a.slice(2))||'default');
if(cu){de.setAttribute('data-custom','1');var c=cu.colors||{};for(var k in M)if(c[k])de.style.setProperty(M[k],k==='overlay'?'color-mix(in srgb,'+c[k]+' 55%,transparent)':c[k])}else de.removeAttribute('data-custom');
de.setAttribute('data-chess-theme',t.chess==='hub'?'hub':'own');
var D={density:'comfortable',font:'system',motion:'auto'};for(var g in D){if(t[g]&&t[g]!==D[g])de.setAttribute('data-'+g,t[g]);else de.removeAttribute('data-'+g)}
var mt=document.querySelector('meta[name="theme-color"]');
if(mt){var bg=getComputedStyle(de).getPropertyValue('--bg').trim();if(bg)mt.setAttribute('content',bg)}
}catch(e){}})();</script>`;

// Extra <head> content for games we own and therefore can theme. Keyed on the
// first path segment, deliberately a whitelist: theme.css is variables-only
// (no element rules), but injecting stylesheets into a third-party game is
// still not something to do blindly.
//
// ojjyChess's own CSS now reads var(--ct-*, #original). Those variables are
// only defined by chess-theme.css under html[data-chess-theme="hub"], which
// THEME_SCRIPT sets when the user turns the toggle on. Off — the default —
// every fallback is the colour that was always there.
const THEMED_GAMES: Record<string, string> = {
  ojjyChess: '<link rel="stylesheet" href="/theme.css">' +
    '<link rel="stylesheet" href="/chess-theme.css">' + THEME_SCRIPT,
};

function extraHead(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0] || "";
  return THEMED_GAMES[seg] || "";
}

// Animated background engine: canvas modes + gradient + custom image (IndexedDB)

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>not found</title>
<link rel="stylesheet" href="/theme.css">
${THEME_SCRIPT}
<style>html{background:var(--bg)}body{background:transparent}*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:var(--text2);text-align:center}div{max-width:320px;padding:2rem}h1{font-size:1.4rem;font-weight:300;color:var(--text);letter-spacing:.03em;margin-bottom:.7rem}p{font-size:.9rem;color:var(--dim);line-height:1.55;margin-bottom:1.4rem}a{display:inline-block;padding:.6rem 1.4rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-size:.9rem;text-decoration:none;transition:border-color .2s}a:hover{border-color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}</style>
</head>
<body><div>
<h1>nothing here</h1>
<p>that page doesn't exist. it may have been a game that moved.</p>
<a href="/hub">back to the hub</a>
</div>
${ANTI_INSPECT}
</body>
</html>`;

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ojjy's game hub</title>
<link rel="stylesheet" href="/theme.css">
${THEME_SCRIPT}
${CLOAK_SCRIPT}
<style>html{background:var(--bg)}body{background:transparent}@keyframes fin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:var(--text2);min-height:100vh;display:flex;align-items:center;justify-content:center}.l{background:color-mix(in srgb,var(--bg2) 85%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:16px;padding:2.5rem;width:100%;max-width:360px;text-align:center;animation:fin .5s ease}h1{font-size:1.8rem;font-weight:300;color:var(--text);letter-spacing:.05em;margin-bottom:1.5rem}input[type="password"]{display:block;width:100%;padding:.7rem 1rem;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-size:1rem;outline:none;margin-bottom:1rem;transition:border-color .2s,box-shadow .2s}input[type="password"]:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}input[type="password"]::placeholder{color:var(--faint)}button{width:100%;padding:.7rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-size:1rem;cursor:pointer;transition:background .2s,border-color .2s,transform .15s}button:hover{background:var(--border);border-color:var(--accent);transform:translateY(-1px)}.e{color:var(--danger);font-size:.85rem;margin-bottom:1rem;display:none}</style>
</head>
<body>
<form class="l" method="POST" action="/login">
<h1>ojjy's game hub</h1>
<p class="e" id="e">wrong password</p>
<input type="password" name="password" placeholder="enter password..." autofocus autocomplete="current-password">
<button type="submit">enter</button>
</form>
${ANTI_INSPECT}
<script src="/bg.js"></script>
<script>if(location.search.includes('wrong=1'))document.getElementById('e').style.display='block';</script>
</body>
</html>`;

// Simple line icons for the header controls. Inline so they need no request
// and inherit the button's colour, and stroked rather than filled so they read
// at the same weight as the text beside them.
function navIcon(body: string): string {
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const NAV_ICONS: Record<string, string> = {
  // four tiles
  apps: navIcon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  // a gamepad
  games: navIcon('<path d="M7 12h4M9 10v4M15.5 11.5h.01M18 14h.01"/><rect x="2" y="6" width="20" height="12" rx="5"/>'),
  // sliders
  customize: navIcon('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  // download into a tray, matching the tile control
  offline: navIcon('<path d="M12 4v10M8 10l4 4 4-4M4 20h16"/>'),
  // a key
  admin: navIcon('<circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v4M20.5 12v3"/>'),
  // stacked drives
  storage: navIcon('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
};

// Apps live under /apps/<id>/ and get their own page at /apps. They are kept
// separate from GAMES so the two catalogues can never collide on a name, and
// so the offline downloader — which walks the top level of public/ — does not
// treat 400 MB of emulators as a game.
const APPS = [
  { id: "calculator", name: "Calculator", desc: "a calculator, nothing more", icon: false },
  { id: "etchasketch", name: "Etch A Sketch", desc: "draw, then shake to erase", icon: false },
  { id: "htmlcoder", name: "HTML Coder", desc: "write html, see it live", icon: false },
  { id: "zipopener", name: "Zip Opener", desc: "look inside a zip file", icon: false },
  { id: "weavesilk", name: "Weave Silk", desc: "draw symmetrical light", icon: false },
  { id: "fluidsim", name: "WebGL Fluids", desc: "smear colour through fluid", icon: false },
  { id: "thirtydollarwebsite", name: "Thirty Dollar Website", desc: "build beats out of emoji", icon: false },
  { id: "turbowarp", name: "TurboWarp", desc: "scratch, but much faster", icon: false },
  { id: "turbowarppkg", name: "TurboWarp Packager", desc: "turn a project into a page", icon: false },
  { id: "turbowarpunpkg", name: "TurboWarp Unpackager", desc: "pull a packaged project apart", icon: false },
  { id: "godoblocks", name: "GodoBlocks", desc: "block coding in godot", icon: false },
  { id: "ruffle", name: "Ruffle", desc: "run old flash files", icon: false },
  { id: "emulatorjs", name: "EmulatorJS", desc: "play console roms in a tab", icon: false },
  { id: "webretro", name: "webRetro", desc: "retroarch in the browser", icon: false },
  { id: "v86", name: "Virtual x86", desc: "boot linux or windows 98", icon: false },
  { id: "windows11", name: "Windows 11", desc: "a windows 11 lookalike", icon: false },
];

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
  { id: "resentclient", name: "Resent Client", desc: "eaglercraft pvp client", icon: true },
  { id: "basketrandom", name: "Basket Random", desc: "ragdoll basketball", icon: false },
  { id: "funnyshooter2", name: "Funny Shooter 2", desc: "ragdoll shooting chaos", icon: false },
  { id: "holeio", name: "Hole.io", desc: "swallow the whole city", icon: false },
  { id: "polytrack", name: "PolyTrack", desc: "low-poly time trials", icon: false },
  { id: "retrobowlcollege", name: "Retro Bowl College", desc: "coach the college team", icon: false },
  { id: "boxelrebound", name: "Boxel Rebound", desc: "bounce through the gaps", icon: false },
  { id: "chromedino", name: "Chrome Dino", desc: "the no-internet dinosaur", icon: false },
  { id: "clusterrush", name: "Cluster Rush", desc: "leap between the trucks", icon: false },
  { id: "cupcake2048", name: "Cupcake 2048", desc: "merge the cupcakes", icon: false },
  { id: "deathrun3d", name: "Death Run 3D", desc: "dodge the neon walls", icon: false },
  { id: "doodlejump", name: "Doodle Jump", desc: "bounce ever upward", icon: false },
  { id: "flappybird", name: "Flappy Bird", desc: "mind the pipes", icon: false },
  { id: "hexgl", name: "HexGL", desc: "futuristic hover racing", icon: false },
];

// The apps page. Deliberately the same shell as the hub — same stylesheet,
// same theme and cloak scripts, same card markup — so a theme, a disguise or a
// density setting applies to both without any extra work. Apps have no
// favourites and no offline downloads, so they get neither control.
// The admin panel. Same shell as the hub so it inherits the theme, and the
// same cm-* card styles the other panels use. All of its data comes from
// /api/admin/state; nothing about who has access is baked into the HTML.
function buildAdminPage(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>admin</title>
<link rel="stylesheet" href="/theme.css">
${THEME_SCRIPT}
${CLOAK_SCRIPT}
<link rel="stylesheet" href="/hub.css">
<meta name="theme-color" content="#0a1628">
<style>
.ad{max-width:860px;margin:0 auto;padding:0 1.5rem 3rem}
.ad h2{font-size:1rem;font-weight:500;color:var(--text);margin:2rem 0 .9rem;letter-spacing:.02em}
.ad table{width:100%;border-collapse:collapse;font-size:.85rem}
.ad th{text-align:left;font-weight:500;color:var(--faint);font-size:.75rem;
letter-spacing:.04em;padding:0 .7rem .5rem 0;border-bottom:1px solid var(--border)}
.ad td{padding:.6rem .7rem .6rem 0;border-bottom:1px solid var(--border);color:var(--text2)}
.ad tr:last-child td{border-bottom:none}
.ad .who{color:var(--text)}
.ad .dim{color:var(--faint);font-size:.78rem}
.ad .on{color:var(--ok)}
.ad .gone{color:var(--faint);text-decoration:line-through}
.ad .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:.9rem 0}
.ad input[type=text]{background:var(--bg);border:1px solid var(--border);border-radius:9px;
padding:7px 11px;color:var(--text);font:inherit;font-size:.85rem;outline:none}
.ad input[type=text]:focus{border-color:var(--accent)}
.ad .new{background:var(--bg3);border:1px solid var(--accent);border-radius:12px;
padding:1rem 1.2rem;margin:1rem 0;display:none}
.ad .new.show{display:block}
.ad .new code{display:block;font-size:1.3rem;letter-spacing:.06em;color:var(--text);
margin:.5rem 0 .3rem;user-select:all}
.ad .bar{height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;min-width:60px}
.ad .bar i{display:block;height:100%;background:var(--accent)}
</style>
</head>
<body data-scope="admin">
<header><h1>admin</h1><p>who has access, and what they're playing</p>
<div class="hdr-btns"><a class="stg-btn" href="/hub?token=${token}">${NAV_ICONS.games}back</a></div></header>
<div class="ad" id="ad">loading...</div>
${ANTI_INSPECT}
<script src="/admin.js"></script>
<script src="/bg.js"></script>
</body>
</html>`;
}

function buildAppsPage(token: string): string {
  const cards = APPS.map(a => {
    const iconHtml = a.icon
      ? `<img src="/icons/app-${a.id}.png" alt="${a.name}" width="64" height="64" loading="lazy" decoding="async">`
      : "";
    return `<a href="/apps/${a.id}/" class="gc" data-n="${a.id}">${iconHtml}<h2>${a.name}</h2><p>${a.desc}</p></a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ojjy's apps</title>
<link rel="stylesheet" href="/theme.css">
${THEME_SCRIPT}
${CLOAK_SCRIPT}
<link rel="stylesheet" href="/hub.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a1628">
</head>
<body data-scope="app">
<header><h1>ojjy's apps</h1><p>tools and emulators, ${APPS.length} of them</p><div class="hdr-btns"><a class="stg-btn" href="/hub?token=${token}">${NAV_ICONS.games}games</a><button type="button" class="stg-btn" onclick="openCZ()">${NAV_ICONS.customize}customize</button><button type="button" class="stg-btn" onclick="window.__hubOffline&&window.__hubOffline.open()">${NAV_ICONS.offline}offline</button></div></header>
<main>
<input type="text" class="sr" id="s" placeholder="search ${APPS.length} apps..." autocomplete="off" aria-label="search apps">
<div class="gg" id="g">${cards}</div>
</main>
<footer>made by Jonas Lee</footer>
<div class="cm-ov" id="cz-ov"><div class="cm" id="cz"></div></div>
${ANTI_INSPECT}
<script>
var _t='${token}';
document.querySelectorAll('.gc').forEach(function(c){c.addEventListener('click',function(e){e.preventDefault();var u=window.location.origin+c.getAttribute('href')+'?token='+_t;if(window.__hubCloak)window.__hubCloak.openIframe(u,true);else window.location.href=u})});
</script>
<script src="/theme-presets.js"></script>
<script src="/themes.js"></script>
<script src="/hub-ui.js"></script>
<script src="/cloak.js"></script>
<script src="/offline.js"></script>
<script src="/bg.js"></script>
</body>
</html>`;
}

function buildHubPage(token: string, admin = false): string {
  const cards = GAMES.map(g => {
    const iconHtml = g.icon ? `<img src="/icons/${g.id}.png" alt="${g.name}" width="64" height="64" loading="lazy" decoding="async">` : "";
    return `<a href="/${g.id}/" class="gc" data-n="${g.id}"><button type="button" class="sb" data-g="${g.id}" aria-pressed="false" aria-label="add ${g.name} to favourites">&#9734;</button>${iconHtml}<h2>${g.name}</h2><p>${g.desc}</p></a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ojjy's game hub</title>
<link rel="stylesheet" href="/theme.css">
${THEME_SCRIPT}
${CLOAK_SCRIPT}
<link rel="stylesheet" href="/hub.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a1628">
</head>
<body data-scope="game">
<header><h1>ojjy's game hub</h1><p>a collection of games, made by jonas:)</p><div class="hdr-btns">${admin ? `<a class="stg-btn" href="/admin?token=${token}">${NAV_ICONS.admin}admin</a>` : ""}<a class="stg-btn" href="/apps?token=${token}">${NAV_ICONS.apps}apps</a><button type="button" class="stg-btn" onclick="openCZ()">${NAV_ICONS.customize}customize</button><button type="button" class="stg-btn" onclick="window.__hubOffline&&window.__hubOffline.open()">${NAV_ICONS.offline}offline</button><button type="button" class="stg-btn" onclick="openCM()">${NAV_ICONS.storage}storage</button></div></header>
<main>
<input type="text" class="sr" id="s" placeholder="search ${GAMES.length} games..." autocomplete="off" aria-label="search games">
<div class="gg" id="g">${cards}</div>
</main>
<footer>made by Jonas Lee</footer>
<div class="cm-ov" id="cm-ov"><div class="cm" id="cm"></div></div>
<div class="cm-ov" id="cz-ov"><div class="cm" id="cz"></div></div>
${ANTI_INSPECT}
<script src="/bg.js"></script>
<script>
var _t='${token}';
var _0x=[JSON.parse(localStorage.getItem('favorites')||'[]'),document.getElementById('g'),document.getElementById('s'),[].slice.call(document.querySelectorAll('.gc')).map(function(c){return c.dataset.n})];
function _r(){document.querySelectorAll('.sb').forEach(function(b){var c=b.closest('.gc'),n=c.dataset.n,t=(c.querySelector('h2')||{}).textContent||n,f=_0x[0].includes(n);if(f){b.classList.add('a');b.innerHTML='\\u2605'}else{b.classList.remove('a');b.innerHTML='\\u2606'}b.setAttribute('aria-pressed',f?'true':'false');b.setAttribute('aria-label',(f?'remove ':'add ')+t+(f?' from favourites':' to favourites'))})}
function _s(){var c=[].slice.call(_0x[1].children);var o=_0x[3];c.sort(function(a,b){var af=_0x[0].includes(a.dataset.n)?0:1;var bf=_0x[0].includes(b.dataset.n)?0:1;if(af!==bf)return af-bf;return o.indexOf(a.dataset.n)-o.indexOf(b.dataset.n)});c.forEach(function(x){_0x[1].appendChild(x)})}
document.querySelectorAll('.sb').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var n=b.dataset.g,i=_0x[0].indexOf(n);if(i>=0)_0x[0].splice(i,1);else _0x[0].push(n);localStorage.setItem('favorites',JSON.stringify(_0x[0]));_r();_s()})});
document.querySelectorAll('.gc').forEach(function(c){c.addEventListener('click',function(e){if(e.target.closest('.sb')||e.target.closest('.ob'))return;e.preventDefault();var u=window.location.origin+c.getAttribute('href')+'?token='+_t;if(window.__hubCloak)window.__hubCloak.openIframe(u,true);else window.location.href=u})});

_r();_s();
var _km={
'favorites':'hub favorites','ojjychess_token':'ojjyChess','hub_theme':'hub settings',
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
var _cim={'_C2SaveStates':'OvO','localforage':'OvO','IDBFS':'Space Waves','firebaseLocalStorageDb':'Rocket Goal IO','hub_prefs':'hub settings'};
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
<script src="/theme-presets.js"></script>
<script src="/themes.js"></script>
<script src="/hub-ui.js"></script>
<script src="/cloak.js"></script>
<script src="/offline.js"></script>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Handle login POST
  if (url.pathname === "/login" && req.method === "POST") {
    const form = await req.formData();
    const password = form.get("password") as string || "";
    const info = await identify(password);
    if (info) {
      const token = generateToken();
      await addSession(token, info);
      await touchCode(info.code, false);
      // The token goes in the URL as well as the cookie. Games open inside an
      // about:blank wrapper, and a cookie set in that context is a third-party
      // cookie as far as Chrome is concerned — on a managed Chromebook it gets
      // dropped, and the only symptom is being bounced straight back to the
      // login screen as though the password were wrong. Every route already
      // accepts ?token=, so this makes signing in work either way.
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `/?token=${token}`,
          "Set-Cookie": sessionCookie(token),
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
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store", ...HTML_HEADERS },
    });
  }

  // --- Offline mode (before the auth check, see OFFLINE_FILES) ---
  if (OFFLINE_FILES[url.pathname]) {
    try {
      const file = await getStaticFile(url.pathname);
      // no-cache, not no-store: the browser must check with us before reusing
      // these, but an ETag turns that check into a 304 instead of a fresh
      // download. Without it, no-cache means re-sending every byte on every
      // load, which would make extracting these files pointless.
      if (req.headers.get("if-none-match") === file.etag) {
        return new Response(null, {
          status: 304,
          headers: { "ETag": file.etag, "Cache-Control": "no-cache" },
        });
      }
      return new Response(file.body, {
        headers: {
          "Content-Type": OFFLINE_FILES[url.pathname],
          "Cache-Control": "no-cache",
          "ETag": file.etag,
        },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  // Recorded when a game or app is opened, so the admin panel can show who is
  // playing what. Keyed by code, and KV expires each row on its own after a
  // fortnight — this is meant to show recent patterns, not keep a permanent
  // log of anybody.
  if (url.pathname === "/api/played" && req.method === "POST") {
    const info = await getSession(req);
    if (!info) return new Response("{}", { headers: JSON_CT });
    let game = "";
    try {
      game = String(((await req.json()) || {}).id || "").slice(0, 64);
    } catch { /* malformed body, nothing to record */ }
    if (/^[A-Za-z0-9_-]+$/.test(game)) {
      const now = Date.now();
      // The timestamp comes FIRST in the key. KV sorts by the whole key, so
      // keying by code first would make a reverse listing "newest row of the
      // last code", not "newest row overall" — the panel would show one
      // person's history and call it everyone's. The code is still in the key
      // to keep two people opening something in the same millisecond distinct.
      // A random tail keeps two opens in the same millisecond from sharing a
      // key and silently overwriting each other — easy to hit, because a
      // double click or a second tab reports twice in a row.
      const row = crypto.randomUUID().slice(0, 8);
      await (await getKv()).set(["hub_activity", now, info.code, row], {
        game,
        label: info.label,
      }, { expireIn: ACTIVITY_TTL_MS });
      await touchCode(info.code, true);
    }
    return new Response("{}", { headers: JSON_CT });
  }

  // ---- admin ----
  // Every one of these 404s for anyone who isn't an admin, rather than
  // answering 403, so the panel doesn't announce itself.
  if (url.pathname.startsWith("/api/admin/") || url.pathname === "/admin") {
    if (!await isAdmin(req)) return new Response("Not Found", { status: 404 });
    const kv = await getKv();

    if (url.pathname === "/admin") {
      return new Response(buildAdminPage((await getSessionToken(req))!), {
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store", ...HTML_HEADERS },
      });
    }

    if (url.pathname === "/api/admin/state") {
      const codes: unknown[] = [];
      for await (const entry of kv.list<CodeRecord>({ prefix: ["hub_codes"] })) {
        codes.push({ hash: entry.key[1], ...entry.value });
      }

      // recent opens, newest first
      const activity: unknown[] = [];
      const tally: Record<string, number> = {};
      const week = Date.now() - 7 * 86_400_000;
      for await (const entry of kv.list<{ game: string; label: string }>(
        { prefix: ["hub_activity"] }, { reverse: true, limit: 400 },
      )) {
        const at = Number(entry.key[1]);
        activity.push({ code: String(entry.key[2]), at, ...entry.value });
        if (at >= week) tally[entry.value.game] = (tally[entry.value.game] || 0) + 1;
      }

      // sessions still alive, so "who is on right now" is real
      const online: Record<string, number> = {};
      for await (const entry of kv.list<SessionInfo>({ prefix: ["hub_sessions"] })) {
        const v = entry.value;
        if (!v) continue;
        const code = v.code || SHARED_CODE;
        online[code] = Math.max(online[code] || 0, v.seen || v.at || 0);
      }

      return new Response(JSON.stringify({
        codes, activity: activity.slice(0, 120), online,
        top: Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12),
        sharedEnabled: await sharedPasswordEnabled(),
      }), { headers: { ...JSON_CT, "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/api/admin/code" && req.method === "POST") {
      let label = "";
      try {
        label = String(((await req.json()) || {}).label || "").trim().slice(0, 40);
      } catch { /* fall through to the default */ }
      const code = generateCode();
      const record: CodeRecord = {
        label: label || "unnamed",
        role: "user",
        createdAt: Date.now(),
        revokedAt: null,
        lastSeen: 0,
        opens: 0,
      };
      await kv.set(["hub_codes", await sha256(normaliseCode(code))], record);
      // Shown once. Only the hash is stored, so it cannot be recovered later.
      return new Response(JSON.stringify({ code, label: record.label }), {
        headers: JSON_CT,
      });
    }

    if (url.pathname === "/api/admin/revoke" && req.method === "POST") {
      let hash = "";
      try {
        hash = String(((await req.json()) || {}).hash || "");
      } catch { /* nothing to do */ }
      if (hash === SHARED_CODE) {
        await kv.set(["hub_settings", "shared"], { off: true });
        sharedFlag = null;
      } else if (/^[a-f0-9]{64}$/.test(hash)) {
        const record = await getCode(hash);
        if (record) {
          record.revokedAt = Date.now();
          await kv.set(["hub_codes", hash], record);
        }
        // Sessions already issued to that code have to go too, or revoking
        // only takes effect when their cookie expires.
        for await (const entry of kv.list<SessionInfo>({ prefix: ["hub_sessions"] })) {
          if (entry.value?.code === hash) {
            await kv.delete(entry.key);
            verifiedSessions.delete(String(entry.key[1]));
          }
        }
      }
      return new Response("{}", { headers: JSON_CT });
    }

    if (url.pathname === "/api/admin/shared" && req.method === "POST") {
      let on = true;
      try {
        on = !!((await req.json()) || {}).on;
      } catch { /* default to leaving it on */ }
      await kv.set(["hub_settings", "shared"], { off: !on });
      sharedFlag = null;
      return new Response("{}", { headers: JSON_CT });
    }

    return new Response("Not Found", { status: 404 });
  }

  // Is this session still good? Deliberately answers rather than redirecting,
  // and lives under /api/ so the service worker passes it straight to the
  // network — a cached answer would defeat the point.
  if (url.pathname === "/api/session") {
    const info = await getSession(req);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    if (info) {
      await touchSession(req);
      // Re-issued on every page load so the browser's copy never ages out
      // while the session is still in use.
      const token = await getSessionToken(req);
      if (token) headers["Set-Cookie"] = sessionCookie(token);
    }
    // `admin` is here so the panel — and whoever is setting ADMIN_CODE up —
    // can tell an unset environment variable apart from a broken panel. It
    // says nothing a session doesn't already know about itself.
    return new Response(JSON.stringify({ ok: !!info, admin: info?.role === "admin" }), {
      headers,
    });
  }

  // The <head> content this server injects into a game page. A downloaded copy
  // is fetched raw from GitHub and so never passes through that injection; the
  // downloader asks for this once and inserts it itself. A few hundred bytes,
  // so it costs no meaningful bandwidth.
  if (url.pathname === "/api/offline/head") {
    const game = (url.searchParams.get("game") || "").replace(/[^A-Za-z0-9_-]/g, "");
    return new Response(ANTI_INSPECT + CLOAK_SCRIPT + (THEMED_GAMES[game] || ""), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  // Commit sha that the offline downloader pins raw.githubusercontent.com
  // URLs to. Tiny response, so this costs effectively no bandwidth.
  if (url.pathname === "/api/offline/rev") {
    return new Response(JSON.stringify({ rev: await getRev() }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
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

  // --- Puzzle stats ---
  if (url.pathname === "/api/ojjychess/puzzles/stats" && req.method === "GET") {
    const user = await getChessUser(req);
    if (!user) return new Response(JSON.stringify({ xp: 0, streak: 0 }), { headers: JSON_HEADERS });
    const kv = await getKv();
    const data = await kv.get(["chess_puzzle_stats", user.username.toLowerCase()]);
    const stats = (data.value as any) || { xp: 0, streak: 0 };
    return new Response(JSON.stringify(stats), { headers: JSON_HEADERS });
  }

  // --- Puzzle result ---
  if (url.pathname === "/api/ojjychess/puzzles/result" && req.method === "POST") {
    const user = await getChessUser(req);
    if (!user) return new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: JSON_HEADERS });
    try {
      const { solved, rating } = await req.json();
      const r = typeof rating === "number" ? rating : 500;
      const kv = await getKv();
      const key = ["chess_puzzle_stats", user.username.toLowerCase()];
      const existing = await kv.get(key);
      const stats = (existing.value as any) || { xp: 0, streak: 0, solved: 0, attempted: 0 };

      // XP scales with difficulty: easy puzzles give more XP, hard puzzles give less but cost more on fail
      // Gain: 20 - floor(rating/100), clamped to [3, 18]
      // Loss: floor(rating/200) + 1, clamped to [2, 10]
      const gain = Math.max(3, Math.min(18, 20 - Math.floor(r / 100)));
      const loss = Math.max(2, Math.min(10, Math.floor(r / 200) + 1));

      stats.attempted = (stats.attempted || 0) + 1;
      if (solved) {
        stats.xp = (stats.xp || 0) + gain;
        stats.streak = (stats.streak || 0) + 1;
        stats.solved = (stats.solved || 0) + 1;
      } else {
        stats.xp = Math.max(0, (stats.xp || 0) - loss);
        stats.streak = 0;
      }

      await kv.set(key, stats);
      return new Response(JSON.stringify(stats), { headers: JSON_HEADERS });
    } catch { return new Response(JSON.stringify({ error: "invalid request" }), { status: 400, headers: JSON_HEADERS }); }
  }

  // --- Puzzle leaderboard ---
  if (url.pathname === "/api/ojjychess/puzzles/leaderboard" && req.method === "GET") {
    const kv = await getKv();
    const entries: any[] = [];
    const iter = kv.list({ prefix: ["chess_puzzle_stats"] });
    for await (const entry of iter) {
      const val = entry.value as any;
      const username = (entry.key[1] as string);
      // Only include users with XP > 0
      if (val && val.xp > 0) {
        // Look up display name from user record
        const userRecord = await kv.get(["chess_users", username]);
        const displayName = userRecord.value ? (userRecord.value as any).username : username;
        entries.push({ username: displayName, xp: val.xp, solved: val.solved || 0 });
      }
    }
    entries.sort((a: any, b: any) => b.xp - a.xp);
    return new Response(JSON.stringify(entries.slice(0, 25)), { headers: JSON_HEADERS });
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
  if (!await isAuthenticated(req)) {
    return new Response(null, {
      status: 302,
      headers: { "Location": "/login" },
    });
  }

  // Serve actual hub page at /hub
  if (url.pathname === "/apps") {
    const token = (await getSessionToken(req))!;
    return new Response(buildAppsPage(token), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store", ...HTML_HEADERS },
    });
  }

  if (url.pathname === "/hub") {
    const token = (await getSessionToken(req))!;
    return new Response(buildHubPage(token, await isAdmin(req)), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store", ...HTML_HEADERS },
    });
  }

  // Landing page opens hub in about:blank
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const token = (await getSessionToken(req))!;
    const launcher = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ojjy's game hub</title>
<link rel="stylesheet" href="/theme.css">
${THEME_SCRIPT}
${CLOAK_SCRIPT}
<style>html{background:var(--bg)}body{background:transparent}@keyframes fin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}*{margin:0;padding:0;box-sizing:border-box}body{color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:1rem}h1{font-weight:300;letter-spacing:.05em;animation:fin .5s ease}button{padding:.8rem 2rem;border:1px solid var(--border);border-radius:12px;background:var(--bg3);color:var(--text);font-size:1.1rem;cursor:pointer;transition:background .2s,border-color .2s,transform .15s}button:hover{background:var(--border);border-color:var(--accent);transform:translateY(-1px)}a{color:var(--accent);font-size:.9rem}</style>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a1628">
</head><body>
<h1>ojjy's game hub</h1>
<button onclick="window.__hubCloak?window.__hubCloak.openBlank('${token}'):(window.location.href='/hub')">open in about:blank</button>
<a href="/hub">or open normally</a>
${ANTI_INSPECT}
<script src="/bg.js"></script>
<script src="/cloak.js"></script>
<script src="/offline.js"></script>
</body></html>`;
    return new Response(launcher, {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store", ...HTML_HEADERS },
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
          return new Response(html.replace("</head>", ANTI_INSPECT + CLOAK_SCRIPT + extraHead(url.pathname) + "</head>"), {
            headers: { "Content-Type": "text/html", "Cache-Control": "no-store", ...HTML_HEADERS },
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
    const injected = html.replace("</head>", ANTI_INSPECT + CLOAK_SCRIPT + extraHead(url.pathname) + "</head>");
    const hdrs = new Headers(resp.headers);
    hdrs.delete("content-length");
    hdrs.set("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(HTML_HEADERS)) hdrs.set(k, v);
    return new Response(injected, { status: resp.status, headers: hdrs });
  }

  // A missed navigation used to land on serveDir's plain-text "Not Found".
  // Anything that isn't a page — a missing sprite, say — keeps that, because a
  // styled HTML body in place of an image is worse than a bare 404.
  if (resp.status === 404 && (req.headers.get("accept") || "").includes("text/html")) {
    return new Response(NOT_FOUND_PAGE, {
      status: 404,
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store", ...HTML_HEADERS },
    });
  }

  // Let non-HTML game assets cache normally
  return resp;
});
