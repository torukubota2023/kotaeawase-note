/* 答え合わせノート ── 実画面の通し確認（iPhone 幅 375px・自動操作）
   走らせ方（先に port 8532 でこのフォルダを配っておく）:
     PW_FROM=/Users/torukubota/ai-management  SHOT_DIR=<画面の写しの置き場所>  node tests/e2e_375.mjs
   - 毎回まっさらな保存場所（使い捨て）で動かすので、手元の記録には触らない。
   - 患者さんの情報は入れない。試しの記録は「（試し）」で始める。
   2026-11-15 試作と同時に作成。 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(process.env.PW_FROM || process.cwd(), "package.json"));
const { chromium } = require("playwright");
const BASE = process.env.AWN_URL || "http://localhost:8532/";
const SHOT = process.env.SHOT_DIR || "";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, detail) { if (cond) pass++; else { fail++; fails.push(name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

async function newPage(browser) {
  /* iPhone と同じ条件にする: 指で触る端末（ボタンが 48px になる見た目の決まりが効く）・iPhone の名乗り */
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    serviceWorkers: "block", locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  const errs = []; const dialogs = []; const plan = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  /* 確認の窓: plan の先頭の指示どおりに答える。指示が無ければ OK を押す */
  page.on("dialog", async d => {
    const p = plan.shift();
    dialogs.push(d.message());
    if (p && p.accept === false) await d.dismiss(); else await d.accept();
  });
  await page.goto(BASE);
  await page.waitForSelector("#app");
  return { ctx, page, errs, dialogs, plan };
}
const NAV = { "一覧": "#list", "新規": "#new", "集計": "#stats", "設定": "#settings" };
async function go(page, name) {
  await page.locator("#bottomnav button", { hasText: name }).click();
  try { await page.waitForFunction(h => location.hash === h, NAV[name], { timeout: 3000 }); } catch (e) {}
  await page.waitForTimeout(150);
}
const txt = page => page.evaluate(() => document.querySelector("#app").innerText);
const btn = (page, name) => page.locator("#app").getByRole("button", { name, exact: true }).first();
async function tri(page, label, val) {
  return page.evaluate(([label, val]) => {
    const btns = [...document.querySelectorAll("#app button")].filter(b => b.textContent.trim() === val);
    for (const b of btns) {
      let p = b.parentElement;
      for (let i = 0; i < 4 && p; i++) {
        if (p.innerText && p.innerText.includes(label) && p.innerText.length < label.length + 80) { b.click(); return true; }
        p = p.parentElement;
      }
    }
    return false;
  }, [label, val]);
}
async function shot(page, name, opts) {
  if (!SHOT) return;
  const o = Object.assign({ path: path.join(SHOT, name), fullPage: true }, opts || {});
  /* 全体を1枚に撮るときは、下に固定された切り替えボタンと一時の知らせ（トースト）が途中に写り込むので隠す */
  const st = await page.addStyleTag({ content: (o.fullPage ? "#bottomnav{display:none!important}" : "") + ".toast{display:none!important}" });
  await page.screenshot(o);
  await st.evaluate(n => n.remove());
}
/* 一か月の一枚だけを1枚に撮る（副院長が iPhone で見る用） */
async function shotSheet(page, name) {
  if (!SHOT) return;
  const st = await page.addStyleTag({ content: "#bottomnav,.toast{display:none!important}" });
  await page.locator(".msheet").screenshot({ path: path.join(SHOT, name) });
  await st.evaluate(n => n.remove());
}
const cases = page => page.evaluate(() => { flushSave(); return allCases(); });
const storedCaseCount = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf("awn.case.") === 0).length);

/* 試しの記録を、アプリ自身の関数で作る（固定の手順は本物と同じ lockCase を通す） */
async function seed(page, list) {
  await page.evaluate(list => {
    list.forEach(o => {
      const c = newCase();
      c.question = "（試し）" + o.q; c.disease = o.disease;
      c.pre.firstDx = "（試し）"; c.pre.conf = o.conf; c.pre.confTouched = true;
      if (o.site) c.pre.site.sides = ["右"];
      if (lockCase(c) !== "ok") throw new Error("lock failed");
      c.lock.lockedAt = o.at; c.createdAt = o.at;
      c.status = "reviewed"; c.wizardStep = 7;
      if (o.match) applyMatch(c, o.match);
      if (o.parts) Object.keys(o.parts).forEach(k => applyPart(c, k, o.parts[k]));
      c.compare.missPrimary = o.miss || "";
      c.compare.nextAction = o.next || "";
      if (!persistCase(c)) throw new Error("persist failed");
    });
  }, list);
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(10, 0, 0, 0); return d.toISOString(); }

