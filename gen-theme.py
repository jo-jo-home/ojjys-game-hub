#!/usr/bin/env python3
"""Regenerate the theme files from the single PRESETS table below.

    python3 gen-theme.py            # write the files
    python3 gen-theme.py --check    # exit 1 if what's committed is stale

Writes:
    public/theme.css          variables only, one block per preset
    public/theme-presets.js   window.__hubThemes, for the customize panel
    public/chess-theme.css    maps hub variables onto ojjyChess's --ct-* roles
    public/manifest.webmanifest   PWA colours, from the default preset

Colours used to live in four places: theme.css, the _czPresets swatch table in
server.ts, and two copies of the custom-theme defaults. This table is now the
only one. A preset needs five colours; the rest are derived with the same
ratios the CSS uses for custom themes, so presets and custom themes agree.

The five original presets carry their hand-tuned secondary colours as explicit
overrides, so their output is byte-identical to what shipped before.
"""

import base64
import json
import os
import sys

# --- derivation ------------------------------------------------------------
# Mirrors [data-custom="1"] in the generated CSS: same pairs, same ratios. Kept
# in step by test 5 in the plan, which diffs the two.

MIX = {
    "bg3":   ("bg2", "accent", 0.85),
    "text2": ("text", "bg", 0.82),
    "dim":   ("text", "bg", 0.52),
    "faint": ("text", "bg", 0.36),
}
OVERLAY_ALPHA = 0.55


def rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexs(t):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c))) for c in t)


def mix(a, b, ratio):
    """color-mix(in srgb, a ratio, b (1-ratio)) — srgb, so a plain lerp."""
    ca, cb = rgb(a), rgb(b)
    return hexs(tuple(ca[i] * ratio + cb[i] * (1 - ratio) for i in range(3)))


def derive(seed):
    out = dict(seed)
    for name, (a, b, ratio) in MIX.items():
        out.setdefault(name, mix(seed[a], seed[b], ratio))
    if "overlay" not in out:
        r, g, b = rgb(seed["bg"])
        out["overlay"] = f"rgba({r},{g},{b},{OVERLAY_ALPHA:g})".replace("0.", ".")
    return out


# --- the one table ---------------------------------------------------------
# kind: "dark" | "light" — picks semantic defaults and tells the hub whether a
# theme suits ojjyChess's dark-designed UI.
# Five seeds are required. Anything in `over` replaces a derived value.

def P(name, kind, bg, bg2, border, accent, text, over=None, sem=None):
    return {"name": name, "kind": kind, "seed": {
        "bg": bg, "bg2": bg2, "border": border, "accent": accent, "text": text,
    }, "over": over or {}, "sem": sem or {}}


