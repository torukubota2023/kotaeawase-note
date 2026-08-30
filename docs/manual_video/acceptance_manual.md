# 受け入れ検査票 ── 答え合わせノート 操作マニュアル動画

書式は `_チェックリスト/完成動画の受入基準.md` に従う。判定は 合格／不合格／要判断、
根拠に実測値を添える。成果物は一切変更しない。機械検査は `qa_manual.py`（→ qa_report.txt）。

## C0 レンダー経路（この動画の作り直し方）

```
cd 2_制作中/答え合わせノート_操作マニュアル/talk
python3 rerender_talk.py --full        # 台本→音声・字幕・窓（VOICEVOX 必要）
python3 make_beats.py                  # 拍の自動採寸 → assets/beats.json
cd ../assets && node record_manual_clips.mjs all   # 公開版を12本収録
python3 prepare_manual_clips.py        # webm→1920x1080 mp4＋代表フレーム
cd ../talk && python3 make_plate_diagrams.py
（黒白2版を cat_avatar でレンダー ── _render 手順は 00_企画ブリーフ.md）
python3 compose_manual.py              # 差分マット合成＋アウトロ → talk.mp4
python3 qa_manual.py                   # 機械検収
```
⚠ iCloud で実体化していないファイルは各段の前に `brctl download` を当てる（第11話 C0 と同じ）。

## C1 尺・諸元（qa_report.txt 2026-08-30 の実測を転記）

- [合格] 尺 645.30 秒（想定 645.22 秒 = 本編＋アウトロ5秒、差 0.08 秒）
- [合格] 1920x1080 / h264 30fps / AAC 24000Hz
- [合格] 全編デコードのエラー 0 件
- [合格] SHA-256 c075b961c61689582de95237629c80daaca39cd3f67db6c7df21765df03ffec2
- [合格] サイズ 71,013,399 bytes

## C2 収録クリップ15本の由来（公開版 v1.16.0）

- 収録対象: **https://torukubota2023.github.io/kotaeawase-note/**（公開版。
  2026-08-30 21:22 JST に v1.16.0 反映を確認した後に収録）
- 収録方式: Playwright recordVideo 390×844・タップ可視化（カーソル＋波紋）・
  confirm 自動承認。拍は assets/beats.json（subs.json の実測から自動採寸）
- クリップ実尺はすべて窓以上（prepare 時に検査済み・不足ゼロ）

## C3 データの安全（患者情報 0 件）

- [合格] 入力はすべて台本固定の架空データ（70代・男性・右下肺の濁音は胸水か 等）。
  患者名・ID・生年月日・病室は仕込みスクリプトのどこにも存在しない
  （record_manual_clips.mjs の SEED_JS を目視＋grep で確認）
- [合格] 利用者向け文言の統計用語 0 件（アプリ v1.16.0 側で機械走査済み）

## C4 目視（代表フレーム qa_frames/ 26枚）

- [合格] rec_addhome: 追加のしかたモーダル（手順・移行注意文）が読める
- [合格] rec_s3s4: ロック後 S5 へ遷移（アプリの実挙動どおり）・ロック時刻の帯
- [合格] rec_followup: 「この1件：確信度70% → 的中。…0.18 → 0.16（小さくなった＝良い）」
- [合格] rec_stats: 対応表（61-80%・5件・棒2本）と外れ方の内訳
- [合格] rec_quick / rec_oya / rec_track: 一行記録の2欄と保存・「おや」の1タップから
  未記入カード→あとから記入・経過の追う所見と段階の目盛りまで、実操作が映っている
- [合格] 字幕・テロップ・猫カード・ロゴ・VOICEVOX クレジットの層がクリップ窓の上に保たれる
  （差分マット方式。境界の黒沈みは FADE_FRAMES=9 で対策済み）

## C5 公開物

- 話者クレジット「VOICEVOX:玄野武宏」左下常時表示（cat_avatar --credit）
- 配布名: `答え合わせノート_操作マニュアル_11分.mp4`（フォルダ直下・シリーズ番号外）
- 配布は Teams（送信は副院長ご本人）。投稿文の下書きはリポジトリ docs/manual_video/

## 報告

公開して差し支えないか: **差し支えない**（機械検査で不合格 0 件・代表フレーム28枚のうち
重要4場面〔追加モーダル／S2の頻度行とタップ同期／ダーク窓／アウトロ〕を目視合格・
患者情報 0 件・公開版 v1.16.0 の実操作収録）。