const browser = await chromium.launch();
try {
  /* ============================================================ 1. 一例目を、画面を押して通す */
  const A = await newPage(browser);
  let page = A.page;
  ok("1-0 始める前に記録が無い（使い捨ての保存場所）", await storedCaseCount(page) === 0);
  ok("1-1 記録0件の最初の画面は従来どおり（呼び名の催促を出さない）", !(await txt(page)).includes("記録者の呼び名がまだありません"));
  // 設定で呼び名
  await go(page, "設定");
  await page.fill("#recName", "研修医A");
  ok("1-2 呼び名が設定に保存される", await page.evaluate(() => recorderName()) === "研修医A");
  ok("1-3 呼び名の欄に、患者さんの情報ではないと注意書きがある", (await txt(page)).includes("患者さんの名前や情報は書きません"));
  // 新しい記録
  await go(page, "新規");
  await btn(page, "胸水").click();
  await btn(page, "右").click();
  await page.locator("#app button", { hasText: "下肺の濁音・呼吸音減弱は胸水か" }).first().click();
  await btn(page, "次へ（S2）").click();
  await btn(page, "次へ（S3）").click();          // 第一候補も確信度も触らずに進む
  await btn(page, "次へ（S4）").click();
  A.plan.push({ accept: false });                   // 確かめの窓 → キャンセル
  await page.locator("#lockBtn").click();
  await wait(200);
  ok("1-4 予測が空・確信度が初めのまま → 固定の前に確かめる", /第一候補が空/.test(A.dialogs[0] || "") && /50%のまま/.test(A.dialogs[0] || ""), A.dialogs[0]);
  ok("1-5 キャンセルすると予測の画面に戻る", (await txt(page)).includes("S2　画像前の予測"));
  ok("1-6 キャンセルしたので固定されていない", (await cases(page))[0].lock === null);
  await btn(page, "右 胸水").click();
  await page.locator("#confPresets .chip", { hasText: "70" }).click();
  await btn(page, "背面").click();
  await btn(page, "第8肋間").click();
  await btn(page, "次へ（S3）").click();
  ok("1-7 診察の所見を入れる", await tri(page, "石様濁音", "あり"));
  await btn(page, "次へ（S4）").click();
  A.dialogs.length = 0;
  await page.locator("#lockBtn").click();
  await wait(300);
  ok("1-8 書いてあれば、確かめは従来の1回だけ", A.dialogs.length === 1 && /固定します/.test(A.dialogs[0]), A.dialogs);
  ok("1-9 固定すると答え合わせの画面へ", (await txt(page)).includes("S5　画像で答え合わせ"));
  ok("1-10 「決まった」を押す前は、当たり外れの欄は出ていない", !(await txt(page)).includes("一致判定（予測と最終診断）"));
  await btn(page, "決まった").click();
  ok("1-11 「決まった」を押すと、その場で当たり外れを聞く", (await txt(page)).includes("一致判定（予測と最終診断）"));
  await page.locator("#s5Judge [data-jm=partial]").click();
  ok("1-12 「部分」を選ぶと三つの問いが出る", ["何が（病態があるか・ないか）", "どこに（側・部位・高さ）", "どれくらい（量・程度）"]
    .every(async s => (await txt(page)).includes(s)) && (await txt(page)).includes("どこに（側・部位・高さ）"));
  await page.locator('#s5Judge [data-part=what] [data-pv=hit]').click();
  await page.locator('#s5Judge [data-part=where] [data-pv=miss]').click();
  await page.locator('#s5Judge [data-part=howmuch] [data-pv=na]').click();
  const sizes = await page.evaluate(() => [...document.querySelectorAll("#s5Judge button")].map(b => Math.round(b.getBoundingClientRect().height)));
  ok("1-13 当たり外れのボタンは指で押せる高さ（44px以上）", sizes.length >= 13 && sizes.every(h => h >= 44), sizes);
  if (SHOT) {
    await page.locator("#s5Judge").scrollIntoViewIfNeeded();
    await page.addStyleTag({ content: ".toast{display:none!important}" });
    await page.locator("#s5Judge").screenshot({ path: path.join(SHOT, "試作_03_部分の三つの問い.png") });
  }
  await btn(page, "次へ（S6）").click();
  A.dialogs.length = 0; A.plan.push({ accept: false });
  await page.locator("[data-nomiss]").click();
  await wait(200);
  ok("1-14 外れの入った判定に「外れなし」を重ねると確かめる", /外れ/.test(A.dialogs[0] || ""), A.dialogs);
  ok("1-15 キャンセルしたので「外れなし」は入らない", (await cases(page))[0].compare.missPrimary !== "none");
  await page.locator('[data-prim=technique]').click();
  await page.fill("#f_next", "（試し）次は腋窩中線でも叩く");
  await btn(page, "次へ（S7）").click();
  ok("1-16 書き出しに記録者と部分の中身", (await txt(page)).includes("記録者: 研修医A") && (await txt(page)).includes("何が＝当たり／どこに＝外れ／どれくらい＝問うていない"));
  await page.locator("#wzDone").click();
  await wait(300);
  let c0 = (await cases(page))[0];
  ok("1-17 記録に呼び名・部品・履歴が入る", c0.recorder === "研修医A" && c0.outcome.match === "partial" &&
    c0.outcome.parts.what === "hit" && c0.outcome.parts.where === "miss" && c0.outcome.judgeLog.length === 4, c0.outcome);
  ok("1-18 最初の記入は付け替えに数えない", await page.evaluate(() => judgeChanges(allCases()[0])) === 0);
  // 集計（1例目）
  await go(page, "集計");
  let t = await txt(page);
  ok("1-19 1例目から「何例中何例」が件数で出る", t.includes("1例中 1例 当たり") && t.includes("1例中 0例 当たり"), t.slice(0, 600));
  ok("1-20 判定済み1・未判定0・下書き0", t.includes("判定済み 1件・未判定 0件・下書き 0件"));
  ok("1-21 外れを分類して次の一手まで書いた 1件", /1\s*\n?\s*外れを分類して、次の一手まで書いた/.test(t));
  ok("1-22 外れの一覧に「手で直せる外れ」と次に試すこと", t.includes("手で直せる外れ（取り方・読み方）　1件") && t.includes("次は腋窩中線でも叩く"));
  ok("1-23 率（%）の折れ線や当たりの率は出していない", !/当たり率|的中率/.test(t));
  ok("1-19b 1例だけのときの帯の見出しは「1例目（日付）」", /1例目（\d\d-\d\d）/.test(t) && !t.includes("1〜1例目"), t.slice(0, 900));
  await shotSheet(page, "試作_01_1例目の一枚.png");
  // 判定の付け替え → 履歴
  await go(page, "一覧");
  await page.locator("[data-case]").first().click();
  await page.locator('#jgBox [data-part=where] [data-pv=hit]').click();
  await wait(400);
  t = await txt(page);
  ok("1-24 付け替えると「判定変更あり」の印", t.includes("判定変更あり"));
  ok("1-25 判定の履歴に、何から何へ が出る", t.includes("判定の履歴") && t.includes("外れ → 当たり"));
  ok("1-26 付け替えは固定の印（画像後修正あり）とは別", !(await cases(page))[0].editedAfterLock);
  await go(page, "集計");
  ok("1-27 集計に「判定を付け替えた記録 1件」", (await txt(page)).includes("判定を付け替えた記録 1件"));
  // 一覧の呼び名の催促（呼び名を消すと出る）
  ok("1-28 画面の誤り（console）が無い", A.errs.length === 0, A.errs);

  /* ============================================================ 2. 五例 */
  await seed(page, [
    { q: "肺炎a", disease: "pneumonia", conf: 80, at: daysAgo(20), match: "yes", site: true, miss: "none" },
    { q: "胸水b", disease: "effusion", conf: 60, at: daysAgo(15), match: "no", miss: "interpretation", next: "（試し）無気肺も挙げる" },
    { q: "心不全c", disease: "hf", conf: 90, at: daysAgo(9), match: "yes", miss: "none" },
    { q: "肺炎d", disease: "pneumonia", conf: 50, at: daysAgo(4) }            // 固定したが未判定
  ]);
  await page.reload(); await page.waitForSelector("#app");
  await go(page, "集計");
  t = await txt(page);
  ok("2-1 五例: 判定済み4・未判定1", t.includes("判定済み 4件・未判定 1件・下書き 0件"), t.slice(0, 400));
  ok("2-2 未判定は、当たりにも外れにも数えていないと書いてある", t.includes("未判定の 1件は、当たりにも外れにも数えていません"));
  ok("2-3 何が: 4例中3例", t.includes("4例中 3例 当たり"));
  ok("2-4 帯は5マス（未判定は「？」）", await page.evaluate(() => document.querySelectorAll(".strip .scol").length) === 5 &&
    await page.evaluate(() => document.querySelectorAll(".strip .sc.un").length) === 3);
  await shotSheet(page, "試作_05_5例の一枚.png");
  // 病態で絞る
  await page.selectOption("#stFilter", "pneumonia");
  t = await txt(page);
  ok("2-5 病態で絞ると分母も変わる（肺炎: 判定済み1・未判定1）", t.includes("判定済み 1件・未判定 1件"));
  await page.selectOption("#stFilter", "");

  /* ============================================================ 3. 二十五例 */
  const more = [];
  const dis = ["pneumonia", "effusion", "hf", "copd", "asthma", "pneumothorax"];
  const missCats = ["observation", "technique", "interpretation", "integration", "anatomy", "conditions", "timecourse", "reference"];
  for (let i = 0; i < 20; i++) {
    const kind = i % 4;   // 0: はい  1: いいえ  2: 部分  3: はい
    const o = { q: "例" + (i + 6), disease: dis[i % dis.length], conf: [40, 55, 70, 85, 95][i % 5], at: daysAgo(45 - i * 2), site: i % 2 === 0 };
    if (kind === 1) { o.match = "no"; o.miss = missCats[i % 8]; o.next = "（試し）次の一手" + i; }
    else if (kind === 2) { o.match = "partial"; o.parts = { what: "hit", where: i % 8 === 2 ? "miss" : "hit", howmuch: "na" }; o.miss = i % 8 === 2 ? "anatomy" : "none"; }
    else { o.match = "yes"; o.miss = "none"; }
    more.push(o);
  }
  await seed(page, more);
  await page.reload(); await page.waitForSelector("#app");
  await go(page, "集計");
  t = await txt(page);
  const agg = await page.evaluate(() => sheetAggregate(allCases(), ""));
  ok("3-1 二十五例: 固定＝判定済み＋未判定", agg.locked === 25 && agg.judged + agg.unjudged === 25, [agg.locked, agg.judged, agg.unjudged]);
  ok("3-2 画面の件数が数え上げと同じ", t.includes("判定済み " + agg.judged + "件・未判定 " + agg.unjudged + "件"));
  ok("3-3 画面の「何が」が数え上げと同じ", t.includes(agg.parts.what.n + "例中 " + agg.parts.what.hit + "例 当たり"));
  ok("3-4 帯は25マスで、10例ごとに3段", await page.evaluate(() => document.querySelectorAll(".strip .scol").length) === 25 &&
    await page.evaluate(() => document.querySelectorAll(".strip .sline").length) === 3);
  ok("3-5 20例を超えたので前半と後半（件数だけ）", t.includes("前半と後半（件数だけ）") && /前半 \d+例中 \d+例 当たり ／ 後半 \d+例中 \d+例 当たり/.test(t));
  ok("3-6 確信度の帯の合計＝「何が」が決まった数", agg.bands.reduce((s, b) => s + b.n, 0) === agg.parts.what.n);
  ok("3-7 横にはみ出していない（375px）", await page.evaluate(() => document.documentElement.scrollWidth) <= 375,
    await page.evaluate(() => document.documentElement.scrollWidth));
  ok("3-7b 一か月の一枚が途中で切れていない（中で巻き物になっていない）", await page.evaluate(() => {
    const el = document.querySelector(".msheet"); return !!el && el.scrollHeight <= el.clientHeight + 1 && getComputedStyle(el).overflowY === "visible"; }));
  ok("3-8 くわしい数字（従来の欄）も出ている", t.includes("確信度のずれ（くわしい数字）") && t.includes("確信度と的中の対応表"));
  await shotSheet(page, "試作_02_25例の一枚.png");
  await shot(page, "試作_09_集計の全体_25例.png");
  // 期間
  await page.selectOption("#stPeriod", "last30");
  const a30 = await page.evaluate(() => sheetAggregate(allCases().filter(c => inPeriod(c, periodRange("last30"))), ""));
  t = await txt(page);
  ok("3-9 期間を直近30日に絞ると件数が減る", a30.locked < 25 && t.includes("判定済み " + a30.judged + "件・未判定 " + a30.unjudged + "件"), [a30.locked, a30.judged]);
  await page.selectOption("#stPeriod", "custom");
  ok("3-10 日付で指定を選ぶと、日付の欄が2つ出る", await page.locator("#stFrom").count() === 1 && await page.locator("#stTo").count() === 1);
  await page.selectOption("#stPeriod", "all");
  ok("3-11 画面の誤り（console）が無い", A.errs.length === 0, A.errs);
  // 一覧
  await go(page, "一覧");
  await shot(page, "試作_06_一覧.png", { fullPage: false });

  /* ============================================================ 4. 見るだけで開く */
  const backup = await page.evaluate(() => { const b = backupBlob(); return { name: b.name, json: b.json }; });
  ok("4-1 控えのファイル名に呼び名", /^kotaeawase-backup-研修医A-\d{8}\.json$/.test(backup.name), backup.name);
  ok("4-2 控えの中身に呼び名", JSON.parse(backup.json).recorder === "研修医A");
  await A.ctx.close();

  const B = await newPage(browser);            // 指導医の端末（まっさら）
  page = B.page;
  ok("4-3 指導医の端末は空から", await storedCaseCount(page) === 0);
  await page.evaluate(() => { lsSet(K_SETTINGS, { recorderName: "指導医" }); });
  await seed(page, [
    { q: "自分の例1", disease: "effusion", conf: 70, at: daysAgo(3), match: "yes", miss: "none" },
    { q: "自分の例2", disease: "pneumonia", conf: 60, at: daysAgo(2), match: "no", miss: "technique", next: "（試し）" }
  ]);
  const mineBefore = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter(k => k.indexOf("awn.") === 0).sort().map(k => [k, localStorage.getItem(k)])));
  await go(page, "設定");
  await page.setInputFiles("#rsFile", { name: backup.name, mimeType: "application/json", buffer: Buffer.from(backup.json, "utf-8") });
  await page.waitForSelector("#rsView");
  let mt = await page.evaluate(() => document.querySelector("#rsView").closest("div[class]").parentElement.innerText);
  ok("4-4 読み込みの確認に、誰の控えかが出る", mt.includes("この控えの記録者：研修医A／この端末の記録者：指導医"), mt.slice(0, 300));
  ok("4-5 別の人の控えだと注意が出る", mt.includes("別の人の控えです"));
  await shot(page, "試作_07_読み込みの確認.png", { fullPage: false });
  // マージを押して、確かめでやめる
  B.dialogs.length = 0; B.plan.push({ accept: false });
  await page.locator("#rsMerge").click();
  await wait(200);
  ok("4-6 別の人の控えを混ぜる前に、もう一度確かめる", /分けられません/.test(B.dialogs[0] || ""), B.dialogs);
  ok("4-7 やめたので1件も混ざっていない", await storedCaseCount(page) === 2);
  // 見るだけで開く
  await page.locator("#rsView").click();
  await wait(300);
  t = await page.evaluate(() => document.body.innerText);
  ok("4-8 上に「見るだけ」の帯が出る", t.includes("見るだけ：研修医A さんの控え") && t.includes("あなたの記録には入っていません"));
  ok("4-9 一覧は相手の25件", await page.locator("[data-case]").count() === 25);
  ok("4-10 端末の保存場所には相手の記録が1件も入っていない", await storedCaseCount(page) === 2);
  await shot(page, "試作_04_見るだけで開いた画面.png", { fullPage: false });
  await go(page, "集計");
  t = await txt(page);
  ok("4-11 見るだけで、相手の一枚が見える", t.includes("判定済み 24件・未判定 1件"), t.slice(0, 300));
  await shot(page, "試作_08_見るだけの集計.png", { fullPage: false });
  // 書き込みの入口を試す
  await go(page, "新規");
  await wait(300);
  ok("4-12 見るだけの最中は、新しい記録を開けない", (await page.evaluate(() => location.hash)) === "#list");
  await page.locator("[data-case]").first().click();
  await wait(200);
  const blocked = await page.evaluate(() => {
    const b = document.querySelector("#jgBox [data-jm=no]");
    return b ? getComputedStyle(b).pointerEvents : "missing";
  });
  ok("4-13 見るだけの最中は、判定のボタンを押せない", blocked === "none", blocked);
  const forced = await page.evaluate(() => { const c = allCases()[0]; const before = c.outcome.match; const r = writeCase(c, "outcome", cc => applyMatch(cc, "pending")); return [r, before === c.outcome.match]; });
  ok("4-14 無理に書こうとしても断られる", forced[0] === false && forced[1] === true, forced);
  await go(page, "設定");
  ok("4-15 見るだけの最中の設定は「見るのをやめる」だけ", (await txt(page)).includes("見るだけで開いているあいだは") && await page.locator("#bkBtn").count() === 0);
  const mineAfter = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter(k => k.indexOf("awn.") === 0).sort().map(k => [k, localStorage.getItem(k)])));
  ok("4-16 見るだけの前後で、自分の保存場所は1文字も変わらない", mineBefore === mineAfter);
  await page.locator("#vsExit").click();
  await wait(300);
  ok("4-17 やめると自分の2件に戻る", await page.locator("[data-case]").count() === 2 && !(await page.evaluate(() => document.body.innerText)).includes("見るだけ："));
  // もう一度開いて、読み込み直しで消えること
  await go(page, "設定");
  await page.setInputFiles("#rsFile", { name: backup.name, mimeType: "application/json", buffer: Buffer.from(backup.json, "utf-8") });
  await page.waitForSelector("#rsView");
  await page.locator("#rsView").click();
  await page.reload(); await page.waitForSelector("#app");
  ok("4-18 画面を読み込み直すと、自分の記録に戻る", await page.locator("[data-case]").count() === 2);
  // 見るだけの最中に開いた窓（補記）は、やめると消える ── 鍵盤で開けた窓から、相手の記録を自分の端末へ保存できた（三回目の独立した確認）
  await go(page, "設定");
  await page.setInputFiles("#rsFile", { name: backup.name, mimeType: "application/json", buffer: Buffer.from(backup.json, "utf-8") });
  await page.waitForSelector("#rsView");
  await page.locator("#rsView").click();
  await wait(300);
  await page.locator("[data-case]").first().click();
  await wait(200);
  await page.evaluate(() => document.querySelector("#addAdx").click());   // 指では押せないので、鍵盤で開けた場合の代わり
  const adxOpen = await page.locator("#adxSave").count();
  await page.locator("#viewExit").click();
  await wait(300);
  const adxAfter = [adxOpen, await page.locator("#adxSave").count(), await storedCaseCount(page)];
  ok("4-18b 見るだけの最中に開いた補記の窓は、やめると消える（相手の記録は1件も入らない）", JSON.stringify(adxAfter) === JSON.stringify([1, 0, 2]), adxAfter);
  ok("4-19 画面の誤り（console）が無い", B.errs.length === 0, B.errs);
  await B.ctx.close();

  /* ============================================================ 5. 旧い形の控えを読み込む */
  const C = await newPage(browser);
  page = C.page;
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/fixtures/personal_lr_fixture_v120.json"), "utf-8"));
  const fxCases = Array.isArray(fx) ? fx : fx.cases;
  const oldBackup = JSON.stringify({ app: "kotaeawase-note", schemaVersion: 1, exportedAt: "2026-08-09T00:00:00.000Z", cases: fxCases, quick: [], tracks: [] });
  await go(page, "設定");
  await page.setInputFiles("#rsFile", { name: "kotaeawase-backup-20260809.json", mimeType: "application/json", buffer: Buffer.from(oldBackup, "utf-8") });
  await page.waitForSelector("#rsReplace");
  mt = await page.evaluate(() => document.querySelector("#rsView").closest("div[class]").parentElement.innerText);
  ok("5-1 呼び名の無い旧い控えでは「別の人」の注意を出さない", !mt.includes("別の人の控えです") && mt.includes("（呼び名なし）"));
  C.dialogs.length = 0;
  await page.locator("#rsReplace").click();
  await wait(400);
  ok("5-2 旧い控えの全置換は、確かめ1回で通る", C.dialogs.length === 1, C.dialogs);
  ok("5-3 旧い記録が全部入る", await storedCaseCount(page) === fxCases.length, await storedCaseCount(page));
  await go(page, "一覧");
  ok("5-4 一覧に旧い記録が並ぶ", await page.locator("[data-case]").count() === fxCases.length);
  await page.locator("[data-case]").first().click();
  await page.waitForSelector("#jgBox");   // 画面の切り替えは一拍遅れる
  t = await txt(page);
  ok("5-5 旧い記録の詳細が開き、判定の欄が出る", t.includes("一致判定（予測と最終診断）") && t.includes("後日追記"));
  await page.locator("#jgBox [data-jm=yes]").click();
  await wait(400);
  const after = await page.evaluate(() => { const id = location.hash.slice(6); const c = loadCaseById(id); return { m: c.outcome.match, log: c.outcome.judgeLog.length, snap: !!c.lock.snapshot }; });
  ok("5-6 旧い記録に判定を入れると、履歴が1件残り、写しはそのまま", after.m === "yes" && after.log === 1 && after.snap, after);
  await go(page, "集計");
  t = await txt(page);
  ok("5-7 旧い記録だけでも集計が開く", t.includes("一か月の一枚") && t.includes("自分の尤度比"));
  ok("5-8 画面の誤り（console）が無い", C.errs.length === 0, C.errs);
  await C.ctx.close();

  /* ============================================================ 6. 胸水の上縁: 打診の印と液面のずれ */
  const D = await newPage(browser);
  page = D.page;
  ok("6-0 まっさらから", await storedCaseCount(page) === 0);
  await page.evaluate(() => { lsSet(K_SETTINGS, { recorderName: "研修医A" }); });
  await go(page, "新規");
  await btn(page, "胸水").click();
  await btn(page, "右").click();
  await page.locator("#app button", { hasText: "胸水の上縁は" }).first().click();
  await btn(page, "次へ（S2）").click();
  let t6 = await txt(page);
  ok("6-1 胸水の数値の問いでは、印を付けた条件を聞く", t6.includes("打診で上縁に印を付けたときの条件"));
  const pre6 = await page.evaluate(() => [...document.querySelectorAll('.chips[data-name^="mk"] .chip[aria-pressed="true"]')].map(b => b.textContent.trim()));
  ok("6-2 既定は 座位・背面の肩甲中線（選んだ状態で見えている）", JSON.stringify(pre6) === JSON.stringify(["座位", "背面・肩甲中線"]), pre6);
  ok("6-3 線の選択肢は「背面・肩甲中線」に一本化（「背面・中央」は出ない）", !t6.includes("背面・中央") && t6.includes("背面・肩甲中線"));
  /* 体位を替えると、線の既定も見える形で替わる（2026-11-16 副院長決定） */
  const mk6 = async () => page.evaluate(() => { flushSave(); const m = allCases()[0].pre.mark; return [m.posture, m.line, [...document.querySelectorAll('.chips[data-name="mkline"] .chip[aria-pressed="true"]')].map(b => b.textContent.trim()).join("|")]; });
  await page.locator('.chips[data-name="mkposture"] .chip', { hasText: "仰臥位" }).click();
  let m6 = await mk6();
  ok("6-3a 仰臥位を選ぶと、線は「側面・中腋窩線」に替わる（選んだ状態で見える）", JSON.stringify(m6) === JSON.stringify(["仰臥位", "側面・中腋窩線", "側面・中腋窩線"]), m6);
  await page.locator('.chips[data-name="mkposture"] .chip', { hasText: "側臥位" }).click();
  m6 = await mk6();
  ok("6-3b 側臥位には既定が無いので、線は動かない", JSON.stringify(m6) === JSON.stringify(["側臥位", "側面・中腋窩線", "側面・中腋窩線"]), m6);
  await page.locator('.chips[data-name="mkline"] .chip', { hasText: "背面・脊柱寄り" }).click();
  await page.locator('.chips[data-name="mkposture"] .chip', { hasText: "仰臥位" }).click();
  m6 = await mk6();
  ok("6-3c 自分で選んだ線（背面・脊柱寄り）は、体位を替えても動かない", JSON.stringify(m6) === JSON.stringify(["仰臥位", "背面・脊柱寄り", "背面・脊柱寄り"]), m6);
  await page.locator('.chips[data-name="mkline"] .chip', { hasText: "側面・中腋窩線" }).click();
  await page.locator('.chips[data-name="mkposture"] .chip', { hasText: "座位" }).click();
  m6 = await mk6();
  ok("6-3d 座位に戻すと、線は「背面・肩甲中線」に戻る", JSON.stringify(m6) === JSON.stringify(["座位", "背面・肩甲中線", "背面・肩甲中線"]), m6);
  await page.locator('.chips[data-name="mkstyle"] .chip', { hasText: "通常より弱い打診" }).click();
  await btn(page, "右 胸水").click();
  await page.locator("#confPresets .chip", { hasText: "70" }).click();
  await page.fill("#f_qpred", "7");
  await page.locator('.chips[data-name="qunit"] .chip', { hasText: "肋間" }).click();
  await btn(page, "次へ（S3）").click();
  await btn(page, "次へ（S4）").click();
  ok("6-4 固定の画面の「ここまでの記録」に、印の条件が出る", (await txt(page)).includes("座位・背面・肩甲中線・通常より弱い打診"));
  D.dialogs.length = 0;
  await page.locator("#lockBtn").click();
  await page.waitForSelector("#s5Gap");
  ok("6-5 書いてあるので、確かめは1回だけ", D.dialogs.length === 1, D.dialogs);
  t6 = await txt(page);
  ok("6-6 POCUS の答え合わせに、印と液面のずれの欄が出る", t6.includes("打診の印と、エコーの液面のずれ") && t6.includes("液面は、印の"));
  await page.locator('#s5Gap [data-gd=above]').click();
  await page.fill("#gapCm", "2");
  await page.locator("#gapCm").blur();
  await wait(200);
  ok("6-7 上・2cm → 「液面は印より 2cm 上（＋2）」", (await page.locator("#gapVal").innerText()).includes("液面は印より 2cm 上（＋2）"));
  const gh = await page.evaluate(() => [...document.querySelectorAll("#s5Gap button, #s5Gap input")].map(b => Math.round(b.getBoundingClientRect().height)));
  ok("6-8 ずれの欄のボタンと入力は指で押せる高さ（44px以上）", gh.length === 4 && gh.every(h => h >= 44), gh);
  if (SHOT) { await page.addStyleTag({ content: ".toast{display:none!important}" }); await page.locator("#s5Gap").screenshot({ path: path.join(SHOT, "試作_11_胸水のずれの入力.png") }); }
  // 胸部X線に替えると欄が消え、戻すと出る（値は残る）
  D.plan.push({ accept: true });
  await page.locator('#modChips [data-mod=cxr]').click();
  await wait(300);
  ok("6-9 胸部X線に替えると、cm の欄は出ない（肋間のまま）", !(await txt(page)).includes("打診の印と、エコーの液面のずれ"));
  ok("6-10 X線の記録では、ずれを数えない", await page.evaluate(() => { flushSave(); return gapOf(allCases()[0]); }) === null);
  D.plan.push({ accept: true });
  await page.locator('#modChips [data-mod=pocus]').click();
  await wait(300);
  ok("6-11 POCUS に戻すと、欄と値が戻る", await page.evaluate(() => { flushSave(); return gapOf(allCases()[0]); }) === 2);
  await btn(page, "次へ（S6）").click();
  await page.locator("[data-nomiss]").click();
  await btn(page, "次へ（S7）").click();
  t6 = await txt(page);
  ok("6-12 書き出しに、印の条件とずれ", t6.includes("印を付けた条件: 座位・背面・肩甲中線・通常より弱い打診") && t6.includes("印と液面のずれ: 液面は印より 2cm 上（＋2）"));
  await page.locator("#wzDone").click();
  await page.waitForSelector("#gapBox");
  const c6 = (await cases(page))[0];
  ok("6-13 印の条件は固定の写しに入っている", c6.lock.snapshot.pre.mark.posture === "座位" && c6.lock.snapshot.pre.mark.line === "背面・肩甲中線" && c6.lock.snapshot.pre.mark.style === "通常より弱い打診", c6.lock.snapshot.pre.mark);
  await go(page, "集計");
  t6 = await txt(page);
  ok("6-14 1例目から、点の図と件数が出る", t6.includes("胸水の上縁 ── 打診の印と、エコーの液面のずれ") && t6.includes("1例（既定の条件 1例・それ以外 0例）") &&
    await page.locator(".gapplot .pt").count() === 1);
  ok("6-15 1例では、中央値と散らばりは出さない", !t6.includes("ずれの中央値") && t6.includes("1例（中央値と散らばりは、5例そろってから）"));
  // 胸水のずれの例を足す（既定5・線が違う1・閾値打診2）
  await page.evaluate(list => {
    list.forEach(o => {
      const c = newCase();
      c.question = "（試し）胸水の上縁"; c.disease = "effusion"; c.qtype = "quant";
      c.pre.firstDx = "（試し）"; c.pre.conf = 70; c.pre.confTouched = true; c.pre.quantPred = { value: 7, unit: "肋間" };
      c.pre.mark = { posture: o.posture || "座位", line: o.line || "背面・肩甲中線", style: o.style || "通常より弱い打診" };
      if (lockCase(c) !== "ok") throw new Error("lock failed");
      c.lock.lockedAt = o.at; c.createdAt = o.at; c.status = "reviewed"; c.wizardStep = 7;
      applyGap(c, { dir: o.v > 0 ? "above" : o.v < 0 ? "below" : "same" });
      if (o.v !== 0) applyGap(c, { cm: Math.abs(o.v) });
      applyMatch(c, "yes"); c.compare.missPrimary = "none";
      if (!persistCase(c)) throw new Error("persist failed");
    });
  }, [
    { v: 2, at: daysAgo(24) }, { v: 1.5, at: daysAgo(21) }, { v: 2.5, at: daysAgo(17) }, { v: 2, at: daysAgo(12) }, { v: 3, at: daysAgo(8) },
    { v: -1, at: daysAgo(6), line: "背面・脊柱寄り" },
    { v: 0.5, at: daysAgo(4), style: "閾値打診" }, { v: 0, at: daysAgo(2), style: "閾値打診" }
  ]);
  await page.reload(); await page.waitForSelector("#app");
  await go(page, "集計");
  t6 = await txt(page);
  const ga6 = await page.evaluate(() => sheetAggregate(allCases(), "").gap);
  ok("6-16 9例: 既定8・それ以外1（線が違う例は別扱い）", ga6.n === 9 && ga6.std === 8 && ga6.other === 1 && t6.includes("9例（既定の条件 8例・それ以外 1例）"), [ga6.n, ga6.std, ga6.other]);
  ok("6-17 通常より弱い打診 6例: 中央値 ＋2.0cm と、癖を引いたあとの散らばり", t6.includes("ずれの中央値 ＋2.0cm（6例）") && t6.includes("癖を引いたあと、半分の例が ±"));
  ok("6-18 閾値打診は2例なので、数字は出さない", t6.includes("2例（中央値と散らばりは、5例そろってから）"));
  ok("6-19 点は9つ、うち条件の違う1つは白抜き", await page.locator(".gapplot .pt").count() === 9 && await page.locator(".gapplot .pt.off").count() === 1);
  ok("6-20 「この幅を超えたら変化」という読み方は出していない", !/超えたら|RCV/.test(await page.locator(".gapsec").innerText()));
  ok("6-21 図が横にはみ出していない", await page.evaluate(() => document.documentElement.scrollWidth) <= 375);
  if (SHOT) {
    const st = await page.addStyleTag({ content: "#bottomnav,.toast{display:none!important}" });
    await page.locator(".gapsec").screenshot({ path: path.join(SHOT, "試作_10_胸水のずれ.png") });
    await st.evaluate(n => n.remove());
  }
  await page.selectOption("#stFilter", "pneumonia");
  ok("6-22 ほかの病態で絞ると、胸水の図は出ない", !(await txt(page)).includes("胸水の上縁 ──"));
  ok("6-23 画面の誤り（console）が無い", D.errs.length === 0, D.errs);

  /* ============================================================ 7. 古い写しで上書きしても、判定の履歴が消えない */
  await page.selectOption("#stFilter", "");
  await page.evaluate(() => {
    const c = newCase(); c.question = "（試し）古い写し"; c.disease = "pneumonia"; c.pre.firstDx = "（試し）"; c.pre.conf = 90; c.pre.confTouched = true;
    lockCase(c); c.wizardStep = 5; persistCase(c); window.__sid = c.id;
  });
  await page.reload(); await page.waitForSelector("#app");
  await go(page, "一覧");
  await page.locator("#resumeBtn").click();                       // 「続きから」で答え合わせの画面へ
  await page.waitForSelector("#defChips");
  await page.locator("#wzLeave").click();                          // 一覧へ（入力画面は記録を覚えたまま）
  await page.waitForSelector("[data-case]");
  const sid = await page.evaluate(() => allCases().find(c => c.question === "（試し）古い写し").id);
  await page.locator('[data-case="' + sid + '"]').click();
  await page.waitForSelector("#jgBox");
  await page.locator("#jgBox [data-jm=no]").click();               // 詳細で「いいえ」
  await wait(400);
  await page.goBack(); await page.goBack();                        // 戻るを2回 → 入力画面
  await page.waitForSelector("#defChips");
  await btn(page, "決まった").click();
  await wait(500);
  let s7 = await page.evaluate(id => { flushSave(); const c = loadCaseById(id); return { m: c.outcome.match, log: c.outcome.judgeLog.map(l => l.from + ">" + l.to), def: c.pocus.definitive }; }, sid);
  ok("7-1 古い画面で「決まった」を押しても、判定「いいえ」と履歴は消えない", s7.m === "no" && s7.log.length === 1 && s7.def === "yes", s7);
  ok("7-2 その画面の判定の欄は「いいえ」を示している", await page.locator('#s5Judge [data-jm=no][aria-pressed="true"]').count() === 1);
  await page.locator("#s5Judge [data-jm=yes]").click();
  await wait(500);
  s7 = await page.evaluate(id => { flushSave(); const c = loadCaseById(id); return { m: c.outcome.match, log: c.outcome.judgeLog.map(l => l.from + ">" + l.to), ch: judgeChanges(c) }; }, sid);
  ok("7-3 そこで「はい」に替えると、付け替えとして残る（跡なしにならない）", s7.m === "yes" && s7.log.join() === "pending>no,no>yes" && s7.ch === 1, s7);

  /* ============================================================ 8. 復元のあと、前の訂正の解錠が残らない */
  const bk8 = await page.evaluate(() => backupBlob().json);
  await page.locator("#wzLeave").click();                          // 入力画面では下の切り替えが出ないので「一覧へ」で出る
  await page.waitForSelector("[data-case]");
  await page.locator('[data-case="' + sid + '"]').click();
  await page.waitForSelector("[data-fix=pre]");
  D.dialogs.length = 0;
  await page.locator("[data-fix=pre]").click();                    // 訂正する → OK
  await page.waitForSelector("#cf1r");
  ok("8-1 訂正の前に確かめが出る", D.dialogs.length === 1 && /ロック後の訂正/.test(D.dialogs[0]), D.dialogs);
  await page.locator("#wzLeave").click();
  await page.waitForSelector("[data-case]");
  await go(page, "設定");
  await page.setInputFiles("#rsFile", { name: "kotaeawase-backup-研修医A-20261115.json", mimeType: "application/json", buffer: Buffer.from(bk8, "utf-8") });
  await page.waitForSelector("#rsReplace");
  await page.locator("#rsReplace").click();                        // 全置換（同じ人の控えなので確かめは1回）
  await wait(500);
  await go(page, "一覧");
  await page.locator('[data-case="' + sid + '"]').click();
  await page.waitForSelector("[data-fix=pre]");
  ok("8-2 復元した記録には、訂正の印が無い", !(await page.evaluate(id => loadCaseById(id).editedAfterLock, sid)));
  D.dialogs.length = 0;
  await page.locator("[data-fix=pre]").click();
  await wait(400);
  ok("8-3 復元のあとの訂正にも、確かめが出る（前の解錠が残っていない）", D.dialogs.length === 1 && /ロック後の訂正/.test(D.dialogs[0]), D.dialogs);
  ok("8-4 訂正すると、印と履歴が付く", await page.evaluate(id => { flushSave(); const c = loadCaseById(id); return c.editedAfterLock === true && c.editLog.length === 1; }, sid));
  ok("8-5 画面の誤り（console）が無い", D.errs.length === 0, D.errs);
  await D.ctx.close();

  /* ============================================================ 9. 二回目の独立した確認（2026-11-16）で直した点 */
  const mkEff = async (pg, style) => {
    await go(pg, "新規");
    await btn(pg, "胸水").click();
    await btn(pg, "右").click();
    await pg.locator("#app button", { hasText: "胸水の上縁は" }).first().click();
    await btn(pg, "次へ（S2）").click();
    if (style) await pg.locator('.chips[data-name="mkstyle"] .chip', { hasText: style }).click();
    await btn(pg, "右 胸水").click();
    await pg.locator("#confPresets .chip", { hasText: "70" }).click();
    await pg.fill("#f_qpred", "7");
    await pg.locator('.chips[data-name="qunit"] .chip', { hasText: "肋間" }).click();
    await btn(pg, "次へ（S3）").click();
    await btn(pg, "次へ（S4）").click();
  };
  /* 9a. 二つの画面: 先に固定された記録を、古い下書きの画面から固定し直せない */
  const E = await newPage(browser);
  page = E.page;
  await mkEff(page, "通常より弱い打診");
  await page.evaluate(() => flushSave());
  const pageB = await E.ctx.newPage();   // 同じ保存場所を見る、もう一つの画面
  await pageB.goto(BASE); await pageB.waitForSelector("#app");
  const lockedAt0 = await pageB.evaluate(() => { const c = allCases()[0]; lockCase(c); applyMatch(c, "no"); persistCase(c); return c.lock.lockedAt; });
  await page.locator("#wzBack").click(); await page.locator("#wzBack").click();
  await page.locator("#confPresets .chip", { hasText: "90" }).click();
  await wait(450);
  await btn(page, "次へ（S3）").click();
  await btn(page, "次へ（S4）").click();
  E.dialogs.length = 0;
  await page.locator("#lockBtn").click();
  await wait(400);
  const st9 = await pageB.evaluate(() => { const c = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("awn.case.")))); return { at: c.lock && c.lock.lockedAt, conf: c.lock && c.lock.snapshot.pre.conf, m: c.outcome.match, ed: !!c.editedAfterLock }; });
  ok("9-1 古い下書きの画面で「固定」を押すと、先に固定されている、と知らせて止まる", E.dialogs.some(d => /先に固定されています/.test(d)), E.dialogs);
  ok("9-2 端末の固定の時刻・写しの確信度・判定は、そのまま", st9.at === lockedAt0 && st9.conf === 70 && st9.m === "no" && st9.ed === false, st9);
  ok("9-3 一覧へ戻っている", await page.evaluate(() => location.hash) === "#list");
  ok("9-4 画面の誤り（console）が無い", E.errs.length === 0, E.errs);
  await E.ctx.close();

  /* 9b. 叩き方を選ばずに固定 → 確かめ。cm は打ったまま画面を離れても残る。範囲の外は受け付けない */
  const F = await newPage(browser);
  page = F.page;
  await mkEff(page, "");
  F.dialogs.length = 0;
  await page.locator("#lockBtn").click();
  await page.waitForSelector("#s5Gap");
  ok("9-5 叩き方を選ばずに固定しようとすると、固定の前に確かめる", F.dialogs.length === 2 && /叩き方/.test(F.dialogs[0]) && /固定します/.test(F.dialogs[1]), F.dialogs);
  await page.locator('#s5Gap [data-gd=above]').click();
  await page.fill("#gapCm", "2.5");          // 欄を離れない
  await page.reload();
  await page.waitForSelector("#app");
  ok("9-6 cm を打ったまま読み込み直しても、値が残る", await page.evaluate(() => gapOf(allCases()[0])) === 2.5);
  await page.evaluate(() => { wizardIntent = { caseId: allCases()[0].id, step: 5 }; nav("#new"); });   // 読み込み直したあと、同じ記録の答え合わせの画面へ
  await page.waitForSelector("#s5Gap");
  await page.fill("#gapCm", "3");            // 欄を離れずに「次へ」
  await btn(page, "次へ（S6）").click();
  await wait(200);
  const g9 = await page.evaluate(() => { flushSave(); const c = allCases()[0]; return [gapOf(c), c.outcome.judgeLog.filter(l => l.k === "gap").length, judgeChanges(c)]; });
  ok("9-7 打ったまま「次へ」でも残る。書き直しは履歴に1行ずつ・「判定変更」には数えない", JSON.stringify(g9) === JSON.stringify([3, 2, 0]), g9);
  await page.locator("#wzBack").click();
  await page.waitForSelector("#s5Gap");
  for (const bad of ["500", "-3"]) {
    await page.fill("#gapCm", bad);
    await page.locator("#gapCm").blur();
    await wait(200);
    const r = await page.evaluate(() => { flushSave(); return [document.querySelector("#gapCm").value, gapOf(allCases()[0]), (document.querySelector(".toast") || {}).textContent || ""]; });
    ok("9-8 範囲の外（" + bad + "）は受け付けず、前の値を残して理由を出す", r[0] === "3" && r[1] === 3 && /0〜30cm/.test(r[2]), r);
  }
  await page.locator("#wzLeave").click();
  await go(page, "集計");
  ok("9-9 一枚に、叩き方の記録なしの例数と理由が出る", (await txt(page)).includes("叩き方の記録なし 1例"));
  const ov9 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("9-10 375px で横にはみ出さない", ov9 <= 0, ov9);
  ok("9-11 画面の誤り（console）が無い", F.errs.length === 0, F.errs);
  await F.ctx.close();

  /* ============================================================ 10. 三回目の独立した確認（2026-11-16）で直した点 */
  const G = await newPage(browser);
  page = G.page;
  await mkEff(page, "通常より弱い打診");
  await page.locator("#lockBtn").click();
  await page.waitForSelector("#s5Gap");
  await page.locator('#s5Gap [data-gd=above]').click();
  await page.fill("#gapCm", "2");            // 欄を離れない
  G.dialogs.length = 0; G.plan.push({ accept: false });
  await page.evaluate(() => document.querySelector("#modChips [data-mod=cxr]").click());   // 欄から焦点を動かさずに押す（iPhone の挙動の代わり）
  await wait(300);
  const m10 = await page.evaluate(() => { flushSave(); const c = allCases()[0]; return [modalityOf(c), gapOf(c)]; });
  ok("10-1 cm を打ちかけたまま画像の種類を替えようとすると、確かめが出る（やめれば POCUS のまま・値は残る）",
    G.dialogs.length === 1 && JSON.stringify(m10) === JSON.stringify(["pocus", 2]), [G.dialogs.length, m10]);
  /* 数として読めない打ち込み（2e）で、前の値が消えない */
  await page.locator("#gapCm").click();
  await page.keyboard.press("End");
  await page.keyboard.type("e");
  await page.locator("#gapCm").blur();
  await wait(200);
  const b10 = await page.evaluate(() => { flushSave(); const c = allCases()[0]; return [document.querySelector("#gapCm").value, gapOf(c), c.outcome.judgeLog.filter(l => l.k === "gap" && l.to === "").length, (document.querySelector(".toast") || {}).textContent || ""]; });
  ok("10-2 数として読めない打ち込み（2e）は受け付けず、前の値を残して理由を出す", b10[0] === "2" && b10[1] === 2 && b10[2] === 0 && /0〜30cm/.test(b10[3]), b10);
  /* 詳細で打ちかけたまま画面を変えても、保存は1回だけ（古い写しでの二度目の保存が走らない） */
  await page.locator("#wzLeave").click();
  await go(page, "一覧");
  await page.locator("[data-case]").first().click();
  await page.waitForSelector("#gapBox #gapCm");
  await page.evaluate(() => { window.__saves = 0; const o = window.persistCase; window.persistCase = function (c) { window.__saves++; return o(c); }; });
  await page.fill("#gapCm", "4");            // 欄を離れない
  await page.evaluate(() => { location.hash = "#stats"; });   // 焦点を動かさずに画面を変える
  await wait(700);
  const s10 = await page.evaluate(() => [window.__saves, gapOf(allCases()[0])]);
  ok("10-3 詳細で cm を打ちかけたまま画面を変えると、保存は1回だけ・値は残る", JSON.stringify(s10) === JSON.stringify([1, 4]), s10);
  ok("10-4 画面の誤り（console）が無い", G.errs.length === 0, G.errs);
  await G.ctx.close();

  /* ============================================================ 11. 副院長の決定（2026-11-16）: 背面の「中央」＝「肩甲中線」 */
  const H = await newPage(browser);
  page = H.page;
  await page.evaluate(() => {
    const c = newCase();
    c.question = "（試し）過去の語"; c.disease = "pneumonia"; c.qtype = "qual";
    c.pre.firstDx = "（試し）"; c.pre.conf = 70; c.pre.confTouched = true;
    if (lockCase(c) !== "ok") throw new Error("lock failed");
    c.pocus.sites = [newSite({ sides: ["右"], aspects: ["背面"], lines: ["中央"], ics: ["第8肋間"] })];   // 前の版で「中央」を選んだ記録
    if (!persistCase(c)) throw new Error("persist failed");
    wizardIntent = { caseId: c.id, step: 5 }; nav("#new");
  });
  await page.waitForSelector("[data-site-open]");
  await page.locator('[data-site-open="0"]').click();
  await page.waitForSelector("[data-pk-line]");
  const h1 = await page.evaluate(() => [
    [...document.querySelectorAll("[data-pk-line]")].map(b => b.textContent.trim()).join("|"),
    [...document.querySelectorAll('[data-pk-line][aria-pressed="true"]')].map(b => b.textContent.trim()).join("|"),
    document.querySelector("[data-pk-pv]").textContent.includes("中央")]);
  ok("11-1 過去に「中央」で書いた位置は、「肩甲中線」が選んである状態で見える（書いた語はそのまま残る）", JSON.stringify(h1) === JSON.stringify(["脊柱寄り|肩甲中線|後腋窩線寄り", "肩甲中線", true]), h1);
  await page.locator('[data-pk-line="肩甲中線"]').click();
  await wait(200);
  const h2 = await page.evaluate(() => { flushSave(); return allCases()[0].pocus.sites[0].lines; });
  ok("11-2 押すと外れる（二重に入らない）", JSON.stringify(h2) === "[]", h2);
  await page.locator('[data-pk-line="肩甲中線"]').click();
  await wait(200);
  const h3 = await page.evaluate(() => { flushSave(); return allCases()[0].pocus.sites[0].lines; });
  ok("11-3 もう一度押すと「肩甲中線」で入る", JSON.stringify(h3) === JSON.stringify(["肩甲中線"]), h3);
  /* 印の条件の「叩いた線」に過去の語が入っている下書き（五回目の独立した確認） */
  await page.evaluate(() => {
    const c = newCase();
    c.question = "（試し）胸水の上縁"; c.disease = "effusion"; c.qtype = "quant";
    c.pre.firstDx = "（試し）"; c.pre.conf = 70; c.pre.confTouched = true;
    c.pre.mark = { posture: "座位", line: "背面・中央", style: "" };
    if (!persistCase(c)) throw new Error("persist failed");
    wizardIntent = { caseId: c.id, step: 2 }; nav("#list"); nav("#new");
  });
  await page.waitForSelector('.chips[data-name="mkline"]');
  const h5 = await page.evaluate(() => [...document.querySelectorAll('.chips[data-name="mkline"] .chip[aria-pressed="true"]')].map(b => b.textContent.trim()).join("|"));
  ok("11-3b 「叩いた線」が過去の語（背面・中央）の下書きは、「背面・肩甲中線」が選んである状態で見える", h5 === "背面・肩甲中線", h5);
  await page.locator('.chips[data-name="mkposture"] .chip', { hasText: "仰臥位" }).click();
  await wait(200);
  const h6 = await page.evaluate(() => { flushSave(); const m = allCases().find(c => c.disease === "effusion").pre.mark; return [m.posture, m.line]; });
  ok("11-3c その下書きで体位を仰臥位に替えると、線は「側面・中腋窩線」に替わる", JSON.stringify(h6) === JSON.stringify(["仰臥位", "側面・中腋窩線"]), h6);
  ok("11-4 画面の誤り（console）が無い", H.errs.length === 0, H.errs);
  await H.ctx.close();
} finally {
  await browser.close();
}
console.log("合格 " + pass + " ／ 不合格 " + fail);
if (fail) { fails.forEach(f => console.log("  ✗ " + f.slice(0, 500))); process.exit(1); }
