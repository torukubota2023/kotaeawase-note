#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""操作マニュアル: 画面収録クリップ12本を差分マットで本編に重ね、アウトロを付けて talk.mp4 を作る。

仕組みは第11話 talk/compose_ep11.py と同一（正本の解説は
2_制作中/論破に勝った人は何も覚えていない/compose_diagrams.py）:
    cat_avatar の図解は静止画のみ。クリップ窓を黒く塗った版と白く塗った版の
    2回レンダーから差分マットで「図解より上の層」（猫カード・字幕・テロップ・
    クレジット・ロゴ）の不透明度を取り出し、クリップを窓へ流し込んでから上の層を戻す。
    窓の丸めは cat_avatar と同じ int(秒×fps)。隣接窓は FADE_FRAMES ぶん前後へ
    クリップを複製（クロスフェード中の黒沈み対策・第11話で輝度32〜37を実測済み）。

使い方: /opt/homebrew/bin/python3 compose_manual.py
"""
import glob
import json
import pathlib
import subprocess
import sys

TALK = pathlib.Path(__file__).resolve().parent
ASSETS = TALK.parent / "assets"
BLACK = TALK / "render_black" / "avatar.mp4"
WHITE = TALK / "render_white" / "avatar.mp4"
OUT = TALK / "talk.mp4"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
FPS = 30
OUTRO_S = 5.0
FADE_S = 1.0

CLIP_NAMES = ["rec_addhome", "rec_s1", "rec_s2", "rec_s3s4", "rec_s5", "rec_followup",
              "rec_stats", "rec_recordline", "rec_backup", "rec_dark", "rec_bigtype", "rec_fix"]
CLIP_OF = {f"_repframe_{n}.png": f"{n}.mp4" for n in CLIP_NAMES}
THANKS = "ここまでご視聴いただきありがとうございました。"
HOSPITAL = "おもろまちメディカルセンター 呼吸器内科"


def duration(path: pathlib.Path) -> float:
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout
    return float(out.strip())


def fontfile() -> str:
    m = glob.glob("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc")
    return m[0] if m else "/System/Library/Fonts/Hiragino Sans GB.ttc"


def build_outro_frame(path: pathlib.Path) -> None:
    """最終フレームの字幕帯を塗り消し、御礼と病院名を描く（drawtext が無いため PIL）。"""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(img)
    d.rectangle((300, 872, 1530, 1080), fill=(238, 244, 250))
    f = fontfile()
    for text, size, y in ((HOSPITAL, 40, 890), (THANKS, 44, 972)):
        font = ImageFont.truetype(f, size)
        w = d.textbbox((0, 0), text, font=font)[2]
        d.text(((1920 - w) / 2, y), text, font=font, fill=(23, 59, 87))
    img.save(path)


def main() -> int:
    for p in (BLACK, WHITE):
        if not p.exists():
            print(f"ありません: {p}（先に黒白2版を cat_avatar でレンダーする）")
            return 1
    if abs(duration(BLACK) - duration(WHITE)) > 0.05:
        print("黒版と白版の長さが違う。同じ引数で作り直すこと")
        return 1

    diagrams = json.loads((TALK / "diagrams.json").read_text())
    plan = []
    for idx, (s, e, p) in enumerate(diagrams):
        name = pathlib.Path(p).name
        if name not in CLIP_OF:
            continue
        contiguous_prev = idx > 0 and diagrams[idx - 1][1] >= s - 1 / FPS
        contiguous_next = idx < len(diagrams) - 1 and diagrams[idx + 1][0] <= e + 1 / FPS
        plan.append((s, e, CLIP_OF[name], contiguous_prev, contiguous_next))
    used = [pathlib.Path(p).name for _s, _e, p in diagrams if pathlib.Path(p).name in CLIP_OF]
    if sorted(used) != sorted(CLIP_OF):
        missing = sorted(set(CLIP_OF) - set(used))
        dup = sorted({x for x in used if used.count(x) > 1})
        print(f"クリップ窓が CLIP_OF と一致しない（窓 {len(plan)} 本 / 定義 {len(CLIP_OF)} 本）"
              + (f"／台本に無い: {missing}" if missing else "")
              + (f"／重複: {dup}" if dup else ""))
        return 1

    dur = duration(BLACK)
    inputs = ["-i", str(BLACK), "-i", str(WHITE)]
    for s, e, name, _pre, _post in plan:
        inputs += ["-i", str(ASSETS / name)]
    inputs += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "color=c=black:s=1920x1080:r=30"]
    canvas = 2 + len(plan)

    parts = [
        "[0:v]format=gbrp,split=2[b1][b2]",
        "[1:v]format=gbrp[w]",
        "[w][b1]blend=all_mode=difference[m]",
    ]
    FADE_FRAMES = 9
    prev = f"{canvas}:v"
    for i, (s, e, name, pre, post) in enumerate(plan):
        fs, fe = int(s * FPS), int(e * FPS)
        fs_ov = fs - FADE_FRAMES if pre else fs
        fe_ov = fe + FADE_FRAMES if post else fe
        win = (fe_ov - fs_ov) / FPS
        head = (fs - fs_ov) / FPS
        parts.append(f"[{i + 2}:v]tpad=start_mode=clone:start_duration={head:.4f}:"
                     f"stop_mode=clone:stop_duration=120,"
                     f"trim=0:{win:.4f},setpts=PTS-STARTPTS+{fs_ov}/{FPS}/TB[c{i}]")
        parts.append(f"[{prev}][c{i}]overlay=0:0:"
                     f"enable='between(t,({fs_ov}-0.5)/{FPS},({fe_ov}-0.5)/{FPS})'[t{i}]")
        prev = f"t{i}"
    parts.append(f"[{prev}]format=gbrp[trk]")
    parts.append("[trk][m]blend=all_mode=multiply[cc]")
    parts.append("[b2][cc]blend=all_mode=addition[main]")
    parts.append("[main]format=yuv420p[v]")
    parts.append("[0:a]anull[a]")

    main_mp4 = TALK / "talk_main.mp4"
    cmd = [FFMPEG, "-v", "error", "-stats", *inputs,
           "-filter_complex", ";".join(parts), "-map", "[v]", "-map", "[a]",
           "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-c:a", "aac", "-b:a", "192k", str(main_mp4), "-y"]
    print(f"クリップ {len(plan)} 本を合成 → {main_mp4.name}")
    r = subprocess.run(cmd)
    if r.returncode:
        return r.returncode

    last = TALK / "overlays" / "outro_frame.png"
    subprocess.run([FFMPEG, "-v", "error", "-sseof", "-0.15", "-i", str(main_mp4),
                    "-frames:v", "1", "-update", "1", str(last), "-y"], check=True)
    build_outro_frame(last)

    outro_mp4 = TALK / "talk_outro.mp4"
    subprocess.run([FFMPEG, "-v", "error",
                    "-loop", "1", "-framerate", "30", "-t", f"{OUTRO_S:.1f}", "-i", str(last),
                    "-f", "lavfi", "-t", f"{OUTRO_S:.1f}", "-i",
                    "anullsrc=channel_layout=mono:sample_rate=24000",
                    "-vf", f"fade=t=out:st={OUTRO_S - FADE_S:.2f}:d={FADE_S:.2f},format=yuv420p",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "19",
                    "-c:a", "aac", "-b:a", "192k", "-shortest", str(outro_mp4), "-y"], check=True)

    lst = TALK / "overlays" / "_concat.txt"
    lst.write_text(f"file '{main_mp4}'\nfile '{outro_mp4}'\n")
    r = subprocess.run([FFMPEG, "-v", "error", "-f", "concat", "-safe", "0",
                        "-i", str(lst), "-c", "copy", str(OUT), "-y"])
    if r.returncode:
        return r.returncode
    got, want = duration(OUT), dur + OUTRO_S
    print(f"完成: {OUT}（{got:.1f}秒 / 想定 {want:.1f}秒）")
    return 0 if abs(got - want) < 0.3 else 1


if __name__ == "__main__":
    sys.exit(main())
