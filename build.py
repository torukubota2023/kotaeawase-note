#!/usr/bin/env python3
"""data/content.yaml → index.html の CONTENT 区間へ JSON を注入するビルダー。

実行（PyYAML は ai-management の venv にある）:
    /Users/torukubota/ai-management/.venv/bin/python build.py          # 注入
    /Users/torukubota/ai-management/.venv/bin/python build.py --check  # 差分検査（コミット前必須）

やること:
  1. content.yaml の検証（diseases 7件 / id 一意 / categories 8件 /
     決定木の参照整合と8分類全到達 / export_template 8項目 / ui_copy ほか必須キー）
  2. マーカー個数チェック（CONTENT / APPVER 各1組だけ）
  3. CONTENT 区間へ `const CONTENT = {...};`（ensure_ascii=False・キー順は YAML のまま）
  4. sw.js の VERSION を APPVER 区間の APP_VERSION へ転記（版の食い違い事故の予防）
  5. 冪等（2回目は「変更なし」）。--check は差分があれば exit 1
"""
import argparse
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
YAML_PATH = ROOT / "data" / "content.yaml"
HTML_PATH = ROOT / "index.html"
SW_PATH = ROOT / "sw.js"

CB = "/* ==== CONTENT:BEGIN ==== */"
CE = "/* ==== CONTENT:END ==== */"
AB = "/* ==== APPVER:BEGIN ==== */"
AE = "/* ==== APPVER:END ==== */"

UI_COPY_KEYS = ["lock_button", "lock_confirm", "edited_after_lock_badge",
                "anon_placeholder", "small_n_note", "teaching_point_label",
                "quick_hint", "addendum_note", "no_miss_label"]


def validate(content: dict) -> list[str]:
    errors: list[str] = []

    def need(cond: bool, msg: str) -> None:
        if not cond:
            errors.append(msg)

    # --- diseases -------------------------------------------------------
    diseases = content.get("diseases") or []
    need(len(diseases) == 7, f"diseases は 7 件のはず（実際 {len(diseases)} 件）")
    dids = [d.get("id") for d in diseases]
    need(len(set(dids)) == len(dids), f"disease id に重複がある: {dids}")
    item_ids: list[str] = []
    for d in diseases:
        for it in (d.get("exam_items") or []) + (d.get("pocus_items") or []):
            need(bool(it.get("id")) and bool(it.get("label")), f"{d.get('id')}: id/label の無い項目がある")
            item_ids.append(it.get("id"))
    dup = sorted({x for x in item_ids if item_ids.count(x) > 1})
    need(not dup, f"exam/pocus 項目の id が全体で一意でない: {dup}")

    # --- site_options ---------------------------------------------------
    site = content.get("site_options") or {}
    for k in ("sides", "aspects", "ics_chips"):
        need(bool(site.get(k)), f"site_options.{k} が空")

    # --- miss_classification -------------------------------------------
    mc = content.get("miss_classification") or {}
    cats = mc.get("categories") or []
    need(len(cats) == 8, f"外れ方分類 categories は 8 件のはず（実際 {len(cats)} 件）")
    cat_ids = [c.get("id") for c in cats]
    need(len(set(cat_ids)) == len(cat_ids), f"category id に重複がある: {cat_ids}")
    cat_set = set(cat_ids)

    tree = mc.get("tree") or {}
    nodes = {n.get("id"): n for n in (tree.get("nodes") or [])}
    root = tree.get("root")
    need(root in nodes, f"決定木 root '{root}' が nodes に無い")
    reachable_results: set[str] = set()
    visited: set[str] = set()
    stack = [root] if root in nodes else []
    while stack:
        nid = stack.pop()
        if nid in visited:
            continue
        visited.add(nid)
        for op in nodes[nid].get("options") or []:
            nxt, res = op.get("next"), op.get("result")
            if nxt is not None:
                if nxt not in nodes:
                    errors.append(f"決定木: node '{nid}' の next '{nxt}' が未定義")
                else:
                    stack.append(nxt)
            elif res is not None:
                if res not in cat_set:
                    errors.append(f"決定木: node '{nid}' の result '{res}' が categories に無い")
                reachable_results.add(res)
            else:
                errors.append(f"決定木: node '{nid}' に next も result も無い選択肢がある")
    unreachable_nodes = sorted(set(nodes) - visited)
    need(not unreachable_nodes, f"決定木: root から到達できないノードがある: {unreachable_nodes}")
    missing_cat = sorted(cat_set - reachable_results)
    need(not missing_cat, f"決定木から到達できない分類がある（8分類全到達が要件）: {missing_cat}")

    hint_cats = [h.get("category") for h in (mc.get("next_hints") or [])]
    bad_hints = sorted(set(hint_cats) - cat_set)
    need(not bad_hints, f"next_hints に categories に無い id がある: {bad_hints}")

    # --- export_template ------------------------------------------------
    items = (content.get("export_template") or {}).get("items") or []
    need(len(items) == 8, f"export_template.items は 8 項目のはず（実際 {len(items)} 件）")
    nos = sorted(it.get("no") for it in items if isinstance(it, dict))
    need(nos == list(range(8)), f"export_template の \"no\" は 0〜7 が各1つのはず（実際 {nos}）")
    for it in items:
        need(bool(it.get("heading")), f"export_template no={it.get('no')} に heading が無い")
    # アプリが位置参照する subfields の本数（content.yaml 承認版に固定）
    expected_sub = {2: 5, 3: 4, 4: 5, 5: 4, 6: 4, 7: 1}
    for it in items:
        no = it.get("no")
        if no in expected_sub:
            n = len(it.get("subfields") or [])
            need(n == expected_sub[no],
                 f"export_template no={no} の subfields は {expected_sub[no]} 本のはず（実際 {n} 本）")

    # --- quick_templates（ワンハンド入力の組み立て規則） ----------------
    qt = content.get("quick_templates") or {}
    slot = qt.get("side_slot")
    need(isinstance(slot, str) and len(slot) == 1, "quick_templates.side_slot は1文字の文字列のはず")
    did_set = set(dids)
    questions = qt.get("questions") or {}
    for k, v in questions.items():
        need(k in did_set, f"quick_templates.questions の疾患id '{k}' が diseases に無い")
        ok_list = isinstance(v, list) and 1 <= len(v) <= 2 and all(
            isinstance(t, str) and t.strip() for t in v)
        need(ok_list, f"quick_templates.questions.{k} は 1〜2 本の非空文字列リストのはず")
        if ok_list and isinstance(slot, str):
            for t in v:
                need(t.count(slot) <= 1,
                     f"quick_templates.questions.{k}: 側スロット '{slot}' は最大1個のはず（実際 {t.count(slot)} 個）")
    pats = qt.get("first_dx_patterns") or []
    need(bool(pats) and all(isinstance(p, str) and "{label}" in p for p in pats),
         "quick_templates.first_dx_patterns は {label} を含む文字列のリストのはず")
    for p in pats:
        bad_ph = sorted(set(re.findall(r"\{(\w+)\}", p)) - {"side", "label"})
        need(not bad_ph, f"first_dx_patterns '{p}' に未知のプレースホルダ: {bad_ph}")

    # --- quick_note / ui_copy / links ----------------------------------
    qn = content.get("quick_note") or {}
    for k in ("zure_label", "next_label"):
        need(bool(qn.get(k)), f"quick_note.{k} が無い")
    ui = content.get("ui_copy") or {}
    for k in UI_COPY_KEYS:
        need(bool(ui.get(k)), f"ui_copy.{k} が無い")
    links = content.get("links") or {}
    for k in ("bedside_bayes", "bedside_bayes_note", "guide_ref", "nejm_ref"):
        need(bool(links.get(k)), f"links.{k} が無い")

    return errors


