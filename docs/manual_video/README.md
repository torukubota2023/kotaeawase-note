# 操作マニュアル動画（v1.16.0 対応）── 制作物の管理

## これは何か

答え合わせノートを明日から臨床で使い始める医師向けの、実画面実況マニュアル動画
（約8分・1920×1080・ナレーション/字幕つき）。**公開版 v1.16.0**
（https://torukubota2023.github.io/kotaeawase-note/ ・2026-08-30 21:22 JST 反映確認）を
Playwright で実際に操作して収録した。入力はすべて架空データで、患者名・ID・生年月日・
病室は台本レベルで存在しない。

## 完成 MP4 の正式な置き場所（Git 管理外）

動画本体は既存方針どおり Git に入れない（このリポジトリは公開・アプリ本体のみ）。

- **正本**: `~/知的解説/2_制作中/答え合わせノート_操作マニュアル/talk/talk.mp4`
- **配布名**: 同フォルダ直下 `答え合わせノート_操作マニュアル_8分.mp4`
  （`cp -c -p` による APFS クローン。シリーズ番号は付けない ── マニュアルは番号体系外のため
  `sync_titled_videos.py` の ORDER にも登録しない。再レンダー後は手でクローンし直す）
- **同一性の検証**（qa_report.txt 2026-08-30 実測）:
  SHA-256 `7b098957950cbe333ae82476e70c94133d590064dd7b4cb69a1dd51bbdd42a74`
  ／ 55,388,778 bytes ／ 尺 489.01 秒。配布名クローンも同一 SHA を実測確認済み
- 配布は Teams（送信は副院長ご本人）。投稿文は
  [teams投稿_操作マニュアル動画_下書き.md](teams投稿_操作マニュアル動画_下書き.md)

## このフォルダの中身（制作物のスナップショット）

作業の正本は `~/知的解説/2_制作中/答え合わせノート_操作マニュアル/`（iCloud・Git 外）。
ここにはリポジトリで管理すべき写しを置く。**直すときは正本を直し、写しを更新する。**

| ファイル | 役割 |
|---|---|
| `02_動画台本.md` | 台本の正本の写し（テロップ・図解窓タグ込み） |
| `subs.json` / `telops.json` | 字幕・章テロップの実測タイムライン |
| `record_manual_clips.mjs` | 公開版を12本収録する Playwright スクリプト |
| `make_beats.py` / `beats.json` | 収録の拍を字幕実測から自動採寸する仕組み |
| `prepare_manual_clips.py` | webm→1920×1080 mp4＋代表フレーム |
| `make_plate_diagrams.py` / `compose_manual.py` | 差分マット合成（第11話方式） |
| `make_manual_figs.py` | サムネ・チェックリスト図の生成 |
| `qa_manual.py` / `qa_report.txt` | 機械検収と結果 |
| `acceptance_manual.md` | 受け入れ検査票（実測転記済み） |
| `teams投稿_操作マニュアル動画_下書き.md` | 配布案内（未送信） |

## 作り直しの手順（要約）

```
talk/rerender_talk.py --full   # 台本→音声・字幕・窓（VOICEVOX）
talk/make_beats.py             # 拍の採寸
assets/record_manual_clips.mjs all   # 公開版を収録
assets/prepare_manual_clips.py
talk/make_plate_diagrams.py → cat_avatar 黒白2版 → talk/compose_manual.py
talk/qa_manual.py
```

## 関連

- アプリ側の版: v1.16.0（PR #16、マージコミット 8ae01d5）
- ㉑第11話「二つの道具」は同アプリ v1.7.0 を論考の素材として実演している。
  本動画は操作マニュアルで役割が別。㉑の v1.16 追随は guide-video-sync の別タスク。
