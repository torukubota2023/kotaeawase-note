# 自分の尤度比 ── 設計記録（v1.2.0）と軸3の構想

2026-08-09 副院長裁定の3軸構造。軸1・軸2 は v1.2.0 で実装済み、軸3 は本メモの構想のみ。

方針の正本: 「文献の公表尤度比・感度・特異度は載せない（数値の正本は bedside-bayes）。
自分の記録から算出した実測値は表示する」── この線引きは README・acceptance C2.3・
content.yaml 冒頭注記に同じ文で置いてある。

## 軸1（定性）── 実装記録

- **データ:** ロック時点の snapshot（`snapOf(c)`）の `exam.checks`（1=あり/−1=なし/欠落=未評価）×
  後日追記 `outcome.diseasePresent`（yes/no。unknown は対象外）。病態の同定も snapshot 側
  （ロック後に病態を訂正しても、画像前の採点はロック時点の記録で行う原則に合わせた）
- **2×2:** (病態, 所見) 単位。未評価はその所見の表から除外（病態単位の件数には入る）
- **閾値:** 生件数で 病態あり≥10 かつ なし≥10 の行だけ数値を出す。未満は
  「病態あり◯/10・なし◯/10」の進捗のみ（定数 `PLR_MIN_PRESENT`/`PLR_MIN_ABSENT`）
- **算出:** 感度・特異度 → lp=sens/(1−spec)、ln=(1−sens)/spec（一組の数字の規律。
  bedside-bayes の eig_inputs と同じ思想）。95%CI は log法 exp(ln LR ± 1.96×SE)、
  SE(lnLR+)=√(1/TP−1/(TP+FN)+1/FP−1/(FP+TN))、SE(lnLR−) は FN/TN 側。
  ゼロセルは全セル +0.5（Haldane）で「補正あり」を明示。補正後は全セル>0 なので分母は消えない
- **verification bias 注記を固定表示**（「なし」側は疑ったが違った症例だけから来ている）。
  端末内完結の明記も固定表示（2026-08-09 副院長指示・プライバシー）
- **POCUS 所見（pocus.checks）は v1 では対象外。** 理由: POCUS は答え合わせ側の道具であり、
  「POCUS所見 × 最終診断」の較正は別の問い（POCUS の腕）になる。次版で分けて検討
- **一致判定（match）とは独立。** match は「予測と最終診断の一致」、diseasePresent は
  「S1の病態そのものの有無」。胸水を疑って外れたが別病態だった症例は match=いいえ・
  diseasePresent=いいえ、と両方に別々の意味で入る

## 軸2（定量）── 実装記録

- **データ:** `qtype=quant`（snapshot 優先）かつ snapshot の `pre.quantPred.value` と
  後日追記 `outcome.quantActual.value` が両方数値の、ロック済み記録
- **ずれ:** 予測 − 実測（＋＝予測が高い）。病態×単位（肋間/cm/その他。未選択は その他 扱い）で
  グループ化し、n≥5 で 平均ずれ・標本SD（n−1）・RCV=√2×1.96×SD。n<5 は文言のみ
- **RCV の位置づけ:** ガイド p.156「RCV の輸入」（検体検査の reference change value を
  身体所見へ）の、このアプリでの操作化。ここでの SD は検者内反復測定の SD ではなく
  「予測と実測のずれ」の SD なので、床としてはやや保守的（予測誤差＝検者内変動＋較正ずれ）
- **単位既定なし:** quantPred.unit は初期値を置かない（勝手な既定は誤記録を作る）。
  未選択のまま実測が揃った記録は「その他」に集計される

## スキーマ（additive・schemaVersion 1 のまま）

| フィールド | 置き場所 | ロック保護 |
|---|---|---|
| `qtype: "qual"\|"quant"` | case 直下（既定 qual）。**lock.snapshot にも入る**（v1.2.0 から） | s1 セクション |
| `pre.quantPred: {value, unit}` | pre 配下 → snapshot に自動で入る（deep copy 実測確認済み） | pre セクション |
| `outcome.diseasePresent: "yes"\|"no"\|"unknown"` | outcome | **保護しない**（画像後の入力） |
| `outcome.quantActual: {value}` | outcome | **保護しない**（画像後の入力） |

