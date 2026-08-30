#!/usr/bin/env node
/* 答え合わせノート 操作マニュアルの画面収録12本を Playwright で録る。
   第11話 assets/record_ep11_clips.mjs のカーソル・タップ波紋・at() 同期を流用。

   ★収録対象は公開版（v1.16.0）── ユーザー指示「公開確認済みの v1.16.0 を実際に操作して収録」。
     ローカル :8532 だった第11話と違う点。SW が入るが録画には影響しない。
   ★拍は秒の直書きではなく assets/beats.json を読む（talk/make_beats.py が
     subs.json＋diagrams.json から自動採寸。台本を直したら --full → make_beats → 再収録）。

   使い方:
     node record_manual_clips.mjs all          # 12本を順に収録
     node record_manual_clips.mjs rec_s2       # 1本だけ
   出力: raw/<name>.webm */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/ai-management/node_modules/playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const APP = 'https://torukubota2023.github.io/kotaeawase-note/';
const SIZE = { width: 390, height: 844 };
const BEATS = JSON.parse(fs.readFileSync(path.join(HERE, 'beats.json'), 'utf8'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CURSOR_JS = `
(() => {
  if (window.__pwCursorInstalled) return; window.__pwCursorInstalled = true;
  const style = document.createElement('style');
  style.textContent = \`
    #__pwc { position: fixed; z-index: 2147483647; width: 34px; height: 34px; margin: -17px 0 0 -17px;
      border-radius: 50%; background: rgba(23,59,87,.28); border: 2.5px solid rgba(23,59,87,.85);
      pointer-events: none; transition: left .42s cubic-bezier(.3,.7,.4,1), top .42s cubic-bezier(.3,.7,.4,1);
      left: 50%; top: 60%; }
    .__pwr { position: fixed; z-index: 2147483646; width: 12px; height: 12px; margin: -6px 0 0 -6px;
      border-radius: 50%; border: 3px solid rgba(181,101,31,.9); pointer-events: none;
      animation: __pwrk .55s ease-out forwards; }
    @keyframes __pwrk { from { transform: scale(1); opacity: .95; } to { transform: scale(5.5); opacity: 0; } }\`;
  document.head.appendChild(style);
  const c = document.createElement('div'); c.id = '__pwc'; document.body.appendChild(c);
  window.__pwMove = (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px'; };
  window.__pwRipple = (x, y) => { const r = document.createElement('div'); r.className = '__pwr';
    r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r);
    setTimeout(() => r.remove(), 700); };
})();`;

async function installCursor(page) { await page.evaluate(CURSOR_JS); }

async function tap(page, selector, { settle = 250, scroll = true } = {}) {
  const loc = page.locator(selector).first();
  if (scroll) {
    await loc.evaluate(el => {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > innerHeight - 80)
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    let prev = null;
    for (let i = 0; i < 30; i++) {
      await sleep(160);
      const b = await loc.boundingBox();
      if (prev && b && Math.abs(b.y - prev.y) < 0.5 && Math.abs(b.x - prev.x) < 0.5) break;
      prev = b;
    }
  }
  const box = await loc.boundingBox();
  if (!box) throw new Error('見つからない: ' + selector);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => window.__pwMove(x, y), [x, y]);
  await sleep(380);
  await page.evaluate(([x, y]) => window.__pwRipple(x, y), [x, y]);
  await page.mouse.click(x, y);
  await sleep(settle);
}

async function smoothTo(page, sel, block = 'center') {
  await page.locator(sel).first().evaluate((el, block) =>
    el.scrollIntoView({ behavior: 'smooth', block }), block);
  await sleep(1100);
}

function clock(name) {
  const t0 = Date.now();
  const B = BEATS[name];
  if (!B) throw new Error('beats.json にない: ' + name);
  return async (key) => {
    const sec = B[key];
    if (sec == null) throw new Error(`beats.json ${name}.${key} が無い`);
    const d = t0 + sec * 1000 - Date.now();
    if (d > 0) return sleep(d);
    console.warn(`  ⚠ ${name}.${key}: ${sec}s を ${-d}ms 超過`);
  };
}

async function newRec(name, opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: SIZE, recordVideo: { dir: RAW, size: SIZE },
    locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
    hasTouch: true, isMobile: true, ...opts,
  });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  return {
    browser, ctx, page,
    async save() {
      const video = page.video();
      await ctx.close();
      const p = await video.path();
      fs.renameSync(p, path.join(RAW, name + '.webm'));
      await browser.close();
      console.log('録画完了:', name);
    },
  };
}

