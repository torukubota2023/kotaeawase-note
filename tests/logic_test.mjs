/* 答え合わせノート ── 論理の試験（node だけで走る。画面は使わない）
   走らせ方:  node tests/logic_test.mjs      （リポジトリの一番上で）
   やっていること:
     index.html の <script> を取り出し、画面の部品を空のダミーに差し替えた入れ物（vm）で動かして、
     数え方・固定の規律・旧い記録の読み込み・見るだけの番人 を確かめる。
     「旧い版と同じ答えになるか」は、git の HEAD にある index.html を同じ入れ物で動かして突き合わせる。
   2026-11-15 試作と同時に作成（それ以前の試験は一時領域にあって残っていない）。 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function scriptOf(html) {
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  return m.join("\n;\n");
}

/* 画面の部品のダミー。何を呼ばれても黙って受ける */
function makeEl() {
  return {
    style: {}, dataset: {}, children: [], innerHTML: "", textContent: "", value: "", hidden: false, disabled: false,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    appendChild() {}, insertBefore() {}, remove() {}, scrollIntoView() {}, focus() {}, click() {},
    closest() { return null; }, getBoundingClientRect() { return { width: 0, height: 0 }; }
  };
}
function makeSandbox() {
  const store = new Map();
  const localStorage = {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  };
  const byId = new Map();
  const el = id => { if (!byId.has(id)) byId.set(id, makeEl()); return byId.get(id); };
  const document = {
    body: makeEl(), documentElement: makeEl(), visibilityState: "visible",
    getElementById: id => el(id),
    querySelector: sel => el(sel), querySelectorAll: () => [],
    createElement: () => makeEl(), addEventListener() {}
  };
  const sb = {
    console, localStorage, document, URL, Blob,
    location: { hash: "", protocol: "http:", href: "http://localhost/" },
    navigator: { userAgent: "node-test" },
    setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    matchMedia: () => ({ matches: false }),
    __confirm: true, __alerts: [], __confirms: []
  };
  sb.confirm = msg => { sb.__confirms.push(String(msg)); return sb.__confirm; };
  sb.alert = msg => { sb.__alerts.push(String(msg)); };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.__store = store;
  return sb;
}
function boot(html) {
  const sb = makeSandbox();
  const ctx = vm.createContext(sb);
  vm.runInContext(scriptOf(html), ctx, { filename: "index.html<script>" });
  const run = code => vm.runInContext(code, ctx);
  return { sb, run, json: code => JSON.parse(run("JSON.stringify(" + code + ")")) };
}

/* AWN_HTML=別の写しの場所 を付けると、その写しを試験する（わざと壊した写しで、試験が落ちることを確かめる用） */
const NEW_HTML = fs.readFileSync(process.env.AWN_HTML || path.join(ROOT, "index.html"), "utf-8");
let OLD_HTML = null;
try { OLD_HTML = execSync("git show HEAD:index.html", { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString("utf-8"); }
catch (e) { console.log("（git の HEAD が読めないので、旧版との突き合わせは飛ばします）"); }

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b }); }

/* ------------------------------------------------------------------ A. 固定の規律 */
{
  const { run, json } = boot(NEW_HTML);
  run(`
    var c = newCase();
    c.question = "右下肺の濁音は胸水か"; c.disease = "effusion";
    c.pre.firstDx = "右 胸水"; c.pre.conf = 70; c.pre.confTouched = true;
    c.pre.site.sides = ["右"];
    c.exam.checks = { ef_stony_dullness: 1 };
    var r1 = lockCase(c);
  `);
  eq("A1 固定できる", run("r1"), "ok");
  eq("A2 固定で写し（snapshot）が残る", run("c.lock.snapshot.pre.conf"), 70);
  eq("A3 固定後は保護された欄に書けない", run("writeCase(c, 'pre', cc => { cc.pre.conf = 100; })"), false);
  eq("A4 書けなかったので値は元のまま", run("c.pre.conf"), 70);
  run("__confirm = true; editAfterLock(c, 'pre'); writeCase(c, 'pre', cc => { cc.pre.conf = 100; });");
  eq("A5 訂正すると印が付く", run("c.editedAfterLock"), true);
  eq("A6 訂正しても写しは元の値", run("c.lock.snapshot.pre.conf"), 70);
  eq("A7 訂正の履歴が1件", run("c.editLog.length"), 1);
  run("writeCase(c, 'outcome', cc => { applyMatch(cc, 'no'); }); flushSave();");
  eq("A8 採点は写しの確信度で行う（70%で外れ＝0.49）", +run("brierFor([c])").toFixed(4), 0.49);
  eq("A9 二度目の固定は断られる", run("lockCase(c)"), "already");
  eq("A10 端末に保存された記録でも写しは元の値", json("loadCaseById(c.id).lock.snapshot.pre.conf"), 70);
  eq("A11 写しに問い・病態・診察が入っている",
    json("[c.lock.snapshot.question, c.lock.snapshot.disease, c.lock.snapshot.exam.checks.ef_stony_dullness]"),
    ["右下肺の濁音は胸水か", "effusion", 1]);
}

