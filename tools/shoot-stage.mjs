// 見た目の確認用スクリーンショット (タイトル・バトル中・必殺の瞬間・FEVER・ボス・結果・図鑑・復習・横持ち)。
// 使い方: PW=/path/to/node_modules/playwright/index.mjs [FONTCONFIG_FILE=日本語フォント入りの fonts.conf] node tools/shoot-stage.mjs [保存先 (既定 tools/screens)]
// headless には日本語フォントが無いことが多いので、文字を読める形で撮るときは FONTCONFIG_FILE で Noto Sans JP などを足す。
// ページのエラーがあれば exit 1。
const { chromium } = await import(process.env.PW || "playwright");
import fs from "node:fs";
import path from "node:path";
const here = new URL(".", import.meta.url).pathname;
const htmlPath = path.resolve(here, "../index.html"), out = path.resolve(process.argv[2] || here + "screens");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ env: process.env });
const errors = [];
async function newPage(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  p.on("pageerror", e => errors.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await p.goto("file://" + htmlPath);
  await p.waitForTimeout(600);
  return p;
}
const shot = async (p, name) => { await p.screenshot({ path: `${out}/${name}` }); console.log("shot", name); };
// 合成の画をポインターイベントで書く (up = false なら書いている途中で止める)
const stroke = (p, pts, up = true) => p.evaluate(([pts, up]) => {
  const r = pad.getBoundingClientRect(), ev = (type, q) => new PointerEvent(type, { pointerId: 5, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
    clientX: r.left + q[0] * r.width / 109, clientY: r.top + q[1] * r.height / 109, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1 });
  if (!PAD.drawing) pad.dispatchEvent(ev("pointerdown", pts[0]));
  for (let i = 1; i < pts.length; i++) pad.dispatchEvent(ev("pointermove", pts[i]));
  if (up) pad.dispatchEvent(ev("pointerup", pts[pts.length - 1]));
}, [pts, up]);
const waitPlay = p => p.waitForFunction(() => phase === "play" && C && !C.complete && !C.locked && E && E.state === "come", null, { timeout: 10000 });
const refs = p => p.evaluate(() => C.refPts);
const pick = (p, cond) => p.evaluate(cond => { G.requeue.unshift({ item: DATA.find(new Function("d", "return " + cond)), due: 0 }); }, cond);

const page = await newPage(420, 860);
await page.waitForTimeout(1200);
await shot(page, "01-title.png");

// バトル: 1画目を書いている途中 → 1画目を書いた直後 (音符が飛ぶ) → 字の完成 (フィナーレ)
await page.click("#bStart", { force: true });
await waitPlay(page);
await page.evaluate(() => { E.limit = 1e4; });
await page.waitForTimeout(900);
let R = await refs(page);
const half = R[0].slice(0, Math.ceil(R[0].length * .7));
await stroke(page, half, false); await page.waitForTimeout(40);
await shot(page, "02-battle-writing.png");
await stroke(page, R[0].slice(half.length - 1)); await page.waitForTimeout(140);
await shot(page, "03-battle-stroke.png");
for (let i = 1; i < R.length; i++) { await stroke(page, R[i]); await page.waitForTimeout(30); }
await page.waitForTimeout(260);
await shot(page, "04-finale.png");
await page.waitForTimeout(500);
await shot(page, "04b-finale-later.png");

// FEVER (COMBO 10 以上 = ステージ最高潮)
await page.evaluate(() => { G.combo = 11; G.maxCombo = 11; comboV.textContent = "11"; multV.textContent = "×2.1"; setGear(2); });
await waitPlay(page);
await page.evaluate(() => { E.limit = 1e4; });
await page.waitForTimeout(1600);
await shot(page, "05-fever.png");
R = await refs(page);
for (let i = 0; i < R.length; i++) { await stroke(page, R[i]); await page.waitForTimeout(30); }
await page.waitForTimeout(300);
await shot(page, "05b-fever-finale.png");

// ボス
await pick(page, "d.ds.length >= 17");
await waitPlay(page);
await page.evaluate(() => { E.limit = 1e4; E.prog = .45; });
await page.waitForTimeout(1500);
await shot(page, "06-boss.png");
R = await refs(page);
await stroke(page, R[0]); await page.waitForTimeout(40);
await stroke(page, R[1].slice().reverse()); await page.waitForTimeout(120);
await shot(page, "06b-boss-misfire.png");

// 結果 (にげる → 結果)
await page.evaluate(() => finish());
await page.waitForFunction(() => phase === "result", null, { timeout: 5000 });
await page.waitForTimeout(700);
await shot(page, "07-result.png");
await page.waitForTimeout(2200);
await shot(page, "07b-result-settled.png");

// 図鑑と再生
await page.click("#bZukan2", { force: true });
await page.waitForTimeout(500);
await shot(page, "08-zukan.png");
await page.evaluate(() => openZPlay(Object.keys(zukan.z)[0]));
await page.waitForFunction(() => ZP.done, null, { timeout: 30000 });
await page.waitForTimeout(250);
await shot(page, "08b-zplay.png");
await page.evaluate(() => { closeZPlay(); closeZukan(); });

// 復習 (書きかけでゲームオーバー)
await page.evaluate(() => start(false));
await waitPlay(page);
await page.evaluate(() => { E.limit = 1e4; });
R = await refs(page);
await stroke(page, R[0]); await page.waitForTimeout(40);
await page.evaluate(() => { G.hp = 1; renderHp(); });
await stroke(page, R[1].slice().reverse());
await page.waitForFunction(() => RV.on && RV.played >= 1, null, { timeout: 8000 });
await page.waitForTimeout(400);
await shot(page, "09-review.png");
await browser.contexts()[0]?.close().catch(() => {});

// 横持ち
const land = await newPage(1024, 700);
await land.click("#bStart", { force: true });
await waitPlay(land);
await land.evaluate(() => { E.limit = 1e4; });
await land.waitForTimeout(800);
R = await refs(land);
for (let i = 0; i < R.length; i++) { await stroke(land, R[i]); await land.waitForTimeout(30); }
await land.waitForTimeout(280);
await shot(land, "10-landscape-finale.png");

await browser.close();
if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("OK: ページのエラーなし");
