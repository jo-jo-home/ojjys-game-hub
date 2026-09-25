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
    """Read the pretty game names out of the GAMES array in server.ts.

    Parsed rather than duplicated here so the two can't drift apart.
    """
    names = {}
    with open("server.ts") as handle:
        for match in re.finditer(r'\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)"', handle.read()):
            names[match.group(1)] = match.group(2)
    return names


def entry_point(game: str, files: list[str]) -> str:
    """Pick the file a game boots from."""
    index = f"/{game}/index.html"
    if index in files:
        return index
    htmls = [f for f in files if f.endswith(".html")]
    return htmls[0] if htmls else files[0]


def main() -> None:
    names = display_names()
    games = {}
    for name in sorted(os.listdir(PUBLIC)):
        path = os.path.join(PUBLIC, name)
        if not os.path.isdir(path) or name in SKIP_DIRS:
            continue

        files, total = [], 0
        for root, _, filenames in os.walk(path):
            for filename in sorted(filenames):
                if filename in SKIP_FILES:
                    continue
                full = os.path.join(root, filename)
                files.append("/" + os.path.relpath(full, PUBLIC))
                total += os.path.getsize(full)

        if not files:
            continue

        games[name] = {
            "name": names.get(name, name),
            "entry": entry_point(name, files),
            "icon": f"/icons/{name}.png",
            "tier": TIERS.get(name, "full"),
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
