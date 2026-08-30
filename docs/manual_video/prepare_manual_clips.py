#!/usr/bin/env python3
"""収録 webm を 1920x1080 の mp4 に整形し、代表フレームを書き出す（操作マニュアル版）。

第11話 assets/prepare_clips.py と同じ配置規約:
  - スマホ画面 390x844 は (555, 9) に置く（字幕帯 y>=865・猫カード域 x>=1500,y>=690 を避ける）
  - 余白は背景色 #EEF4FA、枠線 0xB9C6D4 の 2px、fps=30, yuv420p, crf=18
  - 各クリップの最終フレームを _repframe_<名前>.png へ（プレースホルダを上書き）

使い方: /opt/homebrew/bin/python3 prepare_manual_clips.py
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
BG = "0xEEF4FA"
W, H, X, Y = 390, 844, 555, 9

CLIP_NAMES = ["rec_addhome", "rec_s1", "rec_s2", "rec_s3s4", "rec_s5", "rec_followup",
              "rec_stats", "rec_recordline", "rec_backup", "rec_dark", "rec_bigtype", "rec_fix"]


def main() -> None:
    for key in CLIP_NAMES:
        src = RAW / f"{key}.webm"
        if not src.exists():
            sys.exit(f"収録がない: {src}")
        dst = HERE / f"{key}.mp4"
        vf = (f"scale={W}:{H},pad=1920:1080:{X}:{Y}:color={BG},"
              f"drawbox=x={X}:y={Y}:w={W}:h={H}:color=0xB9C6D4:t=2,fps=30,format=yuv420p")
        subprocess.run([FFMPEG, "-v", "error", "-i", str(src), "-vf", vf, "-an",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                        str(dst), "-y"], check=True)
        rep = HERE / f"_repframe_{key}.png"
        subprocess.run([FFMPEG, "-v", "error", "-sseof", "-0.2", "-i", str(dst),
                        "-frames:v", "1", "-update", "1", str(rep), "-y"], check=True)
        print(f"✓ {key}.mp4 / {rep.name}")
    for name, color in (("_plate_black.png", "black"), ("_plate_white.png", "white")):
        subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi",
                        "-i", f"color=c={color}:s=1920x1080:d=1",
                        "-frames:v", "1", "-update", "1", str(HERE / name), "-y"], check=True)
        print(f"✓ {name}")


if __name__ == "__main__":
    main()