PRESETS = {
    # --- the original five. `over` holds their existing hand-tuned values so
    # regenerating cannot change how they look for anyone already using them.
    "default": P("default", "dark", "#0a1628", "#111d2e", "#1e3a5f", "#2e6bbd", "#e2e8f0",
                 {"bg3": "#162a42", "text2": "#c8d6e5", "dim": "#64748b",
                  "faint": "#475569", "overlay": "rgba(10,22,40,.55)"}),
    "light": P("light", "light", "#f1f5fa", "#ffffff", "#cdd9e8", "#2e6bbd", "#1a2940",
               {"bg3": "#e7eef6", "text2": "#33445e", "dim": "#5d6e84",
                "faint": "#93a1b3", "overlay": "rgba(241,245,250,.55)"}),
    "midnight": P("midnight", "dark", "#08070e", "#100f1c", "#28244a", "#8b5cf6", "#e8e5f5",
                  {"bg3": "#181630", "text2": "#cfcae6", "dim": "#6e6890",
                   "faint": "#4c4768", "overlay": "rgba(8,7,14,.55)"}),
    "forest": P("forest", "dark", "#0b1410", "#122019", "#234534", "#4ade80", "#e4efe8",
                {"bg3": "#183024", "text2": "#c6d8cd", "dim": "#64806f",
                 "faint": "#46594e", "overlay": "rgba(11,20,16,.55)"}),
    "sunset": P("sunset", "dark", "#160d0a", "#221410", "#4a2d1e", "#f97316", "#f3e8e2",
                {"bg3": "#2e1c15", "text2": "#ddc9bd", "dim": "#8a7263",
                 "faint": "#5e4d42", "overlay": "rgba(22,13,10,.55)"}),

    # --- new: five seeds each, everything else derived.
    "ocean":    P("ocean", "dark", "#071a1f", "#0c262d", "#17454f", "#22d3ee", "#dff5f8"),
    "rose":     P("rose", "dark", "#1a0c14", "#26131d", "#4a2136", "#fb7185", "#fbe6ec"),
    "amber":    P("amber", "dark", "#191307", "#261d0b", "#4a3a16", "#fbbf24", "#fdf3e0"),
    "slate":    P("slate", "dark", "#101214", "#181b1f", "#2c3238", "#94a3b8", "#e6eaee"),
    "nord":     P("nord", "dark", "#2e3440", "#3b4252", "#4c566a", "#88c0d0", "#eceff4"),
    "dracula":  P("dracula", "dark", "#282a36", "#343746", "#484c62", "#bd93f9", "#f8f8f2"),
    "amoled":   P("amoled", "dark", "#000000", "#0a0a0a", "#1f1f1f", "#00e5a0", "#f2f2f2"),
    "paper":    P("paper", "light", "#f7f3ea", "#fffdf8", "#ddd4c2", "#a3672b", "#2f2a22"),
    "contrast": P("contrast", "light", "#ffffff", "#ffffff", "#000000", "#0032c8", "#000000",
                  {"text2": "#000000", "dim": "#1a1a1a", "faint": "#333333"},
                  {"ring": "#000000"}),
}

# Semantic colours: theming reaches the favourite star, danger buttons, the
# offline tile states and the starfield, none of which a theme could touch
# before. Defaults by kind; any preset can override via `sem`.
RING = "color-mix(in srgb,var(--text) 22%,transparent)"
SEMANTIC = {
    "dark":  {"star": "#f0c040", "danger": "#e05555", "danger-bg": "#2a1a1a",
              "danger-bd": "#4a2020", "ok": "#4ade80", "warn": "#e0a355",
              "onaccent": "#0a0a0a", "spark": "#ffffff", "ring": RING},
    "light": {"star": "#c98b10", "danger": "#c02626", "danger-bg": "#fbe9e9",
              "danger-bd": "#e9b4b4", "ok": "#127a3d", "warn": "#9a6410",
              "onaccent": "#ffffff", "spark": "#2b3a4a", "ring": RING},
}
SLOTS = ["bg", "bg2", "bg3", "border", "accent", "text", "text2", "dim", "faint", "overlay"]

# ojjyChess role -> hub variable. Roles are what codemod-chess-colors.py writes
# into the chess CSS as var(--ct-role, #original-literal).
CHESS_ROLES = {
    "bg": "var(--bg)", "bg2": "var(--bg2)", "bg2h": "var(--bg3)", "bg3": "var(--bg3)",
    "border": "var(--border)",
    "border2": "color-mix(in srgb,var(--border) 60%,var(--text) 40%)",
    "accent": "var(--accent)",
    "accent2": "color-mix(in srgb,var(--accent) 82%,#000 18%)",
    "text": "var(--text)", "text2": "var(--text2)", "dim": "var(--dim)",
    "danger": "var(--danger)", "star": "var(--star)", "onaccent": "var(--onaccent)",
}

BANNER = "/* Generated by gen-theme.py — do not edit by hand. */\n"


def block(selector, colours, semantic):
    pairs = [f"--{k}:{colours[k]}" for k in SLOTS]
    pairs += [f"--{k}:{v}" for k, v in semantic.items()]
    return selector + "{" + ";".join(pairs) + "}"


