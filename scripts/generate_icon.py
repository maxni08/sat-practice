"""Generate the original, neutral application icon. Requires Pillow (import requirements)."""
from pathlib import Path
from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
destination.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (256, 256), "#284dbd")
draw = ImageDraw.Draw(image)
# Open book, with a subtle central fold. This is not a College Board logo.
draw.polygon([(47, 64), (118, 72), (128, 84), (138, 72), (209, 64), (209, 189), (141, 192), (128, 205), (115, 192), (47, 189)], fill="white")
draw.line([(128, 84), (128, 185)], fill="#284dbd", width=7)
for y in (99, 123, 147):
    draw.line([(65, y), (106, y + 5)], fill="#a5b5e8", width=5)
    draw.line([(150, y + 5), (191, y)], fill="#a5b5e8", width=5)
image.save(destination / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
for size, filename in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(destination / filename)
