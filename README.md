# 答え合わせノート ── 画像を開く前に書く

POCUS による身体診察の較正支援アプリ。画像を開く**前**に予測と確信度（%）を書いてロックし、
POCUS で答え合わせをして、外れ方を8分類し、次の一手をひとつ決める。単一 HTML・依存ゼロ・通信ゼロの PWA。

- **公開URL:** https://torukubota2023.github.io/kotaeawase-note/ （GitHub Pages）
- 位置づけ: [bedside-bayes](https://torukubota2023.github.io/bedside-bayes/) ＝ 尤度比・情報量の**数値の正本**、
  本アプリ ＝ ガイド第10章 06.5「症例で較正する」の**手順の実装**。本アプリは診断の数値を一切表示しない

## データの扱い（最重要）

- 記録は**この端末の localStorage のみ**。サーバー送信ゼロ・外部リソース読み込みゼロ・解析ツールなし
- 患者の氏名・ID・病室番号は**入力欄を作っていない**。年代（10歳刻み）・性別のみ任意。
  自由記載欄には匿名注意の placeholder、書き出しテキストの冒頭に匿名確認の一行が入る
- **端末の中にしかない ＝ 消えることがある**。設定画面から
  1. 「端末にデータ保持を要求する」（`navigator.storage.persist()`）を一度押す
  2. 定期的に「JSON をダウンロード」でバックアップ（`kotaeawase-backup-YYYYMMDD.json`）
  3. 未バックアップが5件たまると一覧にバナーが出る
- 復元は設定画面から JSON を選び、件数を確認のうえ「全置換」か「マージ」（同じ記録IDは更新の新しい方）
- **症例の個別削除は意図的に無い**。外れた記録だけ消せると較正記録の選別になるため、
  ロック解除を作らないのと同じ思想で作っていない。試し入力の整理は「全消去」→バックアップ
  からの「復元」で行う。画像後に気づいたことは「補記」（append-only・採点に使わない）へ

## 開発・運用

### 医学コンテンツは content.yaml だけを編集する

医学文言（チェックリスト・外れ方8分類・決定木・書き出し見出し・ロック文言）の正本は
`data/content.yaml`。index.html の CONTENT 区間は build.py の生成物なので**手で編集しない**。

```bash
# 注入（PyYAML は ai-management の venv にある）
/Users/torukubota/ai-management/.venv/bin/python build.py

# コミット前必須：yaml だけ直して注入を忘れていないかの検査（差分があれば exit 1）
/Users/torukubota/ai-management/.venv/bin/python build.py --check
```

build.py は注入と同時に検証する: diseases 7件 / 項目 id の全体一意 / 外れ方分類 8件 /
決定木の参照整合と8分類全到達 / export_template 8項目（subfields 本数はアプリが位置参照するため固定）。
2回連続で実行しても差分ゼロ（冪等）。

### 更新したら sw.js の VERSION を必ず上げる

`sw.js` はネットワーク優先＋キャッシュ予備。**VERSION を上げ忘れると、既訪端末がオフラインに
落ちたとき旧版キャッシュのまま残り続ける**（bedside-bayes 開発中に実際に踏んだ穴）。
VERSION は build.py が index.html の `APP_VERSION`（設定画面とフッターの表示）へ転記するので、
上げたら build.py を再実行してからコミットする。

### アイコン

`icons/icon.svg` が原本。PNG（192/512/apple-touch-icon）は生成物:

```bash
/Users/torukubota/ai-management/.venv/bin/python make_icons.py
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | アプリ本体（配布物）。CONTENT/APPVER 区間のみ build.py が管理 |
| `data/content.yaml` | 医学コンテンツの正本（転記元との突合は `docs/content_map_reconciliation.md`） |
| `build.py` | yaml → CONTENT 注入。検証・冪等・`--check`・VERSION 転記 |
| `sw.js` | オフライン用 Service Worker（ネットワーク優先・VERSION 手動 bump） |
| `manifest.webmanifest` / `icons/` | PWA メタデータとアイコン |
| `docs/acceptance.md` | 検収チェックリスト（経緯を知らない検証者向け） |

## ライセンス

MIT（LICENSE 参照）。医学コンテンツの出典は
呼吸器身体診察実践ガイド 2026（第4章・第10章06.5・巻末テンプレート）および
Garibaldi BT, Russell SW. N Engl J Med 2025;393:2142-2150 (PMID 41223363)。