def read_sw_version() -> str:
    sw = SW_PATH.read_text(encoding="utf-8")
    m = re.search(r'const VERSION = "([^"]+)";', sw)
    if not m:
        print("NG: sw.js に `const VERSION = \"...\";` が見つからない")
        sys.exit(1)
    return m.group(1)


def splice(html: str, begin: str, end: str, payload: str) -> str:
    for marker in (begin, end):
        n = html.count(marker)
        if n != 1:
            print(f"NG: マーカー {marker} が {n} 個ある（1個のはず）。index.html を確認してください")
            sys.exit(1)
    i = html.index(begin) + len(begin)
    j = html.index(end)
    if i > j:
        print(f"NG: マーカーの順序が逆（{begin} が {end} より後ろ）")
        sys.exit(1)
    return html[:i] + "\n" + payload + "\n" + html[j:]


def main() -> int:
    ap = argparse.ArgumentParser(description="content.yaml → index.html CONTENT 注入")
    ap.add_argument("--check", action="store_true", help="差分があれば exit 1（コミット前検査）")
    args = ap.parse_args()

    content = yaml.safe_load(YAML_PATH.read_text(encoding="utf-8"))
    errors = validate(content)
    if errors:
        print(f"NG: content.yaml の検証で {len(errors)} 件:")
        for e in errors:
            print("  - " + e)
        return 1

    version = read_sw_version()
    html = HTML_PATH.read_text(encoding="utf-8")
    content_json = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    built = splice(html, CB, CE, "const CONTENT = " + content_json + ";")
    built = splice(built, AB, AE, f'const APP_VERSION = "{version}";')

    n_exam = sum(len(d.get("exam_items") or []) for d in content["diseases"])
    n_pocus = sum(len(d.get("pocus_items") or []) for d in content["diseases"])
    report = (f"diseases 7・exam_items {n_exam}・pocus_items {n_pocus}・"
              f"分類 8・決定木ノード {len(content['miss_classification']['tree']['nodes'])}・"
              f"テンプレ 8項目／APP_VERSION {version}／"
              f"index.html {len(built.encode('utf-8')) / 1024:.1f} KB")

    if args.check:
        if built != html:
            print("NG: index.html が content.yaml / sw.js と食い違っています。build.py を実行してください")
            return 1
        print("OK: --check 差分なし（" + report + "）")
        return 0

    if built == html:
        print("OK: 変更なし（" + report + "）")
        return 0
    HTML_PATH.write_text(built, encoding="utf-8")
    print("OK: 注入しました（" + report + "）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