/* ------------------------------------------------------------------ B. 三つの部品と点数 */
{
  const { run, json } = boot(NEW_HTML);
  run(`
    function mk(opt) {
      var c = newCase(); c.question = "q"; c.disease = opt.disease || "effusion";
      c.pre.firstDx = "x"; c.pre.conf = opt.conf == null ? 70 : opt.conf; c.pre.confTouched = true;
      if (opt.site) c.pre.site.sides = ["右"];
      if (opt.quant) { c.qtype = "quant"; c.pre.quantPred = { value: 6, unit: "肋間" }; }
      lockCase(c);
      if (opt.at) c.lock.lockedAt = opt.at;
      if (opt.match) c.outcome.match = opt.match;
      if (opt.parts) c.outcome.parts = opt.parts;
      if (opt.miss != null) c.compare.missPrimary = opt.miss;
      if (opt.next) c.compare.nextAction = opt.next;
      return c;
    }
  `);
  eq("B1 はい・部位あり", json("partsOf(mk({match:'yes', site:true}))"), { what: "hit", where: "hit", howmuch: "na" });
  eq("B2 はい・部位なし", json("partsOf(mk({match:'yes'}))"), { what: "hit", where: "na", howmuch: "na" });
  eq("B3 はい・数値の予測あり", json("partsOf(mk({match:'yes', quant:true}))"), { what: "hit", where: "na", howmuch: "hit" });
  eq("B4 いいえ", json("partsOf(mk({match:'no', site:true}))"), { what: "miss", where: "na", howmuch: "na" });
  eq("B5 部分・三つとも記入", json("partsOf(mk({match:'partial', parts:{what:'hit', where:'miss', howmuch:'na'}}))"),
    { what: "hit", where: "miss", howmuch: "na" });
  eq("B6 部分・未記入は数えない", json("partsOf(mk({match:'partial'}))"), { what: null, where: null, howmuch: null });
  eq("B7 未確定", json("partsOf(mk({}))"), { what: null, where: null, howmuch: null });
  eq("B8 点数: 部分で「何が」当たり＝100", run("caseScore(mk({match:'partial', parts:{what:'hit', where:'miss', howmuch:'na'}}))"), 100);
  eq("B9 点数: 部分で「何が」外れ＝0", run("caseScore(mk({match:'partial', parts:{what:'miss', where:'hit', howmuch:'na'}}))"), 0);
  eq("B10 点数: 部分で「何が」を問うていない＝数えない", run("caseScore(mk({match:'partial', parts:{what:'na', where:'hit', howmuch:'na'}}))"), null);
  eq("B11 点数: 部分の未記入＝数えない", run("caseScore(mk({match:'partial'}))"), null);
  eq("B12 0.5例は使わない（70%・部分・何が当たり＝0.09）",
    +run("brierFor([mk({match:'partial', conf:70, parts:{what:'hit', where:'miss', howmuch:'na'}})])").toFixed(4), 0.09);
  eq("B13 固定していない記録は点数なし", run("(function(){ var c = newCase(); c.outcome.match = 'yes'; return caseScore(c); })()"), null);
  eq("B14 不正な値は未記入扱い", json("partsOf(mk({match:'partial', parts:{what:'maybe', where:'hit', howmuch:'na'}}))"),
    { what: null, where: "hit", howmuch: "na" });

  /* 判定の履歴 */
  run("var h = mk({}); writeCase(h, 'outcome', cc => { applyMatch(cc, 'yes'); });");
  eq("B15 最初の判定は履歴1件・付け替え0回", json("[h.outcome.judgeLog.length, judgeChanges(h)]"), [1, 0]);
  run("writeCase(h, 'outcome', cc => { applyMatch(cc, 'no'); });");
  eq("B16 付け替えると履歴2件・付け替え1回", json("[h.outcome.judgeLog.length, judgeChanges(h)]"), [2, 1]);
  eq("B17 履歴に、何から何へ が残る", json("[h.outcome.judgeLog[1].from, h.outcome.judgeLog[1].to, h.outcome.judgeLog[1].k]"), ["yes", "no", "match"]);
  eq("B18 同じ値をもう一度入れても履歴は増えない", run("(function(){ var cc = h; return applyMatch(cc, 'no'); })()"), false);
  run("writeCase(h, 'outcome', cc => { applyMatch(cc, 'partial'); applyPart(cc, 'what', 'hit'); applyPart(cc, 'where', 'miss'); });");
  eq("B19 部品の最初の記入は付け替えに数えない", run("judgeChanges(h)"), 2);
  run("writeCase(h, 'outcome', cc => { applyPart(cc, 'where', 'hit'); });");
  eq("B20 部品を変えると付け替えに数える", run("judgeChanges(h)"), 3);
  eq("B21 履歴は固定の印（画像後修正）とは別", run("h.editedAfterLock"), false);
  eq("B22 知らない部品名は受け付けない", run("(function(){ return applyPart(h, 'zzz', 'hit'); })()"), false);

  /* 一か月の一枚の数え上げ */
  run(`
    var cs = [
      mk({match:'yes', site:true, conf:80, at:'2026-11-01T01:00:00.000Z', miss:'none'}),
      mk({match:'no', conf:90, at:'2026-11-02T01:00:00.000Z', miss:'technique', next:'打診を弱く'}),
      mk({match:'partial', conf:40, at:'2026-11-03T01:00:00.000Z', parts:{what:'hit', where:'miss', howmuch:'na'}, miss:'anatomy'}),
      mk({match:'partial', conf:60, at:'2026-11-04T01:00:00.000Z'}),
      mk({conf:95, at:'2026-11-05T01:00:00.000Z'}),
      mk({match:'no', conf:50, at:'2026-11-06T01:00:00.000Z', miss:'conditions', next:'体位を変える'}),
      (function(){ var d = newCase(); d.disease = 'effusion'; d.question = '下書き'; return d; })()
    ];
    var ag = sheetAggregate(cs, "");
  `);
  eq("B30 固定した記録の数", run("ag.locked"), 6);
  eq("B31 下書きの数", run("ag.drafts"), 1);
  eq("B32 判定済み＋未判定＝固定した記録", json("[ag.judged, ag.unjudged, ag.judged + ag.unjudged === ag.locked]"), [5, 1, true]);
  eq("B33 部分の中身が未記入の数", run("ag.partsPending"), 1);
  eq("B34 何が: 4例中2例", json("[ag.parts.what.n, ag.parts.what.hit, ag.parts.what.miss]"), [4, 2, 2]);
  eq("B35 どこに: 2例中1例", json("[ag.parts.where.n, ag.parts.where.hit, ag.parts.where.miss]"), [2, 1, 1]);
  eq("B36 どれくらい: 0例", run("ag.parts.howmuch.n"), 0);
  eq("B37 各部品で 当たり＋外れ＝分母", json("['what','where','howmuch'].every(k => ag.parts[k].hit + ag.parts[k].miss === ag.parts[k].n)"), true);
  eq("B38 確信度の帯の合計＝「何が」が決まった数", json("[ag.bands.reduce((t,b)=>t+b.n,0), ag.parts.what.n]"), [4, 4]);
  eq("B39 帯ごとの件数（50以下・51〜79・80以上）", json("ag.bands.map(b => [b.n, b.hit])"), [[2, 1], [0, 0], [2, 1]]);
  eq("B40 確信度どおりなら の目安（80+90=170 → 2例）", run("ag.bands[2].expect"), 2);
  eq("B41 外れの一覧は3件（手技・解剖・条件）", json("ag.misses.map(m => m.group).sort()"), ["hand", "hand", "reach"]);
  eq("B42 外れの一覧は新しい順", json("ag.misses.map(m => m.cat)"), ["conditions", "anatomy", "technique"]);
  eq("B43 外れを分類して次の一手まで書いた数", run("ag.reviewed"), 2);
  eq("B44 帯は固定した記録の数だけ", run("ag.strip.length"), 6);
  eq("B45 帯は古い順", json("ag.strip.map(s => s.day.slice(8))").length, 6);
  eq("B46 20例以下では前半後半を出さない", json("Object.keys(ag.halves)"), []);
  eq("B47 病態で絞ると分母も絞られる", run("sheetAggregate(cs, 'pneumonia').locked"), 0);
  run(`
    var many = []; for (var i = 0; i < 25; i++) many.push(mk({match: i % 5 === 0 ? 'no' : 'yes', conf:70,
      at: '2026-10-' + String(i + 1).padStart(2, '0') + 'T01:00:00.000Z'}));
    var ag2 = sheetAggregate(many, "");
  `);
  eq("B48 21例以上で前半後半（何が）", json("ag2.halves.what"), { n1: 12, a1: 9, n2: 13, a2: 11 });
  eq("B49 前半＋後半＝全体", json("ag2.halves.what.n1 + ag2.halves.what.n2 === ag2.parts.what.n && ag2.halves.what.a1 + ag2.halves.what.a2 === ag2.parts.what.hit"), true);
  eq("B50 8分類は二つの組に過不足なく入る", json("CATS.every(c => GROUP_OF[c.id] === 'hand' || GROUP_OF[c.id] === 'reach')"), true);

  /* 期間 */
  eq("B51 期間: 範囲内", run("inPeriod(cs[0], ['2026-11-01', '2026-11-30'])"), true);
  eq("B52 期間: 範囲外", run("inPeriod(cs[0], ['2026-12-01', '2026-12-31'])"), false);
  eq("B53 期間: すべて", json("periodRange('all')"), ["", ""]);
  ok("B54 期間: 直近30日は今日で終わる", run("periodRange('last30')[1] === todayStr()"));
  ok("B55 期間: 今月は1日から", run("periodRange('this_month')[0].slice(8) === '01'"));

  /* 固定の前の確かめ */
  run("var w1 = newCase(); w1.question = 'q'; w1.disease = 'other';");
  eq("B60 第一候補が空・確信度が初めのまま → 2つ確かめる", run("lockWarnings(w1).length"), 2);
  run("w1.pre.firstDx = 'x'; w1.pre.confTouched = true;");
  eq("B61 書いてあれば確かめない（50%を自分で選んだ場合も）", run("lockWarnings(w1).length"), 0);
  run("w1.qtype = 'quant';");
  eq("B62 数値の問いで予測値が空 → 確かめる", run("lockWarnings(w1).length"), 1);
  run("w1.pre.conf = 60; w1.pre.confTouched = false; w1.qtype = 'qual';");
  eq("B63 50%以外なら、触った印が無くても確かめない", run("lockWarnings(w1).length"), 0);
}

