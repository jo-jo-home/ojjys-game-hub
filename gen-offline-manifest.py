#!/usr/bin/env python3
"""Regenerate public/offline-manifest.json from the contents of public/.

Run this after adding, removing or updating a game:

    python3 gen-offline-manifest.py

The manifest lists every file each game needs so the offline downloader
knows what to fetch. Files are pulled from raw.githubusercontent.com at
runtime, so the manifest only has to agree with what is committed.

Tiers describe how well a game survives with no network:
  full      - no external runtime dependencies, works completely
  degraded  - only ads/analytics/fonts are external, they just fail
  partial   - single player works, online features need the server
  online    - needs the network to play at all: multiplayer, or a runtime
              (like the Ruffle flash emulator) that is loaded cross-origin
"""

import json
import os
import re

PUBLIC = "public"
# "apps" holds the app catalogue, which has its own page and no offline
# downloads — without this it would be catalogued as one 400 MB "game".
SKIP_DIRS = {"icons", "apps"}
SKIP_FILES = {".DS_Store"}

# Apps live under public/apps/ and are catalogued alongside the games with a
# "kind" so each page's panel shows only its own. Four of them load their real
# machinery from a CDN and so cannot work offline at all:
#   htmlcoder           its whole editor comes from jsdelivr/cdnjs/jquery
#   thirtydollarwebsite jquery and jquery-ui from googleapis and cdnjs
#   ruffle              injects the flash player from unpkg at runtime
#   emulatorjs          cores come from cdn.emulatorjs.org
APP_TIERS = {
    "calculator": "full",
    "emulatorjs": "online",
    "etchasketch": "full",
    "fluidsim": "full",
    "godoblocks": "full",
    "htmlcoder": "online",
    "ruffle": "online",
    "thirtydollarwebsite": "online",
    # turbowarp pulls a tutorial video from wistia; the editor itself is local
    "turbowarp": "degraded",
    "turbowarppkg": "full",
    "turbowarpunpkg": "full",
    "v86": "full",
    "weavesilk": "full",
    "webretro": "full",
    "windows11": "full",
    "zipopener": "full",
}

TIERS = {
    "basketrandom": "full",
    "boxelrebound": "full",
    "chromedino": "degraded",
    "clusterrush": "full",
    "cupcake2048": "degraded",
    "deathrun3d": "full",
    "doodlejump": "full",
    "flappybird": "full",
    "hexgl": "full",
    "bitlife": "degraded",
    "chess": "degraded",
    "cookieclicker": "degraded",
    "coreball": "full",
    "crossyroadspace": "full",
    "driftboss": "degraded",
    "drifthunters": "full",
    "drivemad": "full",
    "ducklife1": "full",
    "ducklife2": "full",
    "ducklife3": "full",
    "ducklife4": "full",
    # Ducklife 5 is the odd one out: 1-4 and 6 ship Unity WebGL builds and run
    # from local files, but 5 is a bare .swf played through Ruffle, which it
    # loads from unpkg.com. No emulator, no game — so downloading it cannot
    # make it work offline and the hub should not offer to.
    "ducklife5": "online",
    "ducklife6": "full",
    "funnyshooter2": "degraded",
    "fallguys": "degraded",
    "geometrydash": "full",
    "geometrydashlite": "degraded",
    "gettingoverit": "full",
    "gladihoppers": "full",
    "holeio": "degraded",
    "leveldevil": "full",
    "motox3m": "degraded",
    "ngon": "degraded",
    "ojjyChess": "partial",
    "ojjyclient": "partial",
    "ovo": "degraded",
    "polytrack": "degraded",
    "resentclient": "online",
    "retrobowl": "full",
    "retrobowlcollege": "degraded",
    "rocketgoalio": "online",
    "spacewaves": "full",
    "stickmanhook": "full",
    "subwayssurfersny": "full",
}


def display_names() -> dict[str, str]:
    """Read the pretty names out of the GAMES and APPS arrays in server.ts.

    Parsed rather than duplicated here so the two can't drift apart.
    """
    names = {}
    with open("server.ts") as handle:
        for match in re.finditer(r'\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"', handle.read()):
            names[match.group(1)] = match.group(2)
    return names


def entry_point(prefix: str, files: list[str]) -> str:
    """Pick the file something boots from."""
    index = f"{prefix}/index.html"
    if index in files:
        return index
    htmls = [f for f in files if f.endswith(".html")]
    return htmls[0] if htmls else files[0]


def collect(path: str) -> tuple[list[str], int]:
    """Every file under path, as URLs relative to public/, plus the total size."""
    files, total = [], 0
    for root, _, filenames in os.walk(path):
        for filename in sorted(filenames):
            if filename in SKIP_FILES:
                continue
            full = os.path.join(root, filename)
            files.append("/" + os.path.relpath(full, PUBLIC))
            total += os.path.getsize(full)
    return files, total


def main() -> None:
    names = display_names()
    games = {}

    for name in sorted(os.listdir(PUBLIC)):
        path = os.path.join(PUBLIC, name)
        if not os.path.isdir(path) or name in SKIP_DIRS:
            continue
        files, total = collect(path)
        if not files:
            continue
        games[name] = {
            "name": names.get(name, name),
            "kind": "game",
            "entry": entry_point(f"/{name}", files),
            "icon": f"/icons/{name}.png",
            "tier": TIERS.get(name, "full"),
            "bytes": total,
            "files": files,
        }

    # Apps share the catalogue so the downloader, the service worker and the
    # panel need no second code path; "kind" is what keeps each page's panel
    # showing only its own list. Ids are guaranteed not to collide by the
    # catalogue drift test.
    apps_dir = os.path.join(PUBLIC, "apps")
    if os.path.isdir(apps_dir):
        for name in sorted(os.listdir(apps_dir)):
            path = os.path.join(apps_dir, name)
            if not os.path.isdir(path):
                continue
            files, total = collect(path)
            if not files:
                continue
            games[name] = {
                "name": names.get(name, name),
                "kind": "app",
                "entry": entry_point(f"/apps/{name}", files),
                "icon": f"/icons/app-{name}.png",
                "tier": APP_TIERS.get(name, "full"),
                "bytes": total,
                "files": files,
            }

    manifest = {"version": 1, "games": games}
    out = os.path.join(PUBLIC, "offline-manifest.json")
    with open(out, "w") as handle:
        json.dump(manifest, handle, separators=(",", ":"), sort_keys=True)

    urls = sum(len(g["files"]) for g in games.values())
    size = sum(g["bytes"] for g in games.values())
    print(f"wrote {out}")
    print(f"  {len(games)} games, {urls} urls, {size / 1048576:.0f} MB catalogued")
    print(f"  manifest is {os.path.getsize(out) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
