"""Copies the pictures, the boot film and the mark the site uses into src/assets, sized for where they are shown.

Run from site/:  python3 scripts/prepare-assets.py [path-to-setup-screenshots]
The setup screenshots (780 x 1688, from the phone app's own mock) are not in git; pass their folder if they move.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

SITE = Path(__file__).resolve().parent.parent
REPO = SITE.parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "/private/tmp/claude-501/-Users-shiv-Downloads-Neon-Option-Chain/aaeb0250-dd76-41fe-8d7e-f1b8c33113ac/scratchpad/setup-shots"
)
OUT = SITE / "src" / "assets"


def webp(src: Path, dst: Path, width: int | None = None, quality: int = 80) -> None:
    im = Image.open(src).convert("RGB")
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=quality, method=6)
    print(f"{dst.relative_to(SITE)}  {im.width}x{im.height}  {dst.stat().st_size // 1024} KB")


# The TV: Orbit Home and the Control Center, as photographed from the TV itself.
webp(REPO / "docs/assets/home.jpg", OUT / "img/home.webp", quality=84)
webp(REPO / "docs/assets/control-center.jpg", OUT / "img/control-center.webp", quality=80)

# The phone's setup, one screen per step (shown about 300 px wide, so 600 px covers a 2x screen).
for name in [
    "01-welcome", "02b-find-found", "03-devmode", "04-allow-waiting", "06-question-cast", "09-question-ads",
    "11-plan", "13b-installing", "14-you", "15-ready", "16-remote",
]:
    webp(SHOTS / f"{name}.png", OUT / f"setup/{name}.webp", width=600, quality=80)

# The owner's boot film, untouched, and a poster frame (the S mark over "Developed by Shiv").
film = REPO / "launcher/app/src/main/res/raw/boot_intro.mp4"
(OUT / "film").mkdir(parents=True, exist_ok=True)
shutil.copyfile(film, OUT / "film/boot-intro.mp4")
poster = OUT / "film/poster.jpg"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "4.6", "-i", str(film), "-frames:v", "1", "-q:v", "4", str(poster)], check=True)
webp(poster, OUT / "film/poster.webp", width=1280, quality=78)
poster.unlink()
print("film/boot-intro.mp4", (OUT / "film/boot-intro.mp4").stat().st_size // 1024, "KB")

# The mark.
(OUT / "brand").mkdir(parents=True, exist_ok=True)
shutil.copyfile(REPO / "work/family-room/intro/logo/shiv-mark.svg", OUT / "brand/shiv-mark.svg")
