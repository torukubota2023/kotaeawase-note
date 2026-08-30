#!/usr/bin/env python3
"""操作マニュアル動画の静止素材を作る。

  1. thumbnail/thumbnail_final.png ── 冒頭3秒のタイトルカード
  2. assets/fig_checklist.png      ── 最終章「明日の朝のチェックリスト」
  3. assets/_repframe_rec_*.png    ── 収録前のプレースホルダ12枚
     （黒白プレート合成では repframe の画素は最終動画に出ない。
       tts_avatar が Image.open できることだけが要件）

レイアウト規約: 字幕帯 y>=865・猫カード域 x>=1500 かつ y>=690 に内容を置かない。
使い方: /opt/homebrew/bin/python3 make_manual_figs.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
W, H = 1920, 1080
BG = (238, 244, 250)          # シリーズ背景 #EEF4FA
INK = (23, 59, 87)            # 濃紺 #173B57
GREEN = (31, 92, 58)          # アプリのアクセント #1F5C3A
PAPER = (252, 253, 252)
RULE = (194, 207, 196)

FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
FONT_B = "/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc"


def f(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def center(d, text, font, y, fill):
    w = d.textbbox((0, 0), text, font=font)[2]
    d.text(((W - w) / 2, y), text, font=font, fill=fill)


def thumbnail():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # アプリの紙面を模した中央パネル
    d.rectangle((360, 150, 1560, 930), fill=PAPER, outline=RULE, width=3)
    d.rectangle((360, 150, 1560, 162), fill=GREEN)
    d.text((420, 210), "KOTAEAWASE NOTE / v1.16.0", font=f(30), fill=(95, 112, 100))
    center(d, "答え合わせノート", f(110, bold=True), 300, INK)
    center(d, "操作マニュアル", f(110, bold=True), 440, GREEN)
    center(d, "── 明日の診察から使う ──", f(52), 620, INK)
    center(d, "画像を開く前に書いて、答え合わせで自分を知る", f(38), 740, (72, 89, 78))
    img.save(ROOT / "thumbnail" / "thumbnail_final.png")
    print("✓ thumbnail_final.png")


def checklist():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle((120, 60, 1460, 830), fill=PAPER, outline=RULE, width=3)
    d.rectangle((120, 60, 132, 830), fill=GREEN)
    d.text((180, 100), "明日の朝のチェックリスト", font=f(58, bold=True), fill=INK)
    items = [
        "ホーム画面に追加する（記録を作る前に）",
        "アイコンから開き、設定の保存の信号が緑か見る",
        "最初の1例は余裕のある場面で。問いはひとつ",
        "個人がわかる情報は書かない",
        "完璧を目指さない。月1〜2例、続くことがすべて",
    ]
    y = 230
    for i, t in enumerate(items, 1):
        d.ellipse((190, y + 4, 246, y + 60), outline=GREEN, width=4)
        num_f = f(34, bold=True)
        nw = d.textbbox((0, 0), str(i), font=num_f)[2]
        d.text((218 - nw / 2, y + 12), str(i), font=num_f, fill=GREEN)
        d.text((280, y + 6), t, font=f(42), fill=INK)
        y += 116
    img.save(HERE / "fig_checklist.png")
    print("✓ fig_checklist.png")


CLIP_NAMES = ["rec_addhome", "rec_s1", "rec_s2", "rec_s3s4", "rec_s5", "rec_followup",
              "rec_stats", "rec_recordline", "rec_backup", "rec_dark", "rec_bigtype", "rec_fix"]


def placeholders():
    for name in CLIP_NAMES:
        p = HERE / f"_repframe_{name}.png"
        if p.exists():
            continue        # 収録後の本物を上書きしない
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        center(d, f"(placeholder: {name})", f(40), 500, RULE)
        img.save(p)
    print(f"✓ placeholders ({len(CLIP_NAMES)}本・既存はスキップ)")


if __name__ == "__main__":
    (ROOT / "thumbnail").mkdir(exist_ok=True)
    thumbnail()
    checklist()
    placeholders()