/* ------------------------------------------------------------------ C. 記録者・控え・見るだけ */
{
  const { sb, run, json } = boot(NEW_HTML);
  run("lsSet(K_SETTINGS, { recorderName: '研修医A' });");
  run("var a = newCase(); a.question = 'q'; a.disease = 'effusion'; a.pre.firstDx = 'x'; lockCase(a);");
  eq("C1 新しい記録に呼び名が付く", run("a.recorder"), "研修医A");
  eq("C2 固定の記録にも呼び名", run("a.lock.recorder"), "研修医A");
  const b = json("(function(){ var b = backupBlob(); return { name: b.name, data: JSON.parse(b.json) }; })()");
  eq("C3 控えの中身に呼び名", b.data.recorder, "研修医A");
  ok("C4 控えのファイル名に呼び名", /^kotaeawase-backup-研修医A-\d{8}\.json$/.test(b.name), b.name);
  eq("C5 控えに症例が入る", b.data.cases.length, 1);
  run("lsSet(K_SETTINGS, { recorderName: 'a/b c:d' });");
  ok("C6 ファイル名に使えない字は置き換える", /^kotaeawase-backup-a_b_c_d-\d{8}\.json$/.test(run("backupBlob().name")), run("backupBlob().name"));
  run("lsSet(K_SETTINGS, {});");
  ok("C7 呼び名が無ければ従来のファイル名", /^kotaeawase-backup-\d{8}\.json$/.test(run("backupBlob().name")), run("backupBlob().name"));
  run("var late = newCase(); late.question = 'q'; late.disease = 'effusion'; lsSet(K_SETTINGS, { recorderName: '久保田' }); lockCase(late);");
  eq("C8 呼び名をあとから入れても、固定のときに付く", run("late.recorder"), "久保田");
  ok("C9 書き出しに記録者の行", run("buildExportText(a)").includes("記録者: 研修医A"));

  /* 見るだけ */
  const before = JSON.stringify([...sb.__store.entries()]);
  run(`
    var theirs = migrateCase(JSON.parse(JSON.stringify(a))); theirs.id = "their1"; theirs.recorder = "研修医B";
    enterView({ recorder: "研修医B", exportedAt: "2026-11-15T00:00:00.000Z", cases: [theirs], quick: [], tracks: [] });
  `);
  eq("C10 見るだけ: 一覧は相手の記録だけ", json("allCases().map(c => c.id)"), ["their1"]);
  eq("C11 見るだけ: 保存は断られる", run("persistCase(theirs)"), false);
  eq("C12 見るだけ: 書き込みは断られる", run("writeCase(theirs, 'outcome', cc => { applyMatch(cc, 'yes'); })"), false);
  eq("C13 見るだけ: 判定は変わっていない", run("theirs.outcome.match"), "pending");
  eq("C14 見るだけ: 補記は断られる", run("addAddendum(theirs, 'x')"), false);
  eq("C15 見るだけ: 訂正の解錠は断られる", run("editAfterLock(theirs, 'pre')"), false);
  eq("C16 見るだけ: 新しい固定は断られる", run("(function(){ var n = newCase(); n.question='q'; n.disease='effusion'; return lockCase(n); })()"), "already");
  eq("C17 見るだけ: 経過の保存は断られる", run("saveTracks([{id:'t'}])"), false);
  eq("C18 見るだけのあいだ、端末の保存場所は1文字も変わらない", JSON.stringify([...sb.__store.entries()]), before);
  run("exitView();");
  eq("C19 やめると自分の記録に戻る", json("allCases().map(c => c.id).sort()"), json("[a.id, late.id].sort()"));
  eq("C20 やめたあとは書ける", run("persistCase(a)"), true);
  eq("C21 相手の記録は端末に残っていない", run("loadCaseById('their1')"), null);
}

