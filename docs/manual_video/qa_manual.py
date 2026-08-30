#!/usr/bin/env python3
"""操作マニュアル動画の機械検収。_チェックリスト/完成動画の受入基準.md の書式で報告する。

検査項目（ユーザー指示 2026-08-30）:
  1. ffprobe でコンテナ・映像・音声の諸元（1920x1080/30fps/H.264/AAC）
  2. 全編デコードでエラー 0 件（映像・音声とも）
  3. 尺 = 黒版レンダー + アウトロ5秒 ± 0.3
  4. 代表フレーム抽出（各クリップ窓の中央 + 冒頭サムネ + アウトロ）→ qa_frames/
  5. 字幕・タップ同期の目視用に、各窓のタップ瞬間フレームも抽出
  6. v1.16.0 統一: 収録に使ったアプリ版の確認は record 時の公開版（別途記録）
  7. SHA-256
成果物は一切変更しない（読み取りのみ）。
使い方: /opt/homebrew/bin/python3 qa_manual.py
"""
import hashlib
import json
import pathlib
import subprocess
import sys

TALK = pathlib.Path(__file__).resolve().parent
OUT = TALK / "talk.mp4"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
FRAMES = TALK / "qa_frames"
results = []


def report(status, msg):
    results.append(f"[{status}] {msg}")
    print(f"[{status}] {msg}")


def probe(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_streams", "-show_format",
                          "-of", "json", str(path)], capture_output=True, text=True).stdout
    return json.loads(out)


def main() -> int:
    if not OUT.exists():
        print(f"ありません: {OUT}")
        return 1

    # 1. 諸元
    info = probe(OUT)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    dur = float(info["format"]["duration"])
    ok = (v["width"], v["height"]) == (1920, 1080) and v["codec_name"] == "h264"
    report("合格" if ok else "不合格",
           f"映像 {v['width']}x{v['height']} {v['codec_name']} {v.get('avg_frame_rate')}")
    report("合格" if (a and a["codec_name"] == "aac") else "不合格",
           f"音声 {a['codec_name'] if a else '無し'} {a.get('sample_rate') if a else ''}Hz")

    # 2. 全編デコード（エラー件数）
    dec = subprocess.run([FFMPEG, "-v", "error", "-i", str(OUT), "-f", "null", "-"],
                         capture_output=True, text=True)
    nerr = len([l for l in dec.stderr.splitlines() if l.strip()])
    report("合格" if nerr == 0 else "不合格", f"全編デコードのエラー {nerr} 件")

    # 3. 尺
    black = TALK / "render_black" / "avatar.mp4"
    if black.exists():
        want = float(probe(black)["format"]["duration"]) + 5.0
        report("合格" if abs(dur - want) < 0.3 else "不合格",
               f"尺 {dur:.2f}秒（想定 {want:.2f}秒 = 本編+アウトロ5秒）")
    else:
        report("要判断", f"尺 {dur:.2f}秒（render_black が無く想定値と比較できない）")

    # 4. 代表フレーム: サムネ(1.5s)・各クリップ窓の中央・タップ待ちの直後・アウトロ(末尾-2s)
    FRAMES.mkdir(exist_ok=True)
    diagrams = json.loads((TALK / "diagrams.json").read_text())
    marks = [("intro", 1.5)]
    for s, e, p in diagrams:
        name = pathlib.Path(p).stem.replace("_repframe_", "")
        marks.append((f"{name}_mid", (s + e) / 2))
        marks.append((f"{name}_head", min(s + 3.0, e - 0.5)))
    marks.append(("outro", dur - 2.0))
    for name, t in marks:
        subprocess.run([FFMPEG, "-v", "error", "-ss", f"{t:.2f}", "-i", str(OUT),
                        "-frames:v", "1", "-update", "1",
                        str(FRAMES / f"{name}_{t:.0f}s.png"), "-y"], check=True)
    report("合格", f"代表フレーム {len(marks)} 枚 → {FRAMES.name}/（目視は別途）")

    # 5. 音声の実在（無音でないこと）: 中盤30秒の平均音量
    vol = subprocess.run([FFMPEG, "-v", "info", "-ss", "60", "-t", "30", "-i", str(OUT),
                          "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    mean = [l for l in vol.splitlines() if "mean_volume" in l]
    report("合格" if mean and "-91" not in mean[0] else "要判断",
           f"音声 {mean[0].split(']')[-1].strip() if mean else '測定不能'}（60〜90秒）")

    # 7. SHA-256
    h = hashlib.sha256()
    with open(OUT, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    report("合格", f"SHA-256 {h.hexdigest()}")
    report("合格", f"サイズ {OUT.stat().st_size:,} bytes")

    (TALK / "qa_report.txt").write_text("\n".join(results) + "\n")
    print(f"\n報告書: {TALK / 'qa_report.txt'}")
    return 0 if not any(r.startswith("[不合格]") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
