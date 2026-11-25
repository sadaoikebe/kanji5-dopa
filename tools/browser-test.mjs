// ブラウザ (Chromium) での確認。getPointAtLength の標本が Node 側の標本と一致するか、
// ブラウザ標本でも判定が通る/弾くか、実際の画面をマウスで書いて遊べるかを見る。
// 使い方: PW=/path/to/node_modules/playwright/index.mjs node tools/browser-test.mjs [index.html] [スクショ保存先]
//   (playwright は同梱しない。npm i playwright && npx playwright install chromium で用意する)
const { chromium } = await import(process.env.PW || "playwright");
import fs from "node:fs";
const here = new URL(".", import.meta.url).pathname;
const htmlPath = process.argv[2] || here + "../index.html", verifyPath = here + "verify-judge.mjs", shotDir = process.argv[3] || "";
const shot = async name => { if (shotDir) await page.screenshot({ path: `${shotDir}/${name}` }); };
const vsrc = fs.readFileSync(verifyPath, "utf8");
const parseSrc = vsrc.match(/function parsePath[\s\S]*?\n}\n/)[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2, hasTouch: false });
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto("file://" + htmlPath);
await page.waitForTimeout(500);
const log = s => console.log(s);

// 1. getPointAtLength の標本 vs Node の標本、および判定をブラウザ標本で
const r1 = await page.evaluate(parseSrc => {
  const parsePath = new Function(parseSrc + "\nreturn parsePath;")();
  let maxDiff = 0, worst = "", n = 0, okChars = 0, revRej = 0, revTot = 0, swapRej = 0, swapTot = 0;
  for (const d of DATA) {
    const refs = refsFor(d);
    refs.forEach((pts, i) => {
      const mine = resample(parsePath(d.ds[i]), REF_SAMPLES + 1);
      for (let j = 0; j < pts.length; j++) {
        const e = Math.hypot(pts[j][0] - mine[j][0], pts[j][1] - mine[j][1]);
        if (e > maxDiff) { maxDiff = e; worst = d.k + (i + 1); }
      }
      n++;
    });
    const cs = newCharState(refs);
    refs.forEach(p => judgeStroke(cs, p));
    if (cs.k === refs.length) okChars++;
    for (let k = 0; k < refs.length; k++) {
      const c2 = newCharState(refs); for (let i = 0; i < k; i++) judgeStroke(c2, refs[i]);
      revTot++; if (judgeStroke(c2, refs[k].slice().reverse()).result === "miss") revRej++;
      if (k + 1 < refs.length) { const c3 = newCharState(refs); for (let i = 0; i < k; i++) judgeStroke(c3, refs[i]); swapTot++; if (judgeStroke(c3, refs[k + 1]).result === "miss") swapRej++; }
    }
  }
  return { n, maxDiff, worst, okChars, total: DATA.length, revRej, revTot, swapRej, swapTot };
}, parseSrc);
log(`[browser] getPointAtLength 標本 vs Node 標本: ${r1.n}画, 最大のずれ ${r1.maxDiff.toFixed(3)} (109座標, ${r1.worst})`);
log(`[browser] ブラウザ標本のお手本どおり → 完成 ${r1.okChars}/${r1.total}, 逆向き弾き ${r1.revRej}/${r1.revTot}, 隣入れ替え弾き ${r1.swapRej}/${r1.swapTot}`);

