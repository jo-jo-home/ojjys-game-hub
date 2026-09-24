// Animated background for ojjy's game hub.
//
// Was inline in server.ts on every page. Now a cached file, and reworked for
// cost, because this runs 60 times a second on school Chromebooks:
//
//   - the accent colour used to be read with getComputedStyle() twice per
//     frame, forcing ~120 style recalcs a second to re-read a value that
//     only changes when the theme does. Now cached and refreshed on change.
//   - particle linking was O(n^2): 55 particles meant 1,485 distance checks
//     per frame. A uniform grid keyed on the link radius checks only nearby
//     cells and finds exactly the same pairs.
//   - the canvas ignored devicePixelRatio, so it was upscaled and blurry on
//     every retina screen.
//   - prefers-reduced-motion was ignored entirely.
//   - particle counts are scaled to the viewport and backed off further if
//     frames are actually running slow.

(function () {
  "use strict";

  var d = document, de = d.documentElement;

  function prefs() {
    try { return JSON.parse(localStorage.getItem("hub_theme") || "{}"); } catch (e) { return {}; }
  }

  var cv = d.createElement("canvas");
  cv.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none";
  var im = d.createElement("div");
  im.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:-2;pointer-events:none;background-size:cover;background-position:center";
  d.body.insertBefore(cv, d.body.firstChild);
  d.body.insertBefore(im, cv);

  var ctx = cv.getContext("2d");
  var W = 0, H = 0, raf = null, mode = "none", items = [], shoot = null, shootAt = 0;

  // ---- colours -----------------------------------------------------------
  // Read once per theme change instead of twice per frame.

  var rgb = [46, 107, 189];
  var bgHex = "#0a1628";
  var fillDot, fillTri, strokeTri, glowIn, glowOut;

  function hex2rgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }

  function refreshColours() {
    var cs = getComputedStyle(de);
    rgb = hex2rgb(cs.getPropertyValue("--accent").trim() || "#2e6bbd");
    bgHex = cs.getPropertyValue("--bg").trim() || "#0a1628";
    // The fixed alphas can be built once; only link lines vary per pair.
    fillDot = rgba(0.55);
    fillTri = rgba(0.05);
    strokeTri = rgba(0.12);
    glowIn = rgba(0.09);
    glowOut = rgba(0);
  }

  // ---- reduced motion ----------------------------------------------------

  var rmq = null;
  try { rmq = matchMedia("(prefers-reduced-motion: reduce)"); } catch (e) { /* old browser */ }
  function reduced() { return !!(rmq && rmq.matches); }

  // ---- sizing ------------------------------------------------------------
  // W and H stay in CSS pixels so the drawing code is unchanged; the backing
  // store is scaled up and the context transformed to match. Capped at 2x —
  // 3x costs over twice the fill rate for no visible gain here.

  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  var resizeTimer = null;
  addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      size();
      if (mode === "particles" || mode === "starfield" || mode === "shapes") seed();
    }, 120);
  });

  // ---- seeding -----------------------------------------------------------
  // Counts scale with viewport area, using a 1440x900 screen as the baseline,
  // so a small laptop isn't asked to do the same work as a large monitor.

  var quality = 1;

  function scaled(base) {
    var area = (W * H) / (1440 * 900);
    return Math.max(8, Math.round(base * Math.min(Math.max(area, 0.45), 1.6) * quality));
  }

  function seed() {
    items = [];
    var i, n;
    if (mode === "particles") {
      n = scaled(55);
      for (i = 0; i < n; i++) {
        items.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          r: 1.2 + Math.random() * 1.8,
        });
      }
    } else if (mode === "starfield") {
      n = scaled(140);
      for (i = 0; i < n; i++) {
        items.push({
          x: Math.random() * W, y: Math.random() * H,
          r: 0.4 + Math.random() * 1.3, p: Math.random() * 6.28,
          s: 0.3 + Math.random() * 1.2,
        });
      }
    } else if (mode === "shapes") {
      n = scaled(11);
      for (i = 0; i < n; i++) {
        items.push({
          x: Math.random() * W, y: Math.random() * H, r: 40 + Math.random() * 90,
          vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.004,
          tri: Math.random() < 0.45,
        });
      }
    }
  }

  // ---- particle linking --------------------------------------------------
  // Link radius is 120px (14400 squared). Cells are one radius across, so any
  // pair close enough to link must share a cell or sit in one of the four
  // forward neighbours — checking those finds exactly the same pairs as the
  // full double loop, without the other ~95% of the comparisons.

  var LINK2 = 14400, CELL = 120;
  var cells = [], cols = 0, rows = 0;

  // Forward-only neighbours, so each pair is visited once.
  var NEIGHBOURS = [[1, 0], [-1, 1], [0, 1], [1, 1]];

  // Pure: given points and a viewport, returns every pair within the link
  // radius. Shared by the renderer and by the test that checks it against
  // the brute-force pairing.
  function collectPairs(list, w, h, out) {
    out.length = 0;
    cols = Math.max(1, Math.ceil(w / CELL));
    rows = Math.max(1, Math.ceil(h / CELL));
    var total = cols * rows, i, j;

    // Reuse the buckets between frames; only reset their length.
    if (cells.length < total) {
      cells = new Array(total);
      for (i = 0; i < total; i++) cells[i] = [];
    } else {
      for (i = 0; i < total; i++) cells[i].length = 0;
    }

    for (i = 0; i < list.length; i++) {
      var p = list[i];
      var cx = p.x / CELL | 0, cy = p.y / CELL | 0;
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
      cells[cy * cols + cx].push(p);
    }

    for (var cy2 = 0; cy2 < rows; cy2++) {
      for (var cx2 = 0; cx2 < cols; cx2++) {
        var a = cells[cy2 * cols + cx2];
        if (!a.length) continue;

        // within the cell
        for (i = 0; i < a.length; i++) {
          for (j = i + 1; j < a.length; j++) near(a[i], a[j], out);
        }
        // and against the forward neighbours only, so each pair is seen once
        for (var o = 0; o < NEIGHBOURS.length; o++) {
          var nx = cx2 + NEIGHBOURS[o][0], ny = cy2 + NEIGHBOURS[o][1];
          if (nx < 0 || nx >= cols || ny >= rows) continue;
          var b = cells[ny * cols + nx];
          for (i = 0; i < a.length; i++) {
            for (j = 0; j < b.length; j++) near(a[i], b[j], out);
          }
        }
      }
    }
    return out;
  }

  function near(a, b, out) {
    var dx = a.x - b.x, dy = a.y - b.y;
    if (dx * dx + dy * dy < LINK2) { out.push(a); out.push(b); }
  }

  var pairs = [];

  function linkParticles() {
    collectPairs(items, W, H, pairs);
    if (!pairs.length) return;
    // One path and one stroke for every line, rather than a pair each.
    ctx.beginPath();
    for (var i = 0; i < pairs.length; i += 2) {
      ctx.moveTo(pairs[i].x, pairs[i].y);
      ctx.lineTo(pairs[i + 1].x, pairs[i + 1].y);
    }
    ctx.strokeStyle = rgba(0.12);
    ctx.stroke();
  }

  // ---- adaptive quality --------------------------------------------------
  // If frames are genuinely slow, thin things out once rather than grinding.

  var last = 0, acc = 0, samples = 0, backoffs = 0;

  function watchCost(t) {
    if (last) {
      acc += t - last;
      samples++;
      if (samples >= 90) {
        var avg = acc / samples;
        acc = 0; samples = 0;
        if (avg > 22 && backoffs < 2) {
          backoffs++;
          quality *= 0.6;
          seed();
        }
      }
    }
    last = t;
  }

  // ---- frame -------------------------------------------------------------

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (d.hidden) { last = 0; return; }
    watchCost(t);
    ctx.clearRect(0, 0, W, H);
    var i;

    if (mode === "particles") {
      ctx.fillStyle = fillDot;
      for (i = 0; i < items.length; i++) {
        var p = items[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x += W; else if (p.x > W) p.x -= W;
        if (p.y < 0) p.y += H; else if (p.y > H) p.y -= H;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.28);
        ctx.fill();
      }
      linkParticles();
    } else if (mode === "starfield") {
      for (i = 0; i < items.length; i++) {
        var s = items[i];
        var tw = 0.35 + 0.65 * Math.abs(Math.sin(s.p + t * 0.001 * s.s));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.28);
        ctx.fillStyle = "rgba(255,255,255," + (tw * 0.8).toFixed(3) + ")";
        ctx.fill();
      }
      if (!shoot && t > shootAt) {
        shoot = { x: Math.random() * W * 0.7, y: Math.random() * H * 0.3, l: 0 };
        shootAt = t + 5e3 + Math.random() * 6e3;
      }
      if (shoot) {
        shoot.l += 14;
        var sx = shoot.x + shoot.l, sy = shoot.y + shoot.l * 0.45;
        var g = ctx.createLinearGradient(sx - 70, sy - 31, sx, sy);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(1, "rgba(255,255,255,.85)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sx - 70, sy - 31);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.lineWidth = 1;
        if (sx > W + 90 || sy > H + 90) shoot = null;
      }
    } else if (mode === "shapes") {
      for (i = 0; i < items.length; i++) {
        var h = items[i];
        h.x += h.vx; h.y += h.vy; h.rot += h.vr;
        if (h.x < -h.r) h.x = W + h.r; else if (h.x > W + h.r) h.x = -h.r;
        if (h.y < -h.r) h.y = H + h.r; else if (h.y > H + h.r) h.y = -h.r;
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(h.rot);
        if (h.tri) {
          ctx.beginPath();
          ctx.moveTo(0, -h.r);
          ctx.lineTo(h.r * 0.87, h.r * 0.5);
          ctx.lineTo(-h.r * 0.87, h.r * 0.5);
          ctx.closePath();
          ctx.fillStyle = fillTri;
          ctx.strokeStyle = strokeTri;
          ctx.fill();
          ctx.stroke();
        } else {
          var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, h.r);
          rg.addColorStop(0, glowIn);
          rg.addColorStop(1, glowOut);
          ctx.beginPath();
          ctx.arc(0, 0, h.r, 0, 6.28);
          ctx.fillStyle = rg;
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  function stopAnim() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    last = 0; acc = 0; samples = 0;
    if (W && H) ctx.clearRect(0, 0, W, H);
  }

  function setGrad(on) {
    if (on) {
      im.style.backgroundImage = "linear-gradient(120deg," + bgHex + "," + rgba(0.35) +
        "," + bgHex + "," + rgba(0.22) + "," + bgHex + ")";
      im.style.backgroundSize = "400% 400%";
      // Still a gradient when motion is reduced, just not a moving one.
      im.style.animation = reduced() ? "" : "hubgrad 28s ease infinite";
      if (reduced()) im.style.backgroundPosition = "0% 50%";
    } else {
      im.style.animation = "";
      im.style.backgroundSize = "cover";
      im.style.backgroundImage = "";
    }
  }

  function idb(cb) {
    var r = indexedDB.open("hub_prefs", 1);
    r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
    r.onsuccess = function () { cb(r.result); };
    r.onerror = function () { cb(null); };
  }

  function loadImage() {
    idb(function (db) {
      if (!db) return;
      var rq = db.transaction("kv").objectStore("kv").get("bgimage");
      rq.onsuccess = function () {
        if (!rq.result) return;
        var u = URL.createObjectURL(rq.result);
        im.style.backgroundImage = "url(" + u + ")";
        var ov = getComputedStyle(de).getPropertyValue("--overlay").trim();
        im.style.boxShadow = "inset 0 0 0 100vmax " + ov;
      };
    });
  }

  window.__hubBG = function (m) {
    mode = m;
    stopAnim();
    im.style.boxShadow = "";
    setGrad(false);
    // Called on every theme change, which is exactly when the cached colours
    // need rereading.
    refreshColours();
    quality = 1;
    backoffs = 0;

    if (m === "gradient") setGrad(true);
    else if (m === "image") loadImage();
    else if (m === "particles" || m === "starfield" || m === "shapes") {
      // Someone who asked for less motion gets a still background.
      if (reduced()) { mode = "none"; return; }
      size();
      seed();
      raf = requestAnimationFrame(frame);
    }
  };

  // The grid is the one piece here with a real chance of being subtly wrong,
  // so it is exposed for a test that compares it against the full double
  // loop. Reading it costs nothing in the browser.
  window.__hubBGInternals = { collectPairs: collectPairs, LINK2: LINK2, CELL: CELL };

  var st = d.createElement("style");
  st.textContent = "@keyframes hubgrad{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}";
  d.head.appendChild(st);

  if (rmq && rmq.addEventListener) {
    rmq.addEventListener("change", function () { window.__hubBG(prefs().bg || "none"); });
  }

  size();
  refreshColours();
  window.__hubBG(prefs().bg || "none");
})();