/* ── 状態の仕込み。すべて架空データ。患者名・ID・生年月日・病室は存在しない ──
   アプリ内部の newCase()/lockCase()/lsSet() を page.evaluate から使う（第11話 recModality と同じ手口）。
   v1.15.0 以降 lockCase は "ok"/"already"/"savefail" を返すが、副作用は同じ。 */
const SEED_JS = {
  baseCase: `(() => {
    const c = newCase();
    c.question = '右下肺の濁音は胸水か、実質化か';
    c.disease = 'effusion'; c.age = '70代'; c.sex = '男性';
    c.pre.firstDx = '右 胸水'; c.pre.conf = 70; c.pre.site.sides = ['右']; c.pre.site.aspects = ['背面'];
    lockCase(c);
    lsSet(K_CASE + c.id, c);
    return c.id;
  })()`,
  judged: (baseId, n) => `(() => {
    const base = JSON.parse(localStorage.getItem('awn.case.${baseId}'));
    const ms = ['yes','partial','no','yes','yes'].slice(0, ${n});
    // 順序の意図: n=4（rec_followup の仕込み）で ずれ 0.18、はい を押すと 0.16 →
    //「小さくなった＝良い」の実例がフィードバック行に出る。n=5 の合計は順不同で 0.16

    ms.forEach((m, i) => {
      const c = JSON.parse(JSON.stringify(base));
      c.id = 'demoj' + (i + 1);
      c.createdAt = c.updatedAt = '2026-08-1' + (i + 1) + 'T09:00:00.000Z';
      c.status = 'reviewed'; c.wizardStep = 7;
      c.age = ['70代','60代','80代','70代','60代'][i];
      c.sex = ['男性','女性','男性','女性','男性'][i];
      c.outcome = Object.assign({}, c.outcome, { match: m });
      localStorage.setItem('awn.case.' + c.id, JSON.stringify(c));
    });
    localStorage.removeItem('awn.draft');
  })()`,
};

async function freshPage(rec) {
  await rec.page.goto(APP);
  await rec.page.evaluate(() => localStorage.clear());
  await rec.page.reload();
  await sleep(600);
}