/* ------------------------------------------------------------------ D. 旧い記録が読めるか（旧版と突き合わせ） */
{
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/fixtures/personal_lr_fixture_v120.json"), "utf-8"));
  const fxCases = Array.isArray(fx) ? fx : (fx.cases || []);
  ok("D0 見本の旧い記録が読める", fxCases.length > 0, fxCases.length);
  const load = html => {
    const t = boot(html);
    t.sb.__fx = JSON.stringify(fxCases);
    t.run("var FX = JSON.parse(__fx).map(migrateCase).filter(Boolean);");
    return t;
  };
  const nw = load(NEW_HTML);
  eq("D1 旧い記録が1件も落ちない", nw.run("FX.length"), fxCases.length);
  eq("D2 旧い記録に、記録者・履歴・部品の欄が足される（中身は空）",
    nw.json("FX.every(c => c.recorder === '' && Array.isArray(c.outcome.judgeLog) && c.outcome.judgeLog.length === 0 && c.outcome.parts === null)"), true);
  eq("D3 旧い記録の判定は書き換わらない",
    nw.json("FX.map(c => c.outcome.match)"), fxCases.map(c => (c.outcome && c.outcome.match) || "pending"));
  eq("D4 旧い記録の写し（snapshot）は書き換わらない",
    nw.json("FX.map(c => c.lock ? c.lock.snapshot : null)").map(s => JSON.stringify(s)),
    fxCases.map(c => JSON.stringify(c.lock ? JSON.parse(JSON.stringify(c.lock.snapshot)) : null)));
  eq("D5 旧い記録は、付け替え0回・部品の未記入なし（部分が無ければ）",
    nw.json("FX.every(c => judgeChanges(c) === 0)"), true);
  if (OLD_HTML) {
    const od = load(OLD_HTML);
    const same = (name, code) => eq(name, nw.json(code), od.json(code));
    same("D10 自分の尤度比の数え上げが旧版と同じ", "personalLRAggregate(personalLRTargets(FX, ''))");
    same("D11 数値の問いの集計が旧版と同じ", "quantAggregate(FX, '')");
    same("D12 音の読みの集計が旧版と同じ", "readingAxisAggregate(FX, '')");
    same("D13 確信度の動きの集計が旧版と同じ", "statsMove(FX.filter(c => c.lock))");
    same("D14 書き出しの文面が旧版と同じ（部分でない旧い記録）",
      "FX.filter(c => c.outcome.match !== 'partial').map(c => buildExportText(c))");
    same("D15 病態ごとの控え（橋渡しの形）が旧版と同じ",
      "(function(){ var ag = personalLRAggregate(personalLRTargets(FX, '')); return Object.keys(ag).map(k => { var p = buildPersonalPanel(k, ag[k]); if (p) delete p.exportedAt; return p; }); })()");
    /* 確信度のずれ: 「部分」が無い記録だけなら旧版と同じ。部分は数え方を変えたので別に確かめる */
    const noPartial = "FX.filter(c => c.lock && (c.outcome.match === 'yes' || c.outcome.match === 'no'))";
    eq("D16 確信度のずれ（はい／いいえだけ）が旧版と同じ", nw.run("brierFor(" + noPartial + ")"), od.run("brierFor(" + noPartial + ")"));
    /* 見本の記録は判定がすべて未確定なので、同じ判定を両方の版で付けてから比べる */
    const setM = "FX.forEach((c, i) => { c.outcome.match = ['yes', 'no', 'pending'][i % 3]; });";
    nw.run(setM); od.run(setM);
    const yn = "FX.filter(c => c.lock && (c.outcome.match === 'yes' || c.outcome.match === 'no'))";
    ok("D18 はい／いいえを付けた記録が実際にある", nw.run(yn + ".length") >= 10, nw.run(yn + ".length"));
    eq("D19 確信度のずれ（はい／いいえ）が旧版と同じ値", nw.run("brierFor(" + yn + ")"), od.run("brierFor(" + yn + ")"));
    ok("D20 その値は数として出ている", typeof nw.run("brierFor(" + yn + ")") === "number");
    same("D21 判定を付けたあとの書き出しも旧版と同じ", "FX.map(c => buildExportText(c))");
    eq("D17 旧版の控えを新版で読み、もう一度書き出しても症例の数が同じ",
      nw.run("(function(){ FX.forEach(c => lsSet(K_CASE + c.id, c)); return JSON.parse(backupBlob().json).cases.length; })()"), fxCases.length);
  }
}