v1.1.0 以前の記録は migrateCase が既定値を補完（qual / null / unknown / null）。
v1.1.0 でロックされた記録は snapshot に qtype が無い ── `qtypeOf()` が現行 `c.qtype` へ
フォールバックする（移行後は必ず qual なので実害なし）。

## 書き出し（personal-panel 契約 version 1）

インターフェース契約は acceptance C13.4 に固定（bedside 側実装と共通・一字も変えない）。
- 病態 → bedsideKey: **pneumonia→cap / effusion→eff / hf→hf / copd→copd**
  （2026-08-09 に bedside-bayes v2.8.1 `index.html` の `const DB` キーを実物確認）。
  pneumothorax / asthma / other はエンジン側に対応タブがなく書き出し対象外（注記表示）
- findings は閾値を満たした行のみ。**LR+ の大小では絞らない** ── LR+≤1 の「不成立実測」も
  正直に渡す（エンジン側が「実測では判別できず」と表示。bedside v2.9.0 仕様）
- counts は生の整数 2×2。導出値（sens/spec/lp/ln/ci/cin）は補正時は補正後の一組から計算し、
  **丸めずに全精度**で出す（2026-08-09 に「小数3桁丸め」指示は撤回 ── エンジン側が
  「JSON 内の sens/spec から再計算した lp と JSON 内の lp の ±1% 整合」を検証するため、
  spec が 1 に近い行では丸めた値からの再計算が ±1% を超えて拒否される）。
  `corrected` で補正の有無を渡す。表示用の丸めは renderStats 側だけ
- 受け側は bedside-bayes v2.9.0（PR #9）で実装済み

## 軸3（予後）── 構想のみ（未実装）

問い: 「所見は診断だけでなく、経過を予言できるか」。ガイド第一法則（時間分解能）と
第10章06（定点観測）の実測版。

- **記録:** 後日追記に「30日時点の転帰」ブロックを additive に足す
  （例: `outcome.followup: {at30d: "improved"|"unchanged"|"worse"|"dead"|"unknown", note}`）。
  画像後の入力なのでロック保護の外、という軸1と同じ整理
- **集計:** ロック時点の所見 × 転帰の 2×2 →「予後の自分尤度比」。軸1と同じ計算器
  （lrFromCounts）を流用できる設計にしてある
- **表示閾値:** 軸1と同じ「両側10例」を仮置きするが、転帰イベントは稀なので
  実装時に裁定を仰ぐ（イベント側5例まで緩める案）
- **課題:** ①転帰の正本をどこに置くか（30日を覚えて追記できるか ── 一覧に「転帰未記入」
  バナーを出す動線が要る）②死亡・転院の censoring ③診断の尤度比と混ぜて表示しない
  （別ブロック必須）④bedside-bayes への書き出しは診断パネルと別契約（type: "prognostic-panel" 等、
  bedside 側に受け手が無いので当面書き出さない）
- **契約 v2 の課題（2026-08-09 エンジン側から申し送り）:** 機序クラスタ（cl）が
  personal-panel 契約に無い。エンジン側は同一 cl の2つ目以降を κ で減衰させるが、
  実測所見には cl が付かないため、**同じ手技の文献値と実測値を両方オンにすると
  κ 減衰で結ばれず、相関する情報を独立に二重計上しうる**。契約 v2 で findings に
  cl（エンジン側の既存クラスタ名）を渡すか、エンジン側で id 対応表を持つかは次版で裁定

## 実装ノート（次に触る人へ）

- 集計ロジックは純関数群: `personalLRTargets` / `personalLRAggregate` / `lrFromCounts` /
  `plrRowEligible` / `buildPersonalPanel` / `quantAggregate`（index.html）。
  node+vm のロジックテスト28項目で検証（acceptance C13.5）
- 書き出し JSON に丸め処理は**存在しない**（全精度）。表示は renderStats の toFixed(2)／%整数のみ。
  照合スクリプトを書くときの注意: JS の Math.round は正の .5 を切り上げ、Python の round は
  偶数丸め（0.3125×1000 → JS 313 / Python 312。開発時に実際に踏んだ。丸め比較を書くなら JS 側規則で）
- 新規UI文言はすべて content.yaml の ui_copy（build.py の UI_COPY_KEYS が検証）。
  進捗と件数のフォーマット文字列（plr_progress / plr_group_fmt）は {present}/{absent}
  プレースホルダ必須（build.py が検査）
