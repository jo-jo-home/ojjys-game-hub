// The customize panel: presets, user-authored themes, share codes, background.
//
// Was inline in server.ts. Moved out because it grew past the point where a
// template string is a reasonable place to keep it, and because as a file it is
// cached and precached like offline.js and cloak.js.
//
// Preset colours are NOT defined here. They come from window.__hubThemes
// (public/theme-presets.js), which gen-theme.py generates from the same table
// as public/theme.css — previously the same hexes lived in four places and had
// already drifted.
//
// Pre-paint still happens inline in server.ts's THEME_SCRIPT: styling has to be
// resolved before the first frame, which a fetched file cannot promise. That
// script also owns migrating the stored shape, so by the time this file runs the
// store is always v2.

(function () {
  "use strict";

  var KEY = "hub_theme";
  var MAX_THEMES = 24;
  var MAX_NAME = 24;
  var OVERLAY_MIX = 55; // keeps an overridden overlay a scrim, not a solid block

  // Slot -> CSS property. `card` is historical: it means --bg2.
  var SLOTS = {
    bg: "--bg", card: "--bg2", border: "--border", accent: "--accent", text: "--text",
    bg3: "--bg3", text2: "--text2", dim: "--dim", faint: "--faint", overlay: "--overlay",
  };
  var BASE = ["bg", "card", "border", "accent", "text"];
  var ADVANCED = ["bg3", "text2", "dim", "faint", "overlay"];
  // Fixed order — the share code's bitmask depends on it, so never reorder.
  var ORDER = BASE.concat(ADVANCED);
  var LABEL = {
    bg: "background", card: "card", border: "border", accent: "accent", text: "text",
    bg3: "card hover", text2: "secondary text", dim: "dim text", faint: "faint text",
    overlay: "image overlay",
  };
  var BGS = ["none", "particles", "gradient", "starfield", "shapes"];

  // Layout, typography and motion. Each is applied as a data-* attribute on
  // <html> and styled in hub.css; the default value sets no attribute at all,
  // so the stylesheet's own defaults stand.
  var PREFS = {
    density: { def: "comfortable", options: [["comfortable", "comfortable"],
      ["compact", "compact"], ["roomy", "roomy"]] },
    font: { def: "system", options: [["system", "system"], ["serif", "serif"],
      ["mono", "mono"], ["easy", "easy read"]] },
    motion: { def: "auto", options: [["auto", "follow my system"], ["off", "off"]] },
  };

  // ---- store -------------------------------------------------------------

  function get() {
    try {
      var t = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (!t || typeof t !== "object") t = {};
      t.themes = t.themes || {};
      t.order = t.order || [];
      return t;
    } catch (e) { return { themes: {}, order: [] }; }
  }

  var writeError = "";

  function set(t) {
    try {
      localStorage.setItem(KEY, JSON.stringify(t));
      writeError = "";
      return true;
    } catch (e) {
      // Usually a full quota. Say so rather than losing a theme silently.
      writeError = "couldn't save — browser storage is full";
      return false;
    }
  }

  function presets() {
    return (window.__hubThemes && window.__hubThemes.presets) || [];
  }

  function preset(id) {
    var list = presets();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }

  function activeCustom(t) {
    var a = t.active || "p:default";
    return a.slice(0, 2) === "c:" ? t.themes[a.slice(2)] || null : null;
  }

  // ---- apply -------------------------------------------------------------
  // Mirrors THEME_SCRIPT. Kept separate because that one has to be inline and
  // tiny; this one also drives the background engine and the panel.

  function apply() {
    var t = get(), de = document.documentElement;
    for (var k in SLOTS) de.style.removeProperty(SLOTS[k]);

    var custom = activeCustom(t);
    var base = custom ? (custom.base || "default") : (t.active || "p:default").slice(2);
    de.setAttribute("data-theme", base || "default");

    if (custom) {
      de.setAttribute("data-custom", "1");
      var c = custom.colors || {};
      for (var slot in SLOTS) {
        if (!c[slot]) continue;
        de.style.setProperty(SLOTS[slot],
          slot === "overlay"
            ? "color-mix(in srgb," + c[slot] + " " + OVERLAY_MIX + "%,transparent)"
            : c[slot]);
      }
    } else {
      de.removeAttribute("data-custom");
    }

    de.setAttribute("data-chess-theme", t.chess === "hub" ? "hub" : "own");

    for (var pref in PREFS) {
      var chosen = t[pref];
      if (chosen && chosen !== PREFS[pref].def) de.setAttribute("data-" + pref, chosen);
      else de.removeAttribute("data-" + pref);
    }

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var bg = getComputedStyle(de).getPropertyValue("--bg").trim();
      if (bg) meta.setAttribute("content", bg);
    }

    if (window.__hubBG) window.__hubBG(t.bg || "none");
    var ov = document.getElementById("cz-ov");
    if (ov && ov.classList.contains("open")) render();
  }

  // ---- share codes -------------------------------------------------------
  // Binary-packed rather than base64'd JSON: a five-colour theme comes out
  // around 45 characters instead of 150, which is the difference between
  // something you can paste into a chat and something you can't.
  //
  // layout: [version][bg mode][mask lo][mask hi][3 bytes per set slot]
  //         [base id length][base id][name length][name]

  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function unb64url(str) {
    try {
      var s = str.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      var raw = atob(s), out = [];
      for (var i = 0; i < raw.length; i++) out.push(raw.charCodeAt(i));
      return out;
    } catch (e) { return null; }
  }

  function encode(theme) {
    var t = get();
    var bytes = [1, Math.max(0, BGS.indexOf(t.bg || "none"))];
    var mask = 0, colours = [];
    for (var i = 0; i < ORDER.length; i++) {
      var hex = (theme.colors || {})[ORDER[i]];
      if (!hex) continue;
      mask |= (1 << i);
      var n = parseInt(hex.slice(1), 16);
      colours.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
    }
    bytes.push(mask & 255, (mask >> 8) & 255);
    bytes = bytes.concat(colours);

    var base = (theme.base || "default").slice(0, 24);
    bytes.push(base.length);
    for (i = 0; i < base.length; i++) bytes.push(base.charCodeAt(i) & 127);

    var name = String(theme.name || "theme").slice(0, MAX_NAME);
    var nb = [];
    for (i = 0; i < name.length; i++) {
      var code = name.charCodeAt(i);
      if (code >= 32 && code < 127) nb.push(code); // ascii only, keeps it short
    }
    bytes.push(nb.length);
    bytes = bytes.concat(nb);
    return "OJT1-" + b64url(bytes);
  }

  // Returns null for anything it doesn't fully understand — never throws, and
  // never half-applies a broken theme.
  function decode(code) {
    if (typeof code !== "string") return null;
    code = code.trim();
    if (code.slice(0, 5) !== "OJT1-") return null;
    var b = unb64url(code.slice(5));
    if (!b || b.length < 5 || b[0] !== 1) return null;

    var pos = 2;
    var mask = b[pos] | (b[pos + 1] << 8);
    pos += 2;

    var colors = {};
    for (var i = 0; i < ORDER.length; i++) {
      if (!(mask & (1 << i))) { colors[ORDER[i]] = null; continue; }
      if (pos + 2 >= b.length) return null;
      colors[ORDER[i]] = "#" +
        ("0" + b[pos].toString(16)).slice(-2) +
        ("0" + b[pos + 1].toString(16)).slice(-2) +
        ("0" + b[pos + 2].toString(16)).slice(-2);
      pos += 3;
    }
    // A theme with no base colours is not a theme.
    if (!colors.bg && !colors.card && !colors.text) return null;

    if (pos >= b.length) return null;
    var baseLen = b[pos++];
    if (pos + baseLen > b.length) return null;
    var base = "";
    for (i = 0; i < baseLen; i++) base += String.fromCharCode(b[pos + i]);
    pos += baseLen;
    if (!preset(base) || preset(base).id !== base) base = "default";

    var name = "theme";
    if (pos < b.length) {
      var nameLen = b[pos++];
      if (pos + nameLen <= b.length) {
        name = "";
        for (i = 0; i < nameLen; i++) {
          var code2 = b[pos + i];
          if (code2 >= 32 && code2 < 127) name += String.fromCharCode(code2);
        }
      }
    }
    // trailing bytes are ignored on purpose, so a future version degrades
    return { name: (name || "theme").slice(0, MAX_NAME), base: base, colors: colors };
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }

  // ---- background image (IndexedDB) --------------------------------------

  function idb(cb) {
    try {
      var r = indexedDB.open("hub_prefs", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onsuccess = function () { cb(r.result); };
      r.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }

  // ---- api ---------------------------------------------------------------

  var notice = "";
  var pendingDelete = null;
  var deleteTimer = null;

  function nextId(t) {
    for (var i = 1; i <= MAX_THEMES + 1; i++) if (!t.themes["c" + i]) return "c" + i;
    return null;
  }

  var api = {
    setActive: function (ref) {
      var t = get();
      t.active = ref;
      set(t);
      apply();
    },

    newFrom: function (presetId) {
      var t = get();
      if (t.order.length >= MAX_THEMES) {
        notice = "you have " + MAX_THEMES + " themes already — delete one first";
        render();
        return;
      }
      var p = preset(presetId) || preset("default");
      var id = nextId(t);
      if (!id) return;
      var colors = {};
      for (var i = 0; i < ORDER.length; i++) colors[ORDER[i]] = null;
      // Seed only the five base colours; the rest stay on auto so the new
      // theme still derives sensibly the moment a base colour changes.
      colors.bg = p.colors.bg;
      colors.card = p.colors.bg2;
      colors.border = p.colors.border;
      colors.accent = p.colors.accent;
      colors.text = p.colors.text;
      t.themes[id] = { id: id, name: p.name + " copy", base: p.id, colors: colors };
      t.order.push(id);
      t.active = "c:" + id;
      set(t);
      apply();
    },

    rename: function (id, name) {
      var t = get();
      if (!t.themes[id]) return;
      t.themes[id].name = String(name || "").slice(0, MAX_NAME) || "theme";
      set(t);
      render();
    },

    remove: function (id) {
      // Two clicks, no confirm() — a modal dialog blocks everything, including
      // a game download running in the background.
      if (pendingDelete !== id) {
        pendingDelete = id;
        clearTimeout(deleteTimer);
        deleteTimer = setTimeout(function () { pendingDelete = null; render(); }, 3000);
        render();
        return;
      }
      pendingDelete = null;
      clearTimeout(deleteTimer);
      var t = get();
      delete t.themes[id];
      t.order = t.order.filter(function (x) { return x !== id; });
      if (t.active === "c:" + id) t.active = "p:default";
      set(t);
      apply();
    },

    duplicate: function (id) {
      var t = get();
      var src = t.themes[id];
      if (!src || t.order.length >= MAX_THEMES) return;
      var nid = nextId(t);
      if (!nid) return;
      t.themes[nid] = {
        id: nid, name: (src.name + " copy").slice(0, MAX_NAME),
        base: src.base, colors: JSON.parse(JSON.stringify(src.colors)),
      };
      t.order.push(nid);
      t.active = "c:" + nid;
      set(t);
      apply();
    },

    // hex === null puts the slot back on auto (the CSS derivation)
    setSlot: function (slot, hex) {
      var t = get();
      var custom = activeCustom(t);
      if (!custom || !SLOTS[slot]) return;
      custom.colors[slot] = hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null;
      set(t);
      apply();
    },

    share: function (id) {
      var t = get();
      var theme = t.themes[id];
      if (!theme) return;
      notice = copy(encode(theme)) ? "share code copied" : "couldn't copy — " + encode(theme);
      render();
    },

    importCode: function () {
      var input = document.getElementById("cz-code");
      var parsed = decode(input ? input.value : "");
      if (!parsed) {
        notice = "that code isn't valid";
        render();
        return;
      }
      var t = get();
      if (t.order.length >= MAX_THEMES) {
        notice = "you have " + MAX_THEMES + " themes already — delete one first";
        render();
        return;
      }
      var id = nextId(t);
      if (!id) return;
      // Always a fresh local id, so importing the same code twice is two themes
      // rather than an overwrite.
      t.themes[id] = { id: id, name: parsed.name, base: parsed.base, colors: parsed.colors };
      t.order.push(id);
      t.active = "c:" + id;
      set(t);
      notice = "imported “" + parsed.name + "”";
      apply();
    },

    setPref: function (key, value) {
      if (!PREFS[key]) return;
      var t = get();
      t[key] = value;
      set(t);
      apply();
    },

    setChess: function (mode) {
      var t = get();
      t.chess = mode === "hub" ? "hub" : "own";
      set(t);
      apply();
    },

    setBG: function (m) {
      var t = get();
      t.bg = m;
      set(t);
      apply();
    },

    uploadBG: function (input) {
      var f = input.files[0];
      if (!f) return;
      idb(function (db) {
        if (!db) return;
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(f, "bgimage");
        tx.oncomplete = function () { api.setBG("image"); };
      });
      input.value = "";
    },

    removeBG: function () {
      idb(function (db) {
        if (!db) return;
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").delete("bgimage");
        tx.oncomplete = function () { api.setBG("none"); };
      });
    },

    toggleAdvanced: function () {
      var t = get();
      t.adv = !t.adv;
      set(t);
      render();
    },
  };

  // ---- panel -------------------------------------------------------------

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function swatch(sw) {
    var h = '<span class="cz-sw">';
    for (var i = 0; i < sw.length; i++) {
      h += '<span class="cz-dot" style="background:' + esc(sw[i]) + '"></span>';
    }
    return h + "</span>";
  }

  function presetRow(kind, active) {
    var list = presets(), h = "";
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.kind !== kind) continue;
      h += '<button class="cz-opt' + (active === "p:" + p.id ? " on" : "") +
        '" onclick="__hubTheme.setActive(\'p:' + p.id + '\')">' +
        swatch(p.sw) + esc(p.name) + "</button>";
    }
    return h;
  }

  function colourRows(custom, slots) {
    var h = '<div class="cz-colors">';
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var val = custom.colors[slot];
      var isAuto = !val;
      // An auto row shows the colour the derivation actually produced, so the
      // picker starts from what is on screen rather than from black.
      var shown = val || computed(SLOTS[slot]) || "#000000";
      h += '<label class="cz-color">' +
        '<input type="color" value="' + esc(shown) + '" oninput="__hubTheme.setSlot(\'' +
        slot + '\',this.value)">' + esc(LABEL[slot]) +
        (slots === ADVANCED
          ? (isAuto
            ? '<span class="cz-auto">auto</span>'
            : '<span class="cz-auto cz-reset" onclick="event.preventDefault();__hubTheme.setSlot(\'' +
              slot + '\',null)">reset</span>')
          : "") +
        "</label>";
    }
    return h + "</div>";
  }

  function computed(prop) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
      return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
    } catch (e) { return null; }
  }

  function render() {
    var el = document.getElementById("cz");
    if (!el) return;
    var t = get();
    var active = t.active || "p:default";
    var custom = activeCustom(t);

    var h = '<div class="cm-hd"><h2>customize</h2><button onclick="closeCZ()">&times;</button></div>';

    if (writeError || notice) {
      h += '<div class="cz-note">' + esc(writeError || notice) + "</div>";
      notice = "";
    }

    h += '<div class="cz-sec"><div class="cz-lbl">dark themes</div><div class="cz-row">' +
      presetRow("dark", active) + "</div></div>";
    h += '<div class="cz-sec"><div class="cz-lbl">light themes</div><div class="cz-row">' +
      presetRow("light", active) + "</div></div>";

    // my themes
    h += '<div class="cz-sec"><div class="cz-lbl">my themes</div>';
    if (!t.order.length) {
      h += '<div class="cz-lbl" style="font-size:.74rem">none yet — start one from any theme above</div>';
    }
    for (var i = 0; i < t.order.length; i++) {
      var id = t.order[i], th = t.themes[id];
      if (!th) continue;
      var on = active === "c:" + id;
      h += '<div class="cm-it"><div class="cm-it-hd">' +
        '<input class="cz-name" value="' + esc(th.name) +
        '" maxlength="' + MAX_NAME + '" onchange="__hubTheme.rename(\'' + id + '\',this.value)">' +
        '<span>' +
        '<button class="cm-it-btn" onclick="__hubTheme.setActive(\'c:' + id + '\')">' +
        (on ? "active" : "use") + "</button> " +
        '<button class="cm-it-btn" onclick="__hubTheme.share(\'' + id + '\')">share</button> ' +
        '<button class="cm-it-btn" onclick="__hubTheme.duplicate(\'' + id + '\')">copy</button> ' +
        '<button class="cm-it-btn" onclick="__hubTheme.remove(\'' + id + '\')">' +
        (pendingDelete === id ? "sure?" : "delete") + "</button>" +
        "</span></div>" +
        '<div class="cm-it-meta"><span>based on ' + esc(th.base || "default") + "</span>" +
        "<span>" + countSet(th) + " of 10 set</span></div></div>";
    }
    h += '<div class="cz-row" style="margin-top:.7rem">' +
      '<button class="cz-opt" onclick="__hubTheme.newFrom(\'' +
      (custom ? (custom.base || "default") : (active.slice(2) || "default")) +
      '\')">new from current</button>' +
      '<button class="cz-opt" onclick="__hubTheme.importCode()">paste a code</button>' +
      '</div><input class="cz-name cz-codein" id="cz-code" placeholder="OJT1-..." ' +
      'spellcheck="false" autocomplete="off"></div>';

    // editor — only meaningful while a custom theme is active
    if (custom) {
      h += '<div class="cz-sec"><div class="cz-lbl">colours</div>' +
        colourRows(custom, BASE) +
        '<div class="cz-row" style="margin-top:.8rem">' +
        '<button class="cz-opt' + (t.adv ? " on" : "") +
        '" onclick="__hubTheme.toggleAdvanced()">advanced ' + (t.adv ? "−" : "+") +
        "</button></div>" +
        (t.adv
          ? '<div class="cz-lbl" style="margin-top:.7rem;font-size:.72rem">' +
            "these are worked out from the five above unless you set them" +
            "</div>" + colourRows(custom, ADVANCED)
          : "") +
        "</div>";
    }

    // background
    var bg = t.bg || "none";
    h += '<div class="cz-sec"><div class="cz-lbl">background</div><div class="cz-row">';
    for (i = 0; i < BGS.length; i++) {
      h += '<button class="cz-opt' + (bg === BGS[i] ? " on" : "") +
        '" onclick="__hubTheme.setBG(\'' + BGS[i] + '\')">' + BGS[i] + "</button>";
    }
    h += '</div><div class="cz-row" style="margin-top:.8rem">' +
      '<button class="cz-opt' + (bg === "image" ? " on" : "") +
      '" onclick="document.getElementById(\'cz-file\').click()">upload image</button>' +
      (bg === "image"
        ? '<button class="cz-opt" onclick="__hubTheme.removeBG()">remove image</button>'
        : "") +
      '</div><input type="file" id="cz-file" class="cz-file" accept="image/*" ' +
      'onchange="__hubTheme.uploadBG(this)"></div>';

    // layout, typography, motion
    for (var pref in PREFS) {
      var chosen = t[pref] || PREFS[pref].def;
      var opts = PREFS[pref].options;
      h += '<div class="cz-sec"><div class="cz-lbl">' +
        (pref === "font" ? "text" : pref) + '</div><div class="cz-row">';
      for (i = 0; i < opts.length; i++) {
        h += '<button class="cz-opt' + (chosen === opts[i][0] ? " on" : "") +
          '" onclick="__hubTheme.setPref(\'' + pref + '\',\'' + opts[i][0] + '\')">' +
          opts[i][1] + "</button>";
      }
      h += "</div>" +
        (pref === "motion"
          ? '<div class="cz-lbl" style="margin-top:.7rem;font-size:.72rem">' +
            "off stops the animated background and all transitions. following your " +
            "system already turns them off if you've asked for reduced motion." +
            "</div>"
          : "") +
        "</div>";
    }

    // ojjyChess reach
    h += '<div class="cz-sec"><div class="cz-lbl">ojjyChess</div><div class="cz-row">' +
      '<button class="cz-opt' + (t.chess !== "hub" ? " on" : "") +
      '" onclick="__hubTheme.setChess(\'own\')">classic</button>' +
      '<button class="cz-opt' + (t.chess === "hub" ? " on" : "") +
      '" onclick="__hubTheme.setChess(\'hub\')">match this theme</button>' +
      '</div><div class="cz-lbl" style="margin-top:.7rem;font-size:.72rem">' +
      "classic keeps ojjyChess's own colours. board squares always follow its own " +
      "board setting.</div></div>";

    // cloak.js appends its section here — this hook must stay last
    el.innerHTML = h + (window.__hubCloak ? window.__hubCloak.section() : "");
  }

  function countSet(th) {
    var n = 0;
    for (var i = 0; i < ORDER.length; i++) if ((th.colors || {})[ORDER[i]]) n++;
    return n;
  }

  // Styles for the few controls the existing cz-* vocabulary didn't cover.
  var CSS = [
    ".cz-note{background:var(--bg3);border:1px solid var(--border);border-radius:10px;",
    "padding:8px 12px;margin-bottom:1rem;font-size:.8rem;color:var(--text2)}",
    ".cz-name{background:var(--bg);border:1px solid var(--border);border-radius:8px;",
    "padding:5px 9px;color:var(--text);font-size:.85rem;font-family:inherit;outline:none;",
    "max-width:11rem}",
    ".cz-name:focus{border-color:var(--accent)}",
    ".cz-codein{display:block;width:100%;max-width:none;margin-top:.7rem}",
    ".cz-auto{margin-left:auto;font-size:.7rem;color:var(--faint)}",
    ".cz-reset{cursor:pointer;color:var(--accent)}",
  ].join("");

  function injectCSS() {
    if (document.getElementById("cz-css")) return;
    var st = document.createElement("style");
    st.id = "cz-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Exposed for the share-code test; reading them costs nothing here.
  api._encode = encode;
  api._decode = decode;

  window.__hubTheme = api;
  window.renderCZ = render;          // cloak.js calls this back
  window.openCZ = function () {
    injectCSS();
    var ov = document.getElementById("cz-ov");
    if (ov) ov.classList.add("open");
    render();
  };
  window.closeCZ = function () {
    var ov = document.getElementById("cz-ov");
    if (ov) ov.classList.remove("open");
  };

  function start() {
    var ov = document.getElementById("cz-ov");
    if (ov) {
      ov.addEventListener("click", function (e) {
        if (e.target === ov) window.closeCZ();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