/* ------------------------------------------------------------------ E. 独立した確認で見つかった穴（2026-11-15）への対処 */
{
  const { sb, run, json } = boot(NEW_HTML);
  run(`
    function mkL(conf) {
      var c = newCase(); c.question = "q"; c.disease = "effusion"; c.pre.firstDx = "x"; c.pre.conf = conf || 90; c.pre.confTouched = true;
      lockCase(c); return c;
    }
    var a = mkL(90);
    var stale = JSON.parse(JSON.stringify(a));          // 入力画面が覚えていた古い写し
    var fresh = loadCaseById(a.id);                      // 詳細画面が読み直した新しい写し
    writeCase(fresh, 'outcome', cc => { applyMatch(cc, 'no'); }); flushSave();
    stale.pocus.definitive = 'yes'; stale.updatedAt = nowISO();
    var r1 = persistCase(stale);                         // 古い写しで、判定と関係ない欄を保存
  `);
  eq("E1 古い写しで保存しても、端末の判定は消えない", json("[r1, loadCaseById(a.id).outcome.match, loadCaseById(a.id).outcome.judgeLog.length]"), [true, "no", 1]);
  eq("E2 古い写しの変更（判定と関係ない欄）は入る", run("loadCaseById(a.id).pocus.definitive"), "yes");
  run("applyMatch(stale, 'yes'); persistCase(stale);");
  eq("E3 そのあと判定を変えると、付け替えとして残る", json("(function(){ var c = loadCaseById(a.id); return [c.outcome.match, c.outcome.judgeLog.length, judgeChanges(c), c.outcome.judgeLog[1].from]; })()"), ["yes", 2, 1, "no"]);
  run(`
    var b = mkL(90);
    var stale2 = JSON.parse(JSON.stringify(b));
    var fresh2 = loadCaseById(b.id); writeCase(fresh2, 'outcome', cc => { applyMatch(cc, 'no'); }); flushSave();
    applyMatch(stale2, 'yes');                           // 古い写しのまま（未確定から）判定を付ける
    persistCase(stale2);
  `);
  eq("E4 古い写しで付けた判定も、端末の判定からの付け替えとして残る（跡なしで 0.81→0.01 にならない）",
    json("(function(){ var c = loadCaseById(b.id); return [c.outcome.match, c.outcome.judgeLog.map(l => l.from + '>' + l.to), judgeChanges(c)]; })()"),
    ["yes", ["pending>no", "pending>yes".replace("pending>yes", "no>yes")], 1]);
  run(`
    var d = newCase(); d.question = "q"; d.disease = "effusion"; d.pre.firstDx = "x"; persistCase(d);
    var draftCopy = JSON.parse(JSON.stringify(d));       // 固定前の古い写し
    lockCase(d);
    draftCopy.pre.conf = 10; var r2 = persistCase(draftCopy);
  `);
  eq("E5 固定前の古い写しでは、固定済みの記録を上書きできない", json("[r2, !!loadCaseById(d.id).lock, loadCaseById(d.id).lock.snapshot.pre.conf]"), [false, true, 50]);
  run(`
    var e = mkL(70); var staleE = JSON.parse(JSON.stringify(e));
    var freshE = loadCaseById(e.id); addAddendum(freshE, "（試し）補記"); __confirm = true; editAfterLock(freshE, 'pre');
    staleE.compare.nextAction = "x"; persistCase(staleE);
  `);
  eq("E6 古い写しで保存しても、補記・訂正の印・訂正の履歴は減らない",
    json("(function(){ var c = loadCaseById(e.id); return [c.addenda.length, c.editedAfterLock, c.editLog.length, c.compare.nextAction]; })()"), [1, true, 1, "x"]);
  /* ② 復元で記録が入れ替わったあと、前の解錠が残らない */
  run(`
    var g = mkL(70); var orig = JSON.stringify(loadCaseById(g.id));
    __confirm = true; editAfterLock(g, 'pre');
    localStorage.setItem(K_CASE + g.id, orig);            // 控えからの全置換を模す（印の無い記録に戻る）
    var g2 = loadCaseById(g.id);
  `);
  eq("E7 印の無い記録には、前の解錠は効かない", json("[g2.editedAfterLock, canWriteSection(g2, 'pre'), writeCase(g2, 'pre', cc => { cc.pre.conf = 99; }), g2.pre.conf]"), [false, false, false, 70]);
  eq("E8 印と履歴のある記録では、解錠は効く（従来どおり）", run("canWriteSection(g, 'pre')"), true);
  eq("E9 別の欄の解錠にはならない", run("canWriteSection(g, 'exam')"), false);
  /* ⑤ 履歴を残さない版で変えた判定 */
  run(`
    var h = mkL(60); applyMatch(h, 'partial'); h.outcome.match = 'yes';   // 旧い版が履歴なしで書き換えた状態
    var h2 = migrateCase(JSON.parse(JSON.stringify(h)));
  `);
  eq("E10 履歴と食い違う判定は、読み込んだときに付け替えとして1行足される", json("[h2.outcome.judgeLog.length, h2.outcome.judgeLog[1].from, h2.outcome.judgeLog[1].to, h2.outcome.judgeLog[1].ext, judgeChanges(h2)]"), [2, "partial", "yes", true, 1]);
  eq("E11 もう一度読んでも増えない", run("migrateCase(JSON.parse(JSON.stringify(h2))).outcome.judgeLog.length"), 2);
  /* ⑥ 旧い「部分」の書き出し */
  run("var lp = mkL(60); lp.outcome.match = 'partial';");
  ok("E12 部品を書いていない「部分」の書き出しには、部品の行を足さない", !run("buildExportText(lp)").includes(run("J.export_parts")));
  run("applyPart(lp, 'what', 'hit');");
  ok("E13 部品を1つでも書けば、行が出る", run("buildExportText(lp)").includes(run("J.export_parts")));
  /* ⑨ 帯の境目 */
  eq("E14 帯の境目（50・50.5・51・79・79.5・80・-1・101・空）", json("[50, 50.5, 51, 79, 79.5, 80, -1, 101, null].map(bandOf)"),
    ["low", "mid", "mid", "mid", "mid", "high", "low", "high", "low"]);
  run(`
    var odd = [50.5, 79.5, -1, 101, 0, 100].map(function (cf) { var c = mkL(70); c.lock.snapshot.pre.conf = cf; c.outcome.match = 'yes'; return c; });
    var agO = sheetAggregate(odd, "");
  `);
  eq("E15 小数や範囲外の確信度でも、帯の合計＝「何が」の数", json("[agO.bands.reduce((t, b) => t + b.n, 0), agO.parts.what.n]"), [6, 6]);
  /* ④ 見るだけの番人 */
  const before = JSON.stringify([...sb.__store.entries()]);
  run(`
    var th = migrateCase(JSON.parse(JSON.stringify(a))); th.id = "their9";
    enterView({ recorder: "相手", exportedAt: "2026-11-15T00:00:00.000Z", cases: [th], quick: [{id:"q1"}], tracks: [{id:"t1"}] });
    var threw = false; try { lsSet(K_QUICK, [{id:"x"}]); } catch (err) { threw = true; }
    wipeAll();
    handleRestore(JSON.stringify({ app: "kotaeawase-note", schemaVersion: 1, cases: [th], quick: [], tracks: [] }));
    scheduleSave(th);
    exitView(); flushSave();
  `);
  eq("E16 見るだけの最中は、保存の入口が断る", run("threw"), true);
  eq("E17 見るだけの最中の全消去・読み込み・待たせた保存のあとも、端末の保存場所は1文字も変わらない", JSON.stringify([...sb.__store.entries()]), before);
  eq("E18 相手の記録は端末に入っていない", run("loadCaseById('their9')"), null);
}

