"""Render the extension icons (a clock face with sound waves) into extension/icons/.

Needs Pillow, which is not a runtime dependency of the project:
    python3 tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 48, 128)
MASTER = 1024
BACKGROUND = (79, 70, 229, 255)
FOREGROUND = (255, 255, 255, 255)
ACCENT = (253, 224, 71, 255)


def render() -> Image.Image:
    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, MASTER - 1, MASTER - 1), radius=220, fill=BACKGROUND)

    # Clock face, shifted left to leave room for the sound waves.
    cx, cy, r = 400, 512, 270
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=FOREGROUND, width=64)
    d.line((cx, cy, cx, cy - 170), fill=FOREGROUND, width=58, joint="curve")
    d.line((cx, cy, cx + 120, cy + 70), fill=FOREGROUND, width=58, joint="curve")
    d.ellipse((cx - 40, cy - 40, cx + 40, cy + 40), fill=FOREGROUND)
    for dx, dy in ((0, -170), (120, 70)):
        d.ellipse((cx + dx - 29, cy + dy - 29, cx + dx + 29, cy + dy + 29), fill=FOREGROUND)

    # Two arcs of sound coming out of the clock.
    for radius in (390, 520):
        box = (cx - radius, cy - radius, cx + radius, cy + radius)
        d.arc(box, start=-38, end=38, fill=ACCENT, width=56)
    return img


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "extension" / "icons"
    out.mkdir(exist_ok=True)
    master = render()
    for size in SIZES:
        master.resize((size, size), Image.LANCZOS).save(out / f"icon{size}.png")


if __name__ == "__main__":
    main()
