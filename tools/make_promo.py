"""Render the 440x280 Chrome Web Store promo tile into docs/store/.

Needs Pillow and DejaVu Sans (not runtime dependencies of the project):
    python3 tools/make_promo.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
SCALE = 2
W, H = 440 * SCALE, 280 * SCALE
BACKGROUND = (79, 70, 229)
ACCENT = (253, 224, 71)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size * SCALE)


def main() -> None:
    img = Image.new("RGB", (W, H), BACKGROUND)
    d = ImageDraw.Draw(img)

    icon = Image.open(ROOT / "extension" / "icons" / "icon128.png").resize((112 * SCALE, 112 * SCALE), Image.LANCZOS)
    img.paste(icon, (36 * SCALE, 40 * SCALE), icon)

    d.text((168 * SCALE, 52 * SCALE), "Speech", font=font("DejaVuSans-Bold.ttf", 30), fill="white")
    d.text((168 * SCALE, 90 * SCALE), "Clock Dub", font=font("DejaVuSans-Bold.ttf", 30), fill="white")
    d.text((36 * SCALE, 182 * SCALE), "The video follows the voice.", font=font("DejaVuSans-Bold.ttf", 21), fill=ACCENT)
    d.text((36 * SCALE, 218 * SCALE), "Dub YouTube lectures with your own LLM and TTS", font=font("DejaVuSans.ttf", 14), fill="white")

    out = ROOT / "docs" / "store" / "promo-tile.png"
    img.resize((440, 280), Image.LANCZOS).save(out)


if __name__ == "__main__":
    main()