/* ------------------------------------------------------------------ F. 胸水の上縁: 打診の印と液面のずれ */
{
  const { run, json } = boot(NEW_HTML);
  run(`
    function mkG(o) {
      var c = newCase(); c.question = "q"; c.disease = o.disease || "effusion"; c.qtype = o.qual ? "qual" : "quant";
      c.pre.firstDx = "x"; c.pre.conf = 70; c.pre.confTouched = true;
      if (o.mark !== null) c.pre.mark = o.mark || { posture: "座位", line: "背面・肩甲中線", style: o.style === undefined ? "通常より弱い打診" : o.style };
      lockCase(c);
      if (o.at) c.lock.lockedAt = o.at;
      if (o.mod) c.pocus.modality = o.mod;
      if (o.dir) applyGap(c, { dir: o.dir });
      if (o.cm != null) applyGap(c, { cm: o.cm });
      if (o.match) c.outcome.match = o.match;
      return c;
    }
  `);
  eq("F1 最初に入る線は「背面・肩甲中線」。選択肢に「背面・中央」は無い（肩甲中線に一本化）", json("[GAP_STD_LINE, GAP_LINES.indexOf('背面・肩甲中線') >= 0, GAP_LINES.indexOf('背面・中央') >= 0]"), ["背面・肩甲中線", true, false]);
  eq("F2 液面が印より上＝＋", run("gapOf(mkG({dir:'above', cm:2}))"), 2);
  eq("F3 液面が印より下＝−", run("gapOf(mkG({dir:'below', cm:1.5}))"), -1.5);
  eq("F4 同じ＝0", run("gapOf(mkG({dir:'same'}))"), 0);
  eq("F5 向きだけで cm が無ければ、まだ数えない", run("gapOf(mkG({dir:'above'}))"), null);
  eq("F6 胸部X線・CT で答え合わせした記録では使わない", json("[gapOf(mkG({dir:'above', cm:2, mod:'cxr'})), gapOf(mkG({dir:'above', cm:2, mod:'ct'}))]"), [null, null]);
  ok("F7 本の経験則（印は液面より2cm低い）は ＋2 と出る", run("gapText(gapOf(mkG({dir:'above', cm:2})))").includes("＋2"));
  eq("F8 既定の条件（座位・背面の肩甲中線）", run("gapStd(mkG({dir:'same'}))"), true);
  eq("F9 線が違う（背面・脊柱寄り）は既定と別に扱う。過去の語「背面・中央」は肩甲中線と同じ線として扱う",
    json("[gapStd(mkG({dir:'same', mark:{posture:'座位', line:'背面・脊柱寄り', style:''}})), gapStd(mkG({dir:'same', mark:{posture:'座位', line:'背面・中央', style:''}}))]"), [false, true]);
  eq("F10 体位が違う・条件の記録なしも別に扱う", json("[gapStd(mkG({dir:'same', mark:{posture:'側臥位', line:'背面・肩甲中線', style:''}})), gapStd(mkG({dir:'same', mark:null}))]"), [false, false]);
  run("var gm = mkG({dir:'above', cm:2}); __confirm = true; editAfterLock(gm, 'pre'); writeCase(gm, 'pre', cc => { cc.pre.mark.line = '背面・脊柱寄り'; });");
  eq("F11 印の条件は固定の写しに入り、あとで直しても集計は写しを使う", json("[gm.lock.snapshot.pre.mark.line, gm.pre.mark.line, gapStd(gm), gm.editedAfterLock]"), ["背面・肩甲中線", "背面・脊柱寄り", true, true]);
  eq("F12 胸水の数値の問いのときだけ聞く", json("[gapEligible(mkG({})), gapEligible(mkG({qual:true})), gapEligible(mkG({disease:'pneumonia'}))]"), [true, false, false]);
  run(`
    var vals = [2, 2, 1.5, 2.5, 2, 3];
    var gs = vals.map(function (v, i) { return mkG({dir:'above', cm:v, at:'2026-11-' + String(i + 1).padStart(2, '0') + 'T01:00:00.000Z'}); });
    gs.push(mkG({dir:'below', cm:4, at:'2026-11-07T01:00:00.000Z', mark:{posture:'側臥位', line:'側面・中腋窩線', style:'通常より弱い打診'}}));   // 既定と違う条件
    gs.push(mkG({dir:'above', cm:1, at:'2026-11-08T01:00:00.000Z', style:'閾値打診'}));
    gs.push(mkG({dir:'above', cm:9, at:'2026-11-09T01:00:00.000Z', mod:'cxr'}));     // X線 → 入らない
    gs.push(mkG({dir:'same', at:'2026-11-10T01:00:00.000Z', disease:'pneumonia'}));   // 胸水でない → 入らない
    var ga = gapAggregate(gs, "");
  `);
  eq("F13 点は、POCUS の胸水の例だけ（既定6＋閾値1＋条件違い1）", json("[ga.n, ga.std, ga.other]"), [8, 7, 1]);
  eq("F14 点は古い順", json("ga.pts.map(p => p.v)"), [2, 2, 1.5, 2.5, 2, 3, -4, 1]);
  eq("F15 通常より弱い打診: 6例・中央値 2・癖を引いたあとの散らばり 0.25", json("ga.groups[0]"), { posture: "座位", style: "通常より弱い打診", n: 6, median: 2, spread: 0.25 });
  eq("F16 閾値打診: 1例なので数字は出さない", json("ga.groups[1]"), { posture: "座位", style: "閾値打診", n: 1, median: null, spread: null });
  eq("F17 条件の違う例（−4）は、数字に入っていない", run("ga.groups[0].n"), 6);
  eq("F18 4例では中央値を出さない", json("gapAggregate(gs.slice(0, 4), '').groups[0].median"), null);
  eq("F19 5例で出る", run("gapAggregate(gs.slice(0, 5), '').groups[0].median"), 2);
  eq("F20 ほかの病態で絞ると出ない／胸水で絞ると同じ", json("[gapAggregate(gs, 'pneumonia').n, gapAggregate(gs, 'effusion').n]"), [0, 8]);
  eq("F21 一か月の一枚の数え上げに入っている", run("sheetAggregate(gs, '').gap.n"), 8);
  ok("F22 一枚に、点の図と中央値・散らばりの行が出る", (() => { const h = run("sheetHTML(sheetAggregate(gs, ''))"); return h.includes("<svg") && h.includes("ずれの中央値 ＋2.0cm（6例）") && h.includes("癖を引いたあと、半分の例が ±0.25cm の中"); })());
  ok("F23 「この幅を超えたら変化」という読み方を付けていない", !/超えたら|超えて動いた|RCV/.test(run("gapSheetHTML(ga)")));
  /* 付け替えの履歴 */
  run("var gl = mkG({}); applyGap(gl, {dir:'above'}); applyGap(gl, {cm:2});");
  eq("F24 最初の記入は付け替えに数えない", json("[gl.outcome.judgeLog.length, judgeChanges(gl)]"), [1, 0]);
  run("applyGap(gl, {cm:2}); applyGap(gl, {cm:3});");
  eq("F25 同じ値は履歴に足さない／cm の書き直しは履歴に残るが「判定変更」には数えない", json("[gl.outcome.judgeLog.length, judgeChanges(gl), gl.outcome.judgeLog[1].from, gl.outcome.judgeLog[1].to]"), [2, 0, "+2", "+3"]);
  /* 合否の線（いまは未設定） */
  eq("F26 合否の線は未設定", run("GAP_OK"), null);
  run("var ok1 = mkG({dir:'above', cm:1.5, match:'yes'}), ng1 = mkG({dir:'above', cm:3, match:'yes'}), off1 = mkG({dir:'above', cm:3, match:'yes', mark:{posture:'側臥位', line:'', style:''}}), un1 = mkG({dir:'above', cm:1});");
  eq("F27 線が未設定なら、「どこに」は従来どおり", json("[partsOf(ok1).where, partsOf(ng1).where]"), ["na", "na"]);
  run("GAP_OK = 2;");
  eq("F28 線を入れると、内側は当たり・外側は外れ（既定の条件の例だけ）", json("[partsOf(ok1).where, partsOf(ng1).where, partsOf(off1).where, partsOf(un1).where]"), ["hit", "miss", "na", null]);
  eq("F29 線を入れても「何が」と点数は変わらない", json("[partsOf(ng1).what, caseScore(ng1)]"), ["hit", 100]);
  run("GAP_OK = null;");
  /* 書き出し・旧い記録 */
  ok("F30 書き出しに、印の条件とずれが出る", (() => { const t = run("buildExportText(gs[0])"); return t.includes("印を付けた条件: 座位・背面・肩甲中線・通常より弱い打診") && t.includes("印と液面のずれ: 液面は印より 2cm 上（＋2）"); })());
  run("var oldc = migrateCase({ id: 'old1', status: 'locked', pre: { firstDx: 'x', conf: 60 }, exam: {}, pocus: {}, compare: {}, outcome: { match: 'yes' }, lock: { lockedAt: '2026-08-01T00:00:00.000Z', snapshot: { question: 'q', disease: 'effusion', qtype: 'quant', pre: { firstDx: 'x', conf: 60 }, exam: {} } } });");
  eq("F31 旧い記録は、印の条件・ずれとも空のまま読める", json("[oldc.pre.mark, oldc.outcome.gap, gapOf(oldc), gapStd(oldc), sheetAggregate([oldc], '').gap.n]"), [null, null, null, false, 0]);
}

