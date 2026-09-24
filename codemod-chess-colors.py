#!/usr/bin/env python3
"""Rewrite ojjyChess's hardcoded colours as themeable variables.

    python3 codemod-chess-colors.py           # apply
    python3 codemod-chess-colors.py --check   # exit 1 if anything is unconverted

Each mapped literal becomes var(--ct-role, #original). The fallback is the
colour that was already there, so with the hub's data-chess-theme attribute
absent — which is the default — every one of these resolves to exactly what it
resolved to before, and the page is pixel-identical. chess-theme.css only
defines --ct-* under html[data-chess-theme="hub"].

Deliberately limited:

  * Only css/ui.css and css/social.css. board.css is left alone: its square,
    last-move and check colours are game signals, not chrome, and the squares
    already have their own --sq-light/--sq-dark system driven by
    ojjyChess/js/settings.js.
  * #fff and the neutral greys #333/#555/#666 are NOT mapped. #fff is used both
    for a white label sitting on a green button (which wants --ct-onaccent and
    must not follow the theme's text colour) and for bright text on a dark
    panel (which does want --ct-text). Automating that split is how a light
    theme ends up with invisible button labels, so those are done by hand.

Idempotent: already-converted var(--ct-…, #…) spans are skipped, so running it
twice does not nest.
"""

import os
import re
import sys

FILES = ["public/ojjyChess/css/ui.css", "public/ojjyChess/css/social.css"]

# literal -> role. Roles must exist in gen-theme.py's CHESS_ROLES.
MAP = {
    "#1a1917": "bg", "#1a1916": "bg",
    "#262421": "bg2",
    "#302e2b": "bg2h", "#312e2b": "bg2h", "#2b2926": "bg2h",
    "#2a2825": "bg2h", "#3c3b39": "bg2h",
    "#4a4845": "bg3",
    "#3a3a3a": "border",
    "#5a5855": "border2", "#6a6865": "border2", "#6b6966": "border2",
    "#e0e0e0": "text",
    "#bababa": "text2", "#bebdb9": "text2",
    "#8b8987": "dim", "#9e9e9e": "dim", "#888": "dim", "#888888": "dim",
    "#81b64c": "accent",
    "#6fa33e": "accent2", "#6a9e3f": "accent2",
    "#e04040": "danger", "#e74c3c": "danger",
    "#e8c040": "star",
}

# The accent at partial opacity, used for glows and hover scrims.
ACCENT_RGB = "129,182,76"

HEX = re.compile(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b")
ACCENT_RGBA = re.compile(r"rgba\(\s*" + ACCENT_RGB.replace(",", r"\s*,\s*") + r"\s*,\s*([0-9.]+)\s*\)")
# Spans already converted, so a second run leaves them alone.
CONVERTED = re.compile(r"var\(--ct-[a-z0-9]+,[^)]*\)")


def convert_span(text, counts):
    def hex_sub(m):
        lit = m.group(0)
        role = MAP.get(lit.lower())
        if not role:
            return lit
        counts[role] = counts.get(role, 0) + 1
        # The fallback keeps the literal exactly as written.
        return f"var(--ct-{role},{lit})"

    def rgba_sub(m):
        alpha = m.group(1)
        counts["accent-scrim"] = counts.get("accent-scrim", 0) + 1
        pct = float(alpha) * 100
        pct = f"{pct:g}"
        return f"color-mix(in srgb,var(--ct-accent,#81b64c) {pct}%,transparent)"

    # Hexes first. The other way round, the #81b64c that rgba_sub writes into
    # its color-mix() fallback gets picked up by the hex pass and wrapped a
    # second time, giving var(--ct-accent,var(--ct-accent,#81b64c)).
    text = HEX.sub(hex_sub, text)
    return ACCENT_RGBA.sub(rgba_sub, text)


def transform(text, counts):
    out, last = [], 0
    for m in CONVERTED.finditer(text):
        out.append(convert_span(text[last:m.start()], counts))
        out.append(m.group(0))
        last = m.end()
    out.append(convert_span(text[last:], counts))
    return "".join(out)


def main():
    check = "--check" in sys.argv
    total = {}
    changed = []

    for path in FILES:
        if not os.path.exists(path):
            print(f"  missing {path}")
            sys.exit(1)
        before = open(path).read()
        counts = {}
        after = transform(before, counts)
        for k, v in counts.items():
            total[k] = total.get(k, 0) + v

        if after == before:
            print(f"  ok      {path}")
            continue
        changed.append(path)
        if not check:
            open(path, "w").write(after)
            print(f"  wrote   {path}  ({sum(counts.values())} replacements)")

    if check:
        if changed:
            print("unconverted colours remain in:")
            for p in changed:
                print(f"  {p}")
            sys.exit(1)
        print("chess colours are fully converted")
        return

    print()
    for role in sorted(total):
        print(f"  --ct-{role:<12} {total[role]:>4}")
    print(f"\n  {sum(total.values())} literals now themeable across {len(FILES)} files")
    print("  board.css untouched; #fff and neutral greys left for the manual pass")


if __name__ == "__main__":
    main()
