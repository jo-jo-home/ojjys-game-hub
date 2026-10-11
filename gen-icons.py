#!/usr/bin/env python3
"""Build small, content-versioned WebP icons without replacing the PNG sources.

Requires Pillow: python3 -m pip install Pillow
Run from anywhere: python3 gen-icons.py
"""
from pathlib import Path
import hashlib
import json
from io import BytesIO
from PIL import Image

ROOT = Path(__file__).resolve().parent
ICONS = ROOT / "public/icons"
OUTPUT = ICONS / "webp"


def main():
    OUTPUT.mkdir(exist_ok=True)
    entries = {}
    before = after = 0
    for path in sorted(ICONS.glob("*.png")):
        # PWA install icons keep their required PNG dimensions and URLs.
        if path.stem in {"hub-192", "hub-512"}:
            continue
        with Image.open(path) as image:
            image = image.convert("RGBA")
            image.thumbnail((128, 128), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            image.save(buffer, format="WEBP", quality=82, method=6)
            data = buffer.getvalue()
        revision = hashlib.sha256(data).hexdigest()[:12]
        filename = f"{path.stem}-{revision}.webp"
        destination = OUTPUT / filename
        if not destination.exists() or destination.read_bytes() != data:
            destination.write_bytes(data)
        entries[path.stem] = {"webp": f"/icons/webp/{filename}"}
        before += path.stat().st_size
        after += len(data)
    manifest = {"version": 1, "icons": entries}
    (ROOT / "public/icon-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    print(f"Built {len(entries)} icons: {before / 1024:.0f} KB PNG -> {after / 1024:.0f} KB WebP "
          f"({(1 - after / before) * 100:.0f}% smaller)")


if __name__ == "__main__":
    main()