/* ------------------------------------------------------------------ G. 二回目の独立した確認（2026-11-16）で直した点 */
{
  const { run, json } = boot(NEW_HTML);
  run(`
    function mkD(o) {
      var c = newCase(); c.question = "q"; c.disease = o.disease || "effusion"; c.qtype = "quant";
      c.pre.firstDx = "x"; c.pre.conf = 60; c.pre.confTouched = true;
      c.pre.quantPred = { value: 5, unit: "肋間" };
      if (o.mark !== null) c.pre.mark = o.mark || { posture: "座位", line: "背面・肩甲中線", style: o.style === undefined ? "通常より弱い打診" : o.style };
      return c;
    }
    function mkG(o) {
      var c = mkD(o); lockCase(c);
      if (o.dir) applyGap(c, { dir: o.dir });
      if (o.cm != null) applyGap(c, { cm: o.cm });
      if (o.match) c.outcome.match = o.match;
      if (o.parts) c.outcome.parts = o.parts;
      return c;
    }
    /* 二つの画面: a は古い下書きの写し、b は同じ記録を端末から読み直した別の画面 */
    var a = mkD({}); persistCase(a);
    var b = migrateCase(JSON.parse(localStorage.getItem(K_CASE + a.id)));
    var rb = lockCase(b), at0 = b.lock.lockedAt;
    applyMatch(b, "no"); persistCase(b);
    a.pre.conf = 90;
    var ra = lockCase(a);
    var st = JSON.parse(localStorage.getItem(K_CASE + a.id));
  `);
  eq("G1 先に固定された記録は、古い下書きの画面から固定し直せない", json("[rb, ra, !a.lock, a.status]"), ["ok", "stale", true, "draft"]);
  eq("G2 端末の固定の時刻・写し・判定は、そのまま", json("[st.lock.lockedAt === at0, st.lock.snapshot.pre.conf, st.outcome.match, !!st.editedAfterLock]"), [true, 60, "no", false]);
  run("var j = mkG({dir:'above', cm:2}); applyGap(j, {cm:3}); applyGap(j, {dir:'below'});");
  eq("G3 ずれの書き直しは「判定変更」に数えない", json("[j.outcome.judgeLog.length, judgeChanges(j)]"), [3, 0]);
  run("applyMatch(j, 'yes'); applyMatch(j, 'no');");
  eq("G4 判定の付け替えは数える", run("judgeChanges(j)"), 1);
  /* 合否の線を入れたときの数え方 */
  run(`GAP_OK = 2;
    var yIn = mkG({dir:'above', cm:1, match:'yes'}), yOut = mkG({dir:'above', cm:3, match:'yes'}),
        nIn = mkG({dir:'above', cm:1, match:'no'}),
        pHit = mkG({dir:'above', cm:3, match:'partial', parts:{what:'hit', where:'hit', howmuch:'na'}}),
        pNone = mkG({dir:'above', cm:1, match:'partial', parts:{what:'hit'}});`);
  eq("G5 線: 「はい」は内側＝当たり・外側＝外れ", json("[partsOf(yIn).where, partsOf(yOut).where]"), ["hit", "miss"]);
  eq("G6 線: 「いいえ」は「どこに」を数えないまま", run("partsOf(nIn).where"), "na");
  eq("G7 線: 「部分」は本人が入れた値のまま（未記入は未記入のまま）", json("[partsOf(pHit).where, partsOf(pNone).where]"), ["hit", null]);
  run("GAP_OK = null;");
  /* cm の上限 */
  eq("G8 上限は 30cm", run("GAP_CM_MAX"), 30);
  eq("G9 上限ちょうどは数える・超える値は数えない", json("[gapOf(mkG({dir:'above', cm:30})), gapOf(mkG({dir:'above', cm:30.5})), gapOf(mkG({dir:'below', cm:5000000}))]"), [30, null, null]);
  ok("G10 けた外れの値が控えに入っていても、一枚は描ける", (() => { const h = run("sheetHTML(sheetAggregate([mkG({dir:'above', cm:5000000}), mkG({dir:'above', cm:2})], ''))"); return h.includes("<svg") && h.length < 200000; })());
  eq("G11 中央値の表示は 0.25 きざみを丸めない", json("[gapSigned(2.25), gapSigned(2), gapSigned(-0.5), gapSigned(0), cmFmt(0.25)]"), ["＋2.25", "＋2.0", "−0.5", "0", "0.25"]);
  /* 叩き方が未選択 */
  eq("G12 固定の前の確かめ: 叩き方が未選択なら出る・選んであれば出ない・ほかの病態では出ない",
    json("[lockWarnings(mkD({style:''})).length, lockWarnings(mkD({})).length, lockWarnings(mkD({disease:'pneumonia', mark:null})).length]"), [1, 0, 0]);
  ok("G13 一枚に、叩き方の記録なしの例数と理由が出る", run("gapSheetHTML(gapAggregate([mkG({dir:'above', cm:2, style:''}), mkG({dir:'above', cm:1, style:''}), mkG({dir:'above', cm:1})], ''))").includes("叩き方の記録なし 2例"));
  ok("G14 叩き方がそろっていれば、その行は出ない", !/叩き方の記録なし \d+例/.test(run("gapSheetHTML(gapAggregate([mkG({dir:'above', cm:1})], ''))")));
  /* 打ちかけの cm */
  run("var hit = 0; gapPending = function () { hit++; }; saveNow();");
  eq("G15 時計で走る保存は、打ちかけの cm を書かない", json("[hit, typeof gapPending]"), [0, "function"]);
  run("flushSave(); flushSave();");
  eq("G16 画面が変わる・閉じるときの保存は、打ちかけの cm を1回だけ書く", json("[hit, gapPending]"), [1, null]);
  /* 履歴の表示 */
  run("var hl = mkG({dir:'above', cm:2}); applyGap(hl, {cm:null}); applyGap(hl, {cm:3}); var hh = judgeLogHTML(hl);");
  ok("G17 履歴: ずれは ＋ の書き方で出る", run("hh").includes("＋2cm") && !run("hh").includes("+2cm"));
  eq("G18 履歴: 一度消して入れ直した値を「最初の判定」と出さない", json("[hh.split('最初の判定').length - 1, hh.includes('（未記入） → ＋3cm')]"), [1, true]);
  eq("G19 画像の種類を替える前の確かめに、ずれの記入も数える", json("[hasS5Input(mkG({})), hasS5Input(mkG({dir:'same'}))]"), [false, true]);
  /* 三回目の独立した確認（2026-11-16）: 印の条件が丸ごと無い下書き（元の版で予測まで進めたもの） */
  eq("G20 固定の前の確かめ: 印の条件が丸ごと無い胸水・数値の下書きでも出る", run("lockWarnings(mkD({mark:null})).length"), 1);
}

