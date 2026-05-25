#!/usr/bin/env python3
"""Generate Blyve brand icons for web PWA, favicons, and Expo native assets."""

from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ASSETS = ROOT / "assets"

BG = (0, 0, 0, 255)
FG = (255, 255, 255, 255)

FONT_CANDIDATES = [
    Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arialbd.ttf",
    Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "segoeuib.ttf",
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1]


def fit_font_size(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    max_height: int,
    start_size: int,
) -> ImageFont.ImageFont:
    size = start_size
    while size > 8:
        font = load_font(size)
        width, height = text_size(draw, text, font)
        if width <= max_width and height <= max_height:
            return font
        size -= 2
    return load_font(8)


def render_icon(size: int, text: str = "Blyve", padding_ratio: float = 0.14) -> Image.Image:
    image = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(image)

    pad = int(size * padding_ratio)
    max_w = size - pad * 2
    max_h = size - pad * 2
    font = fit_font_size(draw, text, max_w, max_h, start_size=max(12, int(size * 0.34)))

    text_w, text_h = text_size(draw, text, font)
    x = (size - text_w) // 2
    y = (size - text_h) // 2 - int(size * 0.02)
    draw.text((x, y), text, font=font, fill=FG)
    return image


def save_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, format="PNG", optimize=True)


def save_ico(path: Path, sizes: list[int]) -> None:
    images = [render_icon(size, text="B" if size <= 32 else "Blyve") for size in sizes]
    path.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(
        path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:],
    )


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)
    ASSETS.mkdir(exist_ok=True)

    outputs: list[tuple[Path, int, str]] = [
        (PUBLIC / "favicon-16x16.png", 16, "B"),
        (PUBLIC / "favicon-32x32.png", 32, "B"),
        (PUBLIC / "apple-touch-icon.png", 180, "Blyve"),
        (PUBLIC / "icon-192.png", 192, "Blyve"),
        (PUBLIC / "icon-512.png", 512, "Blyve"),
        (PUBLIC / "logoicon.png", 512, "Blyve"),
        (PUBLIC / "favicon.png", 32, "B"),
        (ASSETS / "favicon.png", 48, "B"),
        (ASSETS / "icon.png", 1024, "Blyve"),
        (ASSETS / "adaptive-icon.png", 1024, "Blyve"),
        (ASSETS / "splash.png", 1024, "Blyve"),
    ]

    for path, size, text in outputs:
        padding = 0.18 if size <= 32 else 0.14
        icon = render_icon(size, text=text, padding_ratio=padding)
        save_png(path, icon)
        print(f"Wrote {path.relative_to(ROOT)} ({size}x{size})")

    save_ico(PUBLIC / "favicon.ico", [16, 32, 48])
    print(f"Wrote {(PUBLIC / 'favicon.ico').relative_to(ROOT)}")

    # Maskable icon with extra safe-zone padding for Android adaptive icons.
    maskable = render_icon(512, text="Blyve", padding_ratio=0.22)
    save_png(PUBLIC / "icon-512-maskable.png", maskable)
    print(f"Wrote {(PUBLIC / 'icon-512-maskable.png').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