const JOBS = {

  // 2章: 追加のしかたモーダル
  async rec_addhome() {
    const rec = await newRec('rec_addhome');
    await freshPage(rec);
    await installCursor(rec.page);
    const at = clock('rec_addhome');
    await at('tap_howto');
    await tap(rec.page, '#homeHowto');
    await at('show_sheet');
    await smoothTo(rec.page, '#modal-root .sheet', 'start');
    await at('end');
    await rec.save();
  },

  // 3章a: S1
  async rec_s1() {
    const rec = await newRec('rec_s1');
    await freshPage(rec);
    await installCursor(rec.page);
    const at = clock('rec_s1');
    await at('new');
    await tap(rec.page, '#newBtn');
    await at('disease');
    await tap(rec.page, '.chips[data-name="disease"] .chip[data-v="胸水"]');
    await at('side');
    await tap(rec.page, '.chips[data-name="s1side"] .chip[data-v="右"]');
    await at('tpl');
    await tap(rec.page, '#tplChips .chip[data-tpl="0"]');
    await at('age');
    await rec.page.locator('#f_age').evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(500);
    await rec.page.selectOption('#f_age', '70代');
    await at('sex');
    await rec.page.selectOption('#f_sex', '男性');
    await at('next');
    await tap(rec.page, '#wzNext');
    await at('end');
    await rec.save();
  },

  // 3章b: S2 ── 下書きを S2 に仕込んで開く
  async rec_s2() {
    const rec = await newRec('rec_s2');
    await freshPage(rec);
    await rec.page.evaluate(`(() => {
      const c = newCase();
      c.question = '右下肺の濁音は胸水か、実質化か';
      c.disease = 'effusion'; c.age = '70代'; c.sex = '男性';
      c.pre.site.sides = ['右'];   // サジェスト「右 胸水」は S1 の側から組み立てられる（sideOf）
      c.wizardStep = 2;
      lsSet(K_CASE + c.id, c);
      wizardIntent = { caseId: c.id, step: 2 };
      nav('#new');
    })()`);
    await installCursor(rec.page);
    const at = clock('rec_s2');
    await at('dx');
    await tap(rec.page, '#dxSugs .chip');
    await at('conf70');
    await tap(rec.page, '#confPresets .chip[data-p="70"]');
    await at('freq');
    await smoothTo(rec.page, '#cf1freq', 'center');
    await at('site_scroll');
    await smoothTo(rec.page, '#sp-pre', 'center');
    await at('aspect');
    await tap(rec.page, '#sp-pre .chip:has-text("背面")');
    await at('end');
    await rec.save();
  },

  // 3章c: S3 所見 → S4 ロック
  async rec_s3s4() {
    const rec = await newRec('rec_s3s4');
    await freshPage(rec);
    await rec.page.evaluate(`(() => {
      const c = newCase();
      c.question = '右下肺の濁音は胸水か、実質化か';
      c.disease = 'effusion'; c.age = '70代'; c.sex = '男性';
      c.pre.firstDx = '右 胸水'; c.pre.conf = 70; c.pre.site.sides = ['右']; c.pre.site.aspects = ['背面'];
      c.wizardStep = 3;
      lsSet(K_CASE + c.id, c);
      wizardIntent = { caseId: c.id, step: 3 };
      nav('#new');
    })()`);
    await installCursor(rec.page);
    const at = clock('rec_s3s4');
    await at('f1');
    await tap(rec.page, '.tri button.pos');
    await at('f2');
    await tap(rec.page, ':nth-match(.fnd, 2) .tri button.neg');
    await at('next');
    await tap(rec.page, '#wzNext');
    await at('lock_scroll');
    await smoothTo(rec.page, '#lockBtn', 'center');
    await at('lock');
    await tap(rec.page, '#lockBtn', { settle: 200 });
    await rec.page.waitForSelector('#toast.on', { timeout: 8000 });
    await at('end');
    await rec.save();
  },

  // 4章: S5
  async rec_s5() {
    const rec = await newRec('rec_s5');
    await freshPage(rec);
    await rec.page.evaluate(`(() => {
      const id = ${SEED_JS.baseCase};
      wizardIntent = { caseId: id, step: 5 };
      nav('#new');
    })()`);
    await installCursor(rec.page);
    const at = clock('rec_s5');
    await at('modality');
    await smoothTo(rec.page, '#modChips', 'center');
    await at('finding');
    await tap(rec.page, '.tri button.pos');
    await at('conf90');
    await tap(rec.page, '#confPresets2 .chip[data-p="90"]');
    await at('def_scroll');
    await smoothTo(rec.page, '#defChips', 'center');
    await at('def_yes');
    await tap(rec.page, '#defChips .chip[data-def="yes"]');
    await at('note_scroll');
    await smoothTo(rec.page, '#defChips', 'center');
    await at('end');
    await rec.save();
  },

  // 5章: 後日追記 → 1件フィードバック
  async rec_followup() {
    const rec = await newRec('rec_followup');
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 4));
    await rec.page.evaluate(`nav('#case/${baseId}')`);
    await installCursor(rec.page);
    const at = clock('rec_followup');
    await at('outcome_scroll');
    await smoothTo(rec.page, '#pOutcome', 'start');
    await at('match_scroll');
    await smoothTo(rec.page, '.chips[data-name="match"]', 'center');
    await at('match_yes');
    await tap(rec.page, '.chips[data-name="match"] .chip[data-v="はい"]');
    await at('jf_scroll');
    await smoothTo(rec.page, '#jfLine', 'center');
    await at('end');
    await rec.save();
  },

  // 6章: 集計
  async rec_stats() {
    const rec = await newRec('rec_stats');
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 5));
    await rec.page.evaluate(`location.hash = '#stats'`);
    await sleep(500);
    await installCursor(rec.page);
    const at = clock('rec_stats');
    await at('open_details');
    await tap(rec.page, 'details.opt > summary');
    await at('details_scroll');
    await smoothTo(rec.page, 'details.opt', 'start');
    await at('table_scroll');
    await smoothTo(rec.page, 'h2:has-text("確信度と的中の対応表")', 'start');
    await at('end');
    await rec.save();
  },

  // 三つの入り口 a: 一行記録
  async rec_quick() {
    const rec = await newRec('rec_quick');
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 3));
    await rec.page.evaluate(`nav('#list')`);
    await sleep(400);
    await installCursor(rec.page);
    const at = clock('rec_quick');
    await at('open');
    await tap(rec.page, '#quickBtn');
    await at('zure');
    await rec.page.fill('#qnZure', '右下の濁音を胸水と読んだ → 実際は無気肺');
    await at('next');
    await rec.page.fill('#qnNext', '呼吸音の減弱と一緒に、気管の位置も見る');
    await at('save');
    await tap(rec.page, '#qnSave');
    await at('end');
    await rec.save();
  },

  // 三つの入り口 b: おや？（1タップ → あとから中身を書く）
  async rec_oya() {
    const rec = await newRec('rec_oya');
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 3));
    await rec.page.evaluate(`nav('#list')`);
    await sleep(400);
    await installCursor(rec.page);
    const at = clock('rec_oya');
    await at('tap');
    await tap(rec.page, '#oyaBtn');            // 日付だけの「おや（未記入）」が積まれる
    await at('card');
    await smoothTo(rec.page, '.oyacard.pending', 'center');
    await at('open_card');
    await tap(rec.page, '.oyacard.pending');   // あとから中身を書くモーダル
    await at('write');
    await rec.page.fill('#oyZure', '減弱していたのに、振盪は保たれていた');
    await sleep(900);
    await rec.page.fill('#oyNext', '次は胸膜の厚さをエコーで見る');
    await at('end');
    await rec.save();
  },

  // 三つの入り口 c: 経過（追う患者・所見3〜5個・段階の目盛り）
  async rec_track() {
    const rec = await newRec('rec_track');
    await freshPage(rec);
    // 「経過」ボタンは記録が1件以上あるときだけ一覧に出る（空状態は2ボタンのみ）
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 3));
    await rec.page.evaluate(`nav('#list')`);
    await sleep(400);
    await installCursor(rec.page);
    const at = clock('rec_track');
    await at('go_track');
    await tap(rec.page, '#trkBtn');
    await at('new_btn');
    await tap(rec.page, '#trkNew');
    await at('label');
    await rec.page.fill('#tkLabel', '70代・器質化肺炎');
    await sleep(700);
    await rec.page.fill('#tkDis', '肺炎');
    await at('items');
    await tap(rec.page, '#tkAdd');
    await sleep(800);
    await tap(rec.page, '#tkAdd');
    await at('anchor_scroll');
    await smoothTo(rec.page, '#tkItemList', 'center');
    await at('end');
    await rec.save();
  },

  // 三つの入り口 c-2: 経過の毎日の入力（v1.17.0 同一検者チップ・二度取り）
  async rec_trackday() {
    const rec = await newRec('rec_trackday');
    await freshPage(rec);
    /* 追跡を1本仕込む。所見1つ・強さのみ・目盛りは書いてある状態（画面を単純に保つ）。
       過去に2日ぶん入っているので、保存すると集計も動く。すべて架空データ */
    await rec.page.evaluate(`(() => {
      const tr = { id: 'tDemo', label: '70代・器質化肺炎', disease: '肺炎', closed: false,
        createdAt: '2026-08-20T09:00:00Z', updatedAt: '2026-08-20T09:00:00Z',
        items: [{ id: 'iA', nm: '呼吸音の減弱', site: [], qual: [], aspect: [], place: '',
                  segPlace: {}, axes: ['強さ'], emode: '区域', qlevels: [], binary: false,
                  anchors: ['対側と同じに聴こえる', '対側よりわずかに小さい',
                            '対側より明らかに小さい', 'ほとんど聴こえない'] }],
        obs: [{ date: '2026-08-28', v: { iA: 3 }, ref: 3 },
              { date: '2026-08-29', v: { iA: 2 }, ref: 2 }] };
      lsSet(K_TRACK, [tr]);
      nav('#track/tDemo');
    })()`);
    await sleep(500);
    await installCursor(rec.page);
    const at = clock('rec_trackday');
    await at('chips');
    await tap(rec.page, '[data-vk="iA"] .chip[data-lv="1"]');   // 「わずか」＝改善方向
    await at('ref');
    await tap(rec.page, '#trkRef .chip[data-ref="1"]');          // 軽度
    await at('other_scroll');
    await smoothTo(rec.page, '#otherChip', 'center');
    await at('other_tap');
    await tap(rec.page, '#otherChip');                           // 説明文が現れる
    await at('note_hold');
    await smoothTo(rec.page, '#otherNote', 'center');
    await at('save');
    await tap(rec.page, '#otherChip');                           // 実演なので戻して保存（自分が取った日に）
    await tap(rec.page, '#trkSave');
    await sleep(600);
    await at('twice_open');
    await tap(rec.page, '#trkTwice');                            // 値を伏せたモーダル
    await at('twice_fill');
    await tap(rec.page, '#modal-root .twchips[data-vk="iA"] .chip[data-lv="1"]');
    await sleep(900);
    await tap(rec.page, '#twSave');
    await at('end');
    await rec.save();
  },

  // 7章: S2 の実績行
  async rec_recordline() {
    const rec = await newRec('rec_recordline');
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 5));
    await rec.page.evaluate(`(() => {
      const c = newCase();
      c.question = '左下肺の濁音は胸水か';
      c.disease = 'effusion'; c.age = '60代'; c.sex = '女性';
      c.wizardStep = 2;
      lsSet(K_CASE + c.id, c);
      wizardIntent = { caseId: c.id, step: 2 };
      nav('#new');
    })()`);
    await installCursor(rec.page);
    const at = clock('rec_recordline');
    await at('line_scroll');
    await smoothTo(rec.page, '#cf1freq', 'center');
    await at('end');
    await rec.save();
  },

  // 8章: バックアップ
  async rec_backup() {
    const rec = await newRec('rec_backup');
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 5));
    await rec.page.evaluate(`location.hash = '#settings'`);
    await sleep(500);
    await installCursor(rec.page);
    const at = clock('rec_backup');
    await at('bk_scroll');
    await smoothTo(rec.page, '#bkBtn', 'center');
    await at('bk_tap');
    await tap(rec.page, '#bkBtn');
    await at('restore_scroll');
    await smoothTo(rec.page, '#rsFile', 'center');
    await at('end');
    await rec.save();
  },

  // 9章a: ダークモード
  async rec_dark() {
    const rec = await newRec('rec_dark', { colorScheme: 'dark' });
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(SEED_JS.judged(baseId, 5));
    await rec.page.evaluate(`location.hash = '#list'`);
    await sleep(400);
    await installCursor(rec.page);
    const at = clock('rec_dark');
    await at('stats_go');
    await rec.page.evaluate(`location.hash = '#stats'`);
    await at('end');
    await rec.save();
  },

  // 9章b: 文字を大きめに
  async rec_bigtype() {
    const rec = await newRec('rec_bigtype');
    await freshPage(rec);
    await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; })()`);
    await rec.page.evaluate(`location.hash = '#settings'`);
    await sleep(500);
    await installCursor(rec.page);
    const at = clock('rec_bigtype');
    await at('toggle_scroll');
    await smoothTo(rec.page, '#bigTypeToggle', 'center');
    await at('toggle_tap');
    await tap(rec.page, '#bigTypeToggle');
    await at('grown');
    await smoothTo(rec.page, '#bigTypeToggle', 'center');
    await at('end');
    await rec.save();
  },

  // 10章: 訂正と、書きかけの再開
  async rec_fix() {
    const rec = await newRec('rec_fix');
    await freshPage(rec);
    const baseId = await rec.page.evaluate(`(() => { const id = ${SEED_JS.baseCase}; return id; })()`);
    await rec.page.evaluate(`nav('#case/${baseId}')`);
    await installCursor(rec.page);
    const at = clock('rec_fix');
    await at('fix_scroll');
    await smoothTo(rec.page, '.fixrow', 'center');
    await at('fix_tap');
    await tap(rec.page, '.fixrow [data-fix]');
    await at('back_detail');
    await rec.page.evaluate(`nav('#case/${baseId}')`);
    await sleep(400);
    await at('badge_scroll');
    await smoothTo(rec.page, '.b-edit', 'center');
    await at('draft_seed');
    await rec.page.evaluate(`(() => {
      const c = newCase();
      c.question = '書きかけの例'; c.disease = 'pneumonia'; c.wizardStep = 2;
      lsSet(K_CASE + c.id, c);
      lsSet(K_DRAFT, { caseId: c.id });
      nav('#list');
    })()`);
    await sleep(400);
    await at('resume_scroll');
    await smoothTo(rec.page, '#resumeBtn', 'center');
    await at('end');
    await rec.save();
  },
};

const mode = process.argv[2];
fs.mkdirSync(RAW, { recursive: true });
if (mode === 'all') {
  for (const name of Object.keys(JOBS)) {
    console.log('──', name);
    await JOBS[name]();
  }
} else if (JOBS[mode]) {
  await JOBS[mode]();
} else {
  console.error('usage: node record_manual_clips.mjs all|' + Object.keys(JOBS).join('|'));
  process.exit(1);
}
