"""Copies the pictures, the boot film and the mark the site uses into src/assets, sized for where they are shown.

Run from site/:  python3 scripts/prepare-assets.py <setup-screenshots-folder>
             or  ORBIT_SETUP_SHOTS=<setup-screenshots-folder> python3 scripts/prepare-assets.py
The setup screenshots (780 x 1688 PNGs, from the phone app's own mock) are not in git, so their folder is always given.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

SITE = Path(__file__).resolve().parent.parent
REPO = SITE.parent
OUT = SITE / "src" / "assets"
# The phone's setup, one screen per step, as the mock's screenshots name them.
SETUP_SCREENS = [
    "01-welcome", "02b-find-found", "03-devmode", "04-allow-waiting", "06-question-cast", "09-question-ads",
    "11-plan", "13b-installing", "14-you", "15-ready", "16-remote",
]


def shots_folder() -> Path:
    """The setup screenshots' folder, from the command line or ORBIT_SETUP_SHOTS; stops before anything is written."""
    given = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ORBIT_SETUP_SHOTS", "")
    if not given:
        sys.exit("prepare-assets: no folder of setup screenshots. Run: python3 scripts/prepare-assets.py <folder>\n"
                 "(or set ORBIT_SETUP_SHOTS=<folder>). They are the phone app's own mock, 780 x 1688 PNGs, not in git.")
    folder = Path(given).expanduser()
    if not folder.is_dir():
        sys.exit(f"prepare-assets: {folder} is not a folder. Nothing was written.")
    missing = [f"{name}.png" for name in SETUP_SCREENS if not (folder / f"{name}.png").is_file()]
    if missing:
        sys.exit(f"prepare-assets: {folder} has no {', '.join(missing)}. Nothing was written.")
    return folder


SHOTS = shots_folder()


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
for name in SETUP_SCREENS:
    webp(SHOTS / f"{name}.png", OUT / f"setup/{name}.webp", width=600, quality=80)

# The owner's boot film and a poster frame (the S mark over "Developed by Shiv"). The film in src/assets has its first
# 0.8 s cut (another company's logo), so it is only copied when it is not there yet; cut it again before committing.
film = REPO / "launcher/app/src/main/res/raw/boot_intro.mp4"
(OUT / "film").mkdir(parents=True, exist_ok=True)
if not (OUT / "film/boot-intro.mp4").exists():
    shutil.copyfile(film, OUT / "film/boot-intro.mp4")
    print("copied the film: cut its first 0.8 s before committing")
poster = OUT / "film/poster.jpg"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "4.6", "-i", str(film), "-frames:v", "1", "-q:v", "4", str(poster)], check=True)
webp(poster, OUT / "film/poster.webp", width=1280, quality=78)
poster.unlink()
print("film/boot-intro.mp4", (OUT / "film/boot-intro.mp4").stat().st_size // 1024, "KB")

# The mark.
(OUT / "brand").mkdir(parents=True, exist_ok=True)
shutil.copyfile(REPO / "work/family-room/intro/logo/shiv-mark.svg", OUT / "brand/shiv-mark.svg")
