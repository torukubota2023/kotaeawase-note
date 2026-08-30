#!/usr/bin/env python3
"""subs.json＋diagrams.json から、収録の拍（assets/beats.json）を自動採寸する。

なぜ要るか:
    収録の at() を秒の直書きにすると、台本を1文字直すたびに手で測り直しになる
    （第11話で実際に起きた運用）。ここでは「字幕のこの文が始まる瞬間＋δ秒」という
    錨（アンカー）で拍を定義し、レンダーのたびに再計算する。
    end は窓の終わり−δ。値はすべて窓開始を 0 とした相対秒。

使い方: /opt/homebrew/bin/python3 make_beats.py   → ../assets/beats.json
"""
import json
import pathlib
import re
import sys

TALK = pathlib.Path(__file__).resolve().parent
OUT = TALK.parent / "assets" / "beats.json"

# clip → [(key, anchor部分文字列 or ("END",), delta秒)]
ANCHORS = {
    "rec_addhome": [
        ("tap_howto", "追加のしかたを押します", 0.5),
        ("show_sheet", "手順が出ました", 0.4),
        ("end", "END", -0.5),
    ],
    "rec_s1": [
        ("new", "新しい記録を押します", 0.6),
        ("disease", "病態は胸水をタップ", 0.3),
        ("side", "左右は、右", 0.3),
        ("tpl", "問いの例文が出るので", 1.6),
        ("age", "年代は70代", 0.2),
        ("sex", "年代は70代", 2.0),
        ("next", "次へを押します", 0.2),
        ("end", "END", -0.3),
    ],
    "rec_s2": [
        ("dx", "第一候補の候補が", 2.8),
        ("conf70", "70のチップを押します", 0.3),
        ("freq", "下に、70%は", 0.2),
        ("site_scroll", "どこにあると思うかも", 0.2),
        ("aspect", "右の、背中側", 0.3),
        ("end", "END", -0.5),
    ],
    "rec_s3s4": [
        ("f1", "あった所見、なかった所見", 0.8),
        ("f2", "あった所見、なかった所見", 2.6),
        ("next", "そして、鍵をかけます", 0.4),
        ("lock_scroll", "ここまでを画像の前に書いた、を押します", 0.0),
        ("lock", "ここまでを画像の前に書いた、を押します", 1.2),
        ("end", "END", -0.4),
    ],
    "rec_s5": [
        ("modality", "使った画像の種類を選びます", 0.3),
        ("finding", "見えた所見をタップして", 0.5),
        ("conf90", "見えた所見をタップして", 3.0),
        ("def_scroll", "そして、新しい質問がひとつ", 0.3),
        ("def_yes", "胸水がはっきり見えたなら", 1.5),
        ("note_scroll", "決まらなかった、が続く病態は", 0.3),
        ("end", "END", -0.5),
    ],
    "rec_followup": [
        ("outcome_scroll", "だから後日、一覧からこの記録を開いて", 0.5),
        ("match_scroll", "はい、部分、いいえ、のどれかを押します", 0.2),
        ("match_yes", "今、はいを押しました", 0.3),
        ("jf_scroll", "すると下に1行出ます", 0.5),
        ("end", "END", -0.5),
    ],
    "rec_stats": [
        ("open_details", "仕組みが気になったら", 1.8),
        ("details_scroll", "言葉だけで説明してあります", 0.2),
        ("table_scroll", "その下の対応表は", 0.4),
        ("end", "END", -0.5),
    ],
    "rec_quick": [
        ("open", "ひとつめが一行記録です", 1.2),
        ("zure", "日付、どこが予想とずれたか", 1.0),
        ("next", "次は、呼吸音の減弱と一緒に", 0.5),
        ("save", "二行書いて、保存", 0.3),
        ("end", "END", -0.5),
    ],
    "rec_oya": [
        ("tap", "予想と違ったその瞬間に押すだけの", 2.5),
        ("card", "今、押しました", 1.0),
        ("open_card", "中身は空のままで構いません", 1.0),
        ("write", "何が予想と違ったか、次の一手は何か", 0.5),
        ("end", "END", -0.5),
    ],
    "rec_track": [
        ("go_track", "みっつめが経過です", 1.0),
        ("new_btn", "追う患者を足す、を押して", 0.3),
        ("label", "追う患者を足す、を押して", 2.6),
        ("items", "そして、追う所見を三つから五つだけ選びます", 0.5),
        ("anchor_scroll", "もうひとつ、段階の目盛りを最初に決めます", 0.5),
        ("end", "END", -0.5),
    ],
    "rec_recordline": [
        ("line_scroll", "確信度の欄の上に", 0.2),
        ("end", "END", -0.5),
    ],
    "rec_backup": [
        ("bk_scroll", "だから月に1回", 0.3),
        ("bk_tap", "だから月に1回", 4.0),
        ("restore_scroll", "端末を替えるときは", 0.4),
        ("end", "END", -0.5),
    ],
    "rec_dark": [
        ("stats_go", "アプリも自動で暗い画面に", 0.2),
        ("end", "END", -0.5),
    ],
    "rec_bigtype": [
        ("toggle_scroll", "文字が小さいと感じたら", 0.2),
        ("toggle_tap", "文字が小さいと感じたら", 2.8),
        ("grown", "文字が小さいと感じたら", 4.6),
        ("end", "END", -0.5),
    ],
    "rec_fix": [
        ("fix_scroll", "打ち間違いに気づいたら", 0.3),
        ("fix_tap", "打ち間違いに気づいたら", 2.6),
        ("back_detail", "確認が出て", 0.5),
        ("badge_scroll", "確認が出て", 1.5),
        ("draft_seed", "書きかけのまま呼ばれて", 0.5),
        ("resume_scroll", "書きかけのまま呼ばれて", 2.5),
        ("end", "END", -0.5),
    ],
}


