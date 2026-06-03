import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

const PASSWORD_HASH = "1779c0ce5c9ca5c69110d3853843a70e797bf3264fbeafa6c65de398fb423b4c";
const sessions = new Set<string>();

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
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background-color:#0a1628;color:#c8d6e5;min-height:100vh;display:flex;flex-direction:column}header{text-align:center;padding:3rem 1rem 2rem}header h1{font-size:2.4rem;font-weight:300;color:#e2e8f0;letter-spacing:.05em}header p{margin-top:.5rem;font-size:.95rem;color:#64748b}main{flex:1;max-width:900px;width:100%;margin:0 auto;padding:2rem 1.5rem}.sr{display:block;width:100%;max-width:400px;margin:0 auto 2rem;padding:.7rem 1rem;border:1px solid #1e3a5f;border-radius:8px;background:#111d2e;color:#e2e8f0;font-size:1rem;outline:none}.sr:focus{border-color:#2e6bbd}.sr::placeholder{color:#475569}.gg{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1.2rem}.gc{background:#111d2e;border:1px solid #1e3a5f;border-radius:12px;padding:2rem 1.5rem;text-align:center;text-decoration:none;color:#c8d6e5;transition:background .2s,border-color .2s;position:relative}.gc:hover{background:#162a42;border-color:#2e6bbd}.gc img{width:64px;height:64px;object-fit:contain;margin-bottom:.8rem}.gc h2{font-size:1.15rem;font-weight:500;color:#e2e8f0}.gc p{margin-top:.4rem;font-size:.85rem;color:#64748b}.sb{position:absolute;top:8px;right:8px;background:none;border:none;font-size:1.2rem;cursor:pointer;color:#475569;line-height:1;padding:4px}.sb:hover{color:#f0c040}.sb.a{color:#f0c040}footer{text-align:center;padding:2rem 1rem;font-size:.85rem;color:#475569;border-top:1px solid #1e293b}</style>
</head>
<body>
<header><h1>ojjy's game hub</h1><p>a collection of games, made by jonas:)</p></header>
<main>
<input type="text" class="sr" id="s" placeholder="search ${GAMES.length} games..." autocomplete="off">
<div class="gg" id="g">${cards}</div>
</main>
<footer>made by Jonas Lee</footer>
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

  // Serve game files statically
  const resp = await serveDir(req, { fsRoot: "public" });

  // Inject anti-inspect into game HTML pages
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