/* ------------------------------------------------------------------ H. 副院長の決定（2026-11-16）: 背面の呼び名の一本化・既定の線は体位で分ける */
{
  const { run, json } = boot(NEW_HTML);
  run(`
    function mkH(o) {
      var c = newCase(); c.question = "q"; c.disease = "effusion"; c.qtype = "quant";
      c.pre.firstDx = "x"; c.pre.conf = 70; c.pre.confTouched = true;
      c.pre.mark = { posture: o.posture || "座位", line: o.line || "背面・肩甲中線", style: o.style || "通常より弱い打診" };
      lockCase(c);
      if (o.at) c.lock.lockedAt = o.at;
      applyGap(c, { dir: o.v > 0 ? "above" : o.v < 0 ? "below" : "same" });
      if (o.v !== 0) applyGap(c, { cm: Math.abs(o.v) });
      if (o.match) c.outcome.match = o.match;
      return c;
    }
  `);
  eq("H1 背面の選択肢は 脊柱寄り／肩甲中線／後腋窩線寄り（「中央」は無い）", json("SITE.lines_by_aspect['背面']"), ["脊柱寄り", "肩甲中線", "後腋窩線寄り"]);
  eq("H2 過去の語の読み替え: 中央＝肩甲中線。ほかの語はそのまま", json("[lineWord('中央'), lineWord('脊柱寄り'), lineCanon('背面・中央'), lineCanon('側面・中腋窩線'), lineCanon('')]"),
    ["肩甲中線", "脊柱寄り", "背面・肩甲中線", "側面・中腋窩線", ""]);
  eq("H3 既定の条件は二つ: 座位＝背面・肩甲中線／仰臥位＝側面・中腋窩線", json("GAP_STD.map(s => [s.posture, s.line])"), [["座位", "背面・肩甲中線"], ["仰臥位", "側面・中腋窩線"]]);
  eq("H4 体位ごとの既定の線（側臥位には無い）", json("[gapStdLineFor('座位'), gapStdLineFor('仰臥位'), gapStdLineFor('側臥位')]"), ["背面・肩甲中線", "側面・中腋窩線", ""]);
  eq("H5 既定に当たる組・当たらない組",
    json("[gapStd(mkH({v:0, posture:'仰臥位', line:'側面・中腋窩線'})), gapStd(mkH({v:0, posture:'仰臥位', line:'背面・肩甲中線'})), gapStd(mkH({v:0, posture:'座位', line:'側面・中腋窩線'})), gapStd(mkH({v:0, posture:'側臥位', line:'側面・中腋窩線'}))]"),
    [true, false, false, false]);
  run(`
    var hs = [];
    [2, 2, 1.5, 2.5, 2].forEach(function (v, i) { hs.push(mkH({ v: v, at: '2026-11-0' + (i + 1) + 'T01:00:00.000Z' })); });
    [-1, -1, -0.5, -1.5, -1].forEach(function (v, i) { hs.push(mkH({ v: v, posture: '仰臥位', line: '側面・中腋窩線', at: '2026-11-1' + i + 'T01:00:00.000Z' })); });
    var ha = gapAggregate(hs, "");
  `);
  eq("H6 数字は体位ごとに別々（座位 ＋2・仰臥位 −1。10例を混ぜた中央値にしない）",
    json("ha.groups.filter(g => g.n).map(g => [g.posture, g.style, g.n, g.median])"), [["座位", "通常より弱い打診", 5, 2], ["仰臥位", "通常より弱い打診", 5, -1]]);
  eq("H7 どちらも既定の条件として数える", json("[ha.n, ha.std, ha.other]"), [10, 10, 0]);
  ok("H8 一枚に、体位つきの行と、二つの既定の条件が出る", (() => { const h = run("gapSheetHTML(ha)");
    return h.includes("座位・通常より弱い打診") && h.includes("仰臥位・通常より弱い打診") && h.includes("既定の条件＝座位・背面・肩甲中線／仰臥位・側面・中腋窩線"); })());
  run("var ho = mkH({ v: 1, line: '背面・中央' });");
  eq("H9 過去の語で書いた条件は書き換えない（表示はそのまま・数え方だけ同じ線）", json("[ho.lock.snapshot.pre.mark.line, markText(ho.lock.snapshot.pre.mark).includes('背面・中央'), gapStd(ho)]"), ["背面・中央", true, true]);
  run("GAP_OK = 1; var hy = mkH({ v: 0.5, posture: '仰臥位', line: '側面・中腋窩線', match: 'yes' }), hz = mkH({ v: 0.5, posture: '仰臥位', line: '背面・肩甲中線', match: 'yes' });");
  eq("H10 合否の線（入れた場合）は、仰臥位の既定の条件にも効く。既定でない組には効かない", json("[partsOf(hy).where, partsOf(hz).where === 'hit']"), ["hit", false]);
  run("GAP_OK = null;");
}

/* ------------------------------------------------------------------ 結果 */
console.log("合格 " + pass + " ／ 不合格 " + fail);
if (fail) { fails.forEach(f => console.log("  ✗ " + f)); process.exit(1); }