// 2. 実際の画面をマウスで操作
await page.click("#bStart", { force: true });
await page.waitForTimeout(2300); // 3,2,1,GO
const st0 = await page.evaluate(() => ({ phase, k: C.item.k, n: C.paths.length }));
log(`[ui] phase=${st0.phase} 1字目=${st0.k} (${st0.n}画)`);
async function drawStroke(pts, opt = {}) {
  const box = await page.locator("#pad").boundingBox();
  const P = pts.map(p => [box.x + p[0] * box.width / 109 + (opt.dx || 0), box.y + p[1] * box.height / 109 + (opt.dy || 0)]);
  await page.mouse.move(P[0][0], P[0][1]); await page.mouse.down();
  for (let i = 1; i < P.length; i++) { await page.mouse.move(P[i][0], P[i][1]); if (opt.shotAt === i) await shot(opt.shot); }
  await page.mouse.up();
  await page.waitForTimeout(60);
}
const refsNow = () => page.evaluate(() => C.refPts);
let refs = await refsNow();
// まちがい: 逆向き → 3回でヒント
for (let i = 0; i < 3; i++) await drawStroke(refs[0].slice().reverse().filter((_, j) => j % 2 === 0));
let s = await page.evaluate(() => ({ k: C.cs.k, miss: C.miss, hint: C.hint, ticker: ticker.textContent, combo: G.combo }));
log(`[ui] 逆向き3回: 確定=${s.k} ミス=${s.miss} ヒント=${s.hint} ticker="${s.ticker}"`);
await page.waitForTimeout(400);
await shot("2-hint.png");
// 正しく全部書く (1画目の途中でスクショ)
for (let i = 0; i < refs.length; i++) await drawStroke(refs[i].filter((_, j) => j % 2 === 0), i === 1 ? { shotAt: 20, shot: "1-drawing.png" } : {});
s = await page.evaluate(() => ({ k: C.item.k, done: G.done, score: G.score, stats: JSON.stringify(save.stats[C.item.k]), complete: C.complete, saved: JSON.parse(localStorage.getItem("kanji5dopa.v1")).stats[C.item.k] }));
log(`[ui] 1字目完成: ${s.k} complete=${s.complete} done=${s.done} score=${s.score} stats=${s.stats} (保存済み ${JSON.stringify(s.saved)})`);
await page.waitForTimeout(150);
await shot("3-complete.png");
// 残り: ノーミスで書き続けて COMBO と完了まで
for (let c = 1; c < 10; c++) {
  await page.waitForFunction(() => C && !C.complete && !C.locked && phase === "play", null, { timeout: 5000 });
  refs = await refsNow();
  for (let i = 0; i < refs.length; i++) await drawStroke(refs[i].filter((_, j) => j % 3 === 0));
  if (c === 5) { await page.waitForTimeout(250); await shot("4-combo.png"); }
}
await page.waitForTimeout(3500);
s = await page.evaluate(() => ({ phase, done: G.done, score: G.score, maxCombo: G.maxCombo, rank: document.querySelector("#rank").textContent, best: save.bestW, ls: localStorage.getItem("kanji5dopa.v1").length }));
log(`[ui] 10字後: phase=${s.phase} done=${s.done} score=${s.score} maxCombo=${s.maxCombo} rank=${s.rank} bestW=${s.best} localStorage ${s.ls}B`);
await shot("5-result.png");
const weakBtn = await page.evaluate(() => document.querySelector("#bWeak2").textContent + (document.querySelector("#bWeak2").classList.contains("hide") ? " (hidden)" : ""));
log(`[ui] 苦手ボタン: ${weakBtn}`);
// 苦手特訓 → 1画ずらして書く → おわる
await page.click("#bWeak2", { force: true }); await page.waitForTimeout(2300);
s = await page.evaluate(() => ({ phase, weak: G.weak, roundN: G.roundN, k: C.item.k }));
log(`[ui] 苦手特訓: phase=${s.phase} weak=${s.weak} roundN=${s.roundN} 字=${s.k}`);
refs = await refsNow();
await drawStroke(refs[0], { dx: 140, dy: 0 });
s = await page.evaluate(() => ({ k: C.cs.k, miss: C.miss, ticker: ticker.textContent }));
log(`[ui] 大きくずらした1画目: 確定=${s.k} ミス=${s.miss} ticker="${s.ticker}"`);
await page.click("#bQuit", { force: true }); await page.waitForTimeout(1800);
log(`[ui] おわる → phase=${await page.evaluate(() => phase)}`);
// 旧データ互換: 旧形式の保存データを入れて再読み込み
await page.evaluate(() => localStorage.setItem("kanji5dopa.v1", JSON.stringify({ best: 12345, stats: { "圧": [3, 1], "囲": [5, 0] } })));
await page.reload(); await page.waitForTimeout(400);
s = await page.evaluate(() => ({ t: document.querySelector("#tStats").textContent, w: document.querySelector("#bWeak").textContent, hid: document.querySelector("#bWeak").classList.contains("hide"), best: save.best }));
log(`[ui] 旧4択データ読み込み: "${s.t}" 苦手ボタン="${s.w}"${s.hid ? "(hidden)" : ""} 旧best=${s.best}`);
await shot("0-title.png");
log(errors.length ? "ERRORS:\n" + errors.join("\n") : "[browser] ページのエラー: なし");
await browser.close();
