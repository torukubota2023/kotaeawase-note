#!/usr/bin/env python3
"""diagrams.json から差分マット用の黒版・白版の窓定義を作る（操作マニュアル版）。
第11話 talk/make_plate_diagrams.py と同じ仕組み。クリップは12本。

使い方: /opt/homebrew/bin/python3 make_plate_diagrams.py [--check]
"""
import argparse
import json
import pathlib
import sys

TALK = pathlib.Path(__file__).resolve().parent
SRC = TALK / "diagrams.json"
CLIP_NAMES = ["rec_addhome", "rec_s1", "rec_s2", "rec_s3s4", "rec_s5", "rec_followup",
              "rec_stats", "rec_quick", "rec_oya", "rec_track", "rec_recordline", "rec_backup", "rec_dark", "rec_bigtype", "rec_fix"]
CLIPS = {f"_repframe_{n}.png" for n in CLIP_NAMES}


def build(diagrams: list, plate: str) -> list:
    out, n = [], 0
    for s, e, p in diagrams:
        path = pathlib.Path(p)
        if path.name in CLIPS:
            p = str(path.with_name(plate))
            n += 1
        out.append([s, e, p])
    if n != len(CLIPS):
        sys.exit(f"❌ クリップ窓が {n} 本（{len(CLIPS)} 本のはず）: {SRC}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    diagrams = json.loads(SRC.read_text(encoding="utf-8"))
    ok = True
    for plate, dst in (("_plate_black.png", TALK / "diagrams_black.json"),
                       ("_plate_white.png", TALK / "diagrams_white.json")):
        body = json.dumps(build(diagrams, plate), ensure_ascii=False)
        if args.check:
            cur = dst.read_text(encoding="utf-8").strip() if dst.exists() else ""
            same = json.loads(cur or "[]") == json.loads(body)
            print(f"{'一致' if same else '不一致'}: {dst.name}")
            ok &= same
        else:
            dst.write_text(body, encoding="utf-8")
            print(f"✅ {dst.name}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