def norm(s: str) -> str:
    return re.sub(r"\\N|\*\*|\s", "", s)


def main() -> int:
    subs = json.loads((TALK / "subs.json").read_text())
    diagrams = json.loads((TALK / "diagrams.json").read_text())
    wins = {}
    for s, e, p in diagrams:
        name = pathlib.Path(p).stem.replace("_repframe_", "")
        if name in ANCHORS:
            wins[name] = (s, e)
    missing = set(ANCHORS) - set(wins)
    if missing:
        sys.exit(f"❌ diagrams.json に窓が無い: {sorted(missing)}")

    beats = {}
    for name, rows in ANCHORS.items():
        s, e = wins[name]
        b = {"_window": [round(s, 3), round(e, 3)]}
        for key, anchor, delta in rows:
            if anchor == "END":
                b[key] = round(e - s + delta, 2)
                continue
            hit = [st for st, en, tx in subs if norm(anchor) in norm(tx) and s - 1 <= st < e]
            if not hit:
                sys.exit(f"❌ {name}.{key}: 錨『{anchor}』が窓 {s:.1f}–{e:.1f} に見つからない")
            t = hit[0] - s + delta
            if not (0 <= t <= e - s):
                sys.exit(f"❌ {name}.{key}: 拍 {t:.2f}s が窓（{e-s:.1f}s）の外")
            b[key] = round(t, 2)
        # 拍が時系列順に並んでいることを検査（end を除く）
        seq = [v for k, v in b.items() if k not in ("_window",)]
        if seq != sorted(seq):
            sys.exit(f"❌ {name}: 拍が時系列順でない {b}")
        beats[name] = b

    OUT.write_text(json.dumps(beats, ensure_ascii=False, indent=1))
    print(f"✅ {OUT.name}（{len(beats)}クリップ）")
    for name, b in beats.items():
        w = b["_window"]
        print(f"  {name:16s} 窓 {w[1]-w[0]:5.1f}s  拍 {[f'{k}={v}' for k, v in b.items() if k != '_window']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
