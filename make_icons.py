#!/usr/bin/env python3
"""icons/icon.svg と同じモチーフ（ノート＋チェック）を Pillow で描き、PNG 3種を生成する。

実行:
    /Users/torukubota/ai-management/.venv/bin/python make_icons.py

生成物: icons/icon-192.png / icons/icon-512.png / icons/apple-touch-icon.png (180x180)
1024px で描いてから縮小し、輪郭を滑らかにする。文字は焼き込まない。
"""
from pathlib import Path

from PIL import Image, ImageDraw

GREEN = (31, 92, 58, 255)      # #1F5C3A
PAPER = (252, 253, 252, 255)   # #FCFDFC
RULE = (194, 207, 196, 255)    # #C2CFC4

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "icons"


def draw_base(size: int = 1024) -> Image.Image:
    """icon.svg の座標系（viewBox 512）を 2 倍して描く。"""
    s = size / 512.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def box(x, y, w, h):
        return [x * s, y * s, (x + w) * s, (y + h) * s]

    # 背景（角丸の深緑）
    d.rounded_rectangle(box(0, 0, 512, 512), radius=96 * s, fill=GREEN)
    # ノート本体と綴じ
    d.rounded_rectangle(box(128, 88, 256, 336), radius=20 * s, fill=PAPER)
    d.rounded_rectangle(box(128, 88, 26, 336), radius=13 * s, fill=RULE)
    # 罫線 3 本
    d.rounded_rectangle(box(184, 148, 164, 18), radius=9 * s, fill=RULE)
    d.rounded_rectangle(box(184, 198, 164, 18), radius=9 * s, fill=RULE)
    d.rounded_rectangle(box(184, 248, 108, 18), radius=9 * s, fill=RULE)
    # チェックマーク（丸端の 2 セグメント）
    w = 44 * s
    p1 = (206 * s, 336 * s)
    p2 = (260 * s, 390 * s)
    p3 = (360 * s, 276 * s)
    d.line([p1, p2, p3], fill=GREEN, width=int(w), joint="curve")
    for p in (p1, p2, p3):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=GREEN)
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    base = draw_base(1024)
    for name, px in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
        im = base.resize((px, px), Image.LANCZOS)
        if name == "apple-touch-icon.png":
            # iOS は角丸を自前で付けるので、透過を嫌って不透明背景に落とす
            bg = Image.new("RGB", (px, px), GREEN[:3])
            bg.paste(im, (0, 0), im)
            bg.save(OUT / name)
        else:
            im.save(OUT / name)
        print(f"OK: icons/{name} ({px}x{px})")


if __name__ == "__main__":
    main()