def build_theme_css():
    out = [BANNER,
           "/* Variables only: this file is injected into game pages, so it must not\n"
           "   contain element rules that would restyle a game. */\n"]
    for pid, p in PRESETS.items():
        colours = derive(p["seed"])
        colours.update(p["over"])
        semantic = dict(SEMANTIC[p["kind"]])
        semantic.update(p["sem"])
        # :root carries the default palette so an unknown theme still renders;
        # the explicit [data-theme="default"] means it is no longer an accident.
        sel = ':root,[data-theme="default"]' if pid == "default" else f'[data-theme="{pid}"]'
        out.append(block(sel, colours, semantic) + "\n")

    # Custom themes: the five seeds arrive as inline properties on <html>, and
    # everything else is derived here so a custom theme is never half-styled.
    # An explicit override is written inline too, and inline beats this
    # attribute selector, so overriding one slot leaves the others derived.
    out.append(
        '[data-custom="1"]{'
        "--bg3:color-mix(in srgb,var(--bg2) 85%,var(--accent) 15%);"
        "--text2:color-mix(in srgb,var(--text) 82%,var(--bg) 18%);"
        "--dim:color-mix(in srgb,var(--text) 52%,var(--bg) 48%);"
        "--faint:color-mix(in srgb,var(--text) 36%,var(--bg) 64%);"
        "--overlay:color-mix(in srgb,var(--bg) 55%,transparent);"
        "--ring:color-mix(in srgb,var(--text) 22%,transparent)}\n")
    return "".join(out)


def build_presets_js():
    presets = []
    for pid, p in PRESETS.items():
        colours = derive(p["seed"])
        colours.update(p["over"])
        presets.append({
            "id": pid, "name": p["name"], "kind": p["kind"],
            "sw": [colours["bg"], colours["bg2"], colours["accent"]],
            "colors": {k: colours[k] for k in SLOTS},
        })
    return (BANNER + "window.__hubThemes=" +
            json.dumps({"presets": presets}, separators=(",", ":")) + ";\n")


def build_chess_css():
    decls = ";".join(f"--ct-{role}:{value}" for role, value in CHESS_ROLES.items())
    return (BANNER +
            "/* Only applies when the hub sets data-chess-theme=\"hub\". With the\n"
            "   attribute absent every --ct-* is undefined and each var() in the\n"
            "   chess CSS falls back to its original literal, so the page renders\n"
            "   exactly as it did before any of this existed. */\n"
            f'html[data-chess-theme="hub"]{{{decls}}}\n'
            'html[data-chess-theme="hub"] body{background:var(--ct-bg)}\n')


def build_manifest():
    d = derive(PRESETS["default"]["seed"])
    d.update(PRESETS["default"]["over"])
    return json.dumps({
        "name": "ojjy's game hub",
        "short_name": "game hub",
        "description": "a collection of games, made by jonas:)",
        "start_url": "/hub",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "background_color": d["bg"],
        "theme_color": d["bg"],
        "icons": [
            {"src": "/icons/hub-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icons/hub-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/icons/hub-512.png", "sizes": "512x512", "type": "image/png",
             "purpose": "maskable"},
        ],
    }, indent=2) + "\n"


TARGETS = {
    "public/theme.css": build_theme_css,
    "public/theme-presets.js": build_presets_js,
    "public/chess-theme.css": build_chess_css,
    "public/manifest.webmanifest": build_manifest,
}


def main():
    check = "--check" in sys.argv
    stale = []
    for path, build in TARGETS.items():
        want = build()
        have = open(path).read() if os.path.exists(path) else None
        if check:
            if have != want:
                stale.append(path)
            continue
        if have != want:
            open(path, "w").write(want)
            print(f"  wrote   {path}  ({len(want)} B)")
        else:
            print(f"  ok      {path}")

    if check:
        if stale:
            print("stale, re-run gen-theme.py:")
            for p in stale:
                print(f"  {p}")
            sys.exit(1)
        print("all generated files are up to date")
        return

    darks = sum(1 for p in PRESETS.values() if p["kind"] == "dark")
    print(f"\n{len(PRESETS)} presets ({darks} dark, {len(PRESETS) - darks} light), "
          f"{len(SLOTS)} palette slots + {len(SEMANTIC['dark'])} semantic")


if __name__ == "__main__":
    main()
