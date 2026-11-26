// ブラウザ (Chromium) での確認。
//  1. getPointAtLength の標本が Node 側の標本と一致し、ブラウザ標本でも判定が通る/弾くか
//  2. バトルを実際にマウスで書いて通す: 正しい画で敵を倒す / まちがえた画で暴発ダメージ / 敵の到達でダメージ /
//     体力0でゲームオーバー → 結果 / にげる (手動終了) → 結果 / 図鑑に保存されて再生できる / 図鑑の容量と間引き / 旧データ互換
// 使い方: PW=/path/to/node_modules/playwright/index.mjs node tools/browser-test.mjs [index.html] [スクショ保存先]
//   (playwright は同梱しない。npm i playwright && npx playwright install chromium で用意する)
//   どれかの確認が落ちたら exit 1
const { chromium } = await import(process.env.PW || "playwright");
import fs from "node:fs";
const here = new URL(".", import.meta.url).pathname;
const htmlPath = (await import("node:path")).resolve(process.argv[2] || here + "../index.html"),verifyPath = here + "verify-judge.mjs", shotDir = process.argv[3] || "";
const vsrc = fs.readFileSync(verifyPath, "utf8");
const parseSrc = vsrc.match(/function parsePath[\s\S]*?\n}\n/)[0];
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const log = s => console.log(s);
const check = (ok, s) => { if (!ok) fails++; log(`${ok ? "PASS" : "FAIL"}  ${s}`); };
async function newPage(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: false });
  p.on("pageerror", e => errors.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await p.goto("file://" + htmlPath);
  await p.waitForTimeout(500);
  return p;
}
const page = await newPage(420, 860);
const shot = async (name, p = page) => { if (shotDir) await p.screenshot({ path: `${shotDir}/${name}` }); };

// ───── 1. getPointAtLength の標本 vs Node の標本、および判定をブラウザ標本で ─────
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
check(r1.maxDiff < .1, `[browser] getPointAtLength 標本 vs Node 標本: ${r1.n}画, 最大のずれ ${r1.maxDiff.toFixed(3)} (109座標, ${r1.worst})`);
check(r1.okChars === r1.total && r1.revRej === r1.revTot && r1.swapRej === r1.swapTot,
  `[browser] ブラウザ標本のお手本どおり → 完成 ${r1.okChars}/${r1.total}, 逆向き弾き ${r1.revRej}/${r1.revTot}, 隣入れ替え弾き ${r1.swapRej}/${r1.swapTot}`);

// ───── 2. バトル ─────
async function drawStroke(pts, opt = {}, p = page) {
  const box = await p.locator("#pad").boundingBox();
  const P = pts.map(q => [box.x + q[0] * box.width / 109 + (opt.dx || 0), box.y + q[1] * box.height / 109 + (opt.dy || 0)]);
  await p.mouse.move(P[0][0], P[0][1]); await p.mouse.down();
  for (let i = 1; i < P.length; i++) { await p.mouse.move(P[i][0], P[i][1]); if (opt.shotAt === i) await shot(opt.shot, p); }
  await p.mouse.up();
  await p.waitForTimeout(opt.wait ?? 60);
}
const waitPlay = (p = page) => p.waitForFunction(() => phase === "play" && C && !C.complete && !C.locked && E && E.state === "come", null, { timeout: 8000 });
const refsNow = (p = page) => p.evaluate(() => C.refPts);
const S = () => page.evaluate(() => ({ phase, k: C?.item.k, n: C?.paths.length, ck: C?.cs.k, miss: C?.miss, hint: C?.hint, ehp: E?.hp, estate: E?.state, eprog: E?.prog,
  boss: E?.boss, hp: G.hp, kills: G.kills, dmg: G.dmg, score: G.score, combo: G.combo, ticker: ticker.textContent, bolts: fx.bolts.length }));

await page.click("#bStart", { force: true });
await waitPlay();
let s = await S();
log(`[battle] 開始: phase=${s.phase} 1体目の弱点=${s.k} (${s.n}画) 敵HP=${s.ehp} こちらHP=${s.hp} boss=${s.boss}`);
const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
log(`INFO  [battle] この headless 環境 (ソフトウェア描画) での描画速度: ${fps.toFixed(1)} fps`);
check(s.ehp === s.n, `[battle] 敵の体力 = 画数: ${s.ehp} = ${s.n}`);
await shot("1-enemy.png");

// (a) 合成した正しい画で1体倒す
let refs = await refsNow();
const first = s.k;
// headless の描画は遅く、合成した画を書くのに時間がかかるので、この1体だけ到達までの時間をのばす (倒す仕組みの確認)
await page.evaluate(() => { E.limit = 1e4; });
await drawStroke(refs[0].filter((_, j) => j % 2 === 0), { wait: 30 });
s = await S();
check(s.ck === 1 && s.ehp === s.n - 1 && s.bolts > 0 && s.dmg === 1, `[battle] 正しい1画目 → 雷 (bolts=${s.bolts}) が落ちて敵HP ${s.n}→${s.ehp}, 画ダメージ=${s.dmg}, score=${s.score}`);
await shot("2-bolt.png");
for (let i = 1; i < refs.length; i++) await drawStroke(refs[i].filter((_, j) => j % 2 === 0), { wait: i === refs.length - 1 ? 40 : 60 });
s = await S();
const z1 = await page.evaluate(k => ({ rec: zukan.z[k], ls: JSON.parse(localStorage.getItem("kanji5dopa.zukan.v1") || "{}"), stats: save.stats[k] }), first);
check(s.estate === "dead" && s.kills === 1 && s.ehp === 0, `[battle] 最後の画 → 完成して必殺: 敵 state=${s.estate} 撃破=${s.kills} 敵HP=${s.ehp} score=${s.score} combo=${s.combo}`);
await page.waitForTimeout(120); await shot("3-kill.png");
check(!!z1.rec && !!z1.ls.z?.[first] && z1.rec.c === 1, `[zukan] 倒した「${first}」が図鑑に保存: ノーミス=${z1.rec?.c} ${z1.rec?.s / 10}秒 画数=${z1.rec?.d.split(" ").length} 記録 ${z1.rec?.d.length}文字 / stats=${JSON.stringify(z1.stats)}`);
check(z1.rec?.d.split(" ").length === refs.length, `[zukan] 保存した軌跡の画数 = 字の画数 (${z1.rec?.d.split(" ").length} = ${refs.length})`);

// (b) わざと間違えた画 (逆向き) → 暴発ダメージ、敵が近づく、3回でヒント
await waitPlay();
await page.evaluate(() => { E.limit = 1e4; });
s = await S();
refs = await refsNow();
log(`[battle] 2体目: ${s.k} (${s.n}画) boss=${s.boss}`);
const hp0 = s.hp, p0 = s.eprog;
await drawStroke(refs[0].slice().reverse().filter((_, j) => j % 2 === 0));
let s2 = await S();
check(s2.hp === hp0 - 1 && s2.eprog >= p0 + .065 && s2.miss === 1 && s2.ck === 0,
  `[battle] 逆向きの画 → 暴発: こちらHP ${hp0}→${s2.hp}, 敵の接近 ${p0.toFixed(3)}→${s2.eprog.toFixed(3)}, ミス=${s2.miss} ticker="${s2.ticker}"`);
await page.waitForTimeout(80); await shot("4-misfire.png");
for (let i = 0; i < 2; i++) await drawStroke(refs[0].slice().reverse().filter((_, j) => j % 2 === 0));
s2 = await S();
check(s2.hint === true && s2.hp === hp0 - 3 && s2.ck === 0, `[battle] 同じ画を3回まちがえ → ヒント=${s2.hint} こちらHP=${s2.hp} ticker="${s2.ticker}"`);

// (c) 敵の到達 → ダメージ、失敗として記録、次の敵へ
const st0 = await page.evaluate(() => JSON.stringify(save.stats[C.item.k]));
const hp1 = s2.hp, kReach = s2.k, bossReach = s2.boss;
await page.evaluate(() => { E.limit = limitSec(E.n); E.prog = .99; });
await page.waitForFunction(() => E.state === "reach", null, { timeout: 5000 });
await page.waitForTimeout(100);
let s3 = await S();
const st1 = await page.evaluate(() => ({ s: JSON.stringify(save.stats[C.item.k]), w: G.wrong.get(C.item.k), rq: G.requeue.map(r => r.item.k), reached: G.reached, failed: C.failed }));
const dmg = bossReach ? 4 : 3;
check(s3.hp === hp1 - dmg && st1.reached === 1 && st1.failed && st1.w?.reached && st1.rq.includes(kReach),
  `[battle] 敵が到達 → こちらHP ${hp1}→${s3.hp} (-${dmg}), 失敗として記録 stats ${st0}→${st1.s}, もう一度出す予定=${st1.rq.join("")}`);
await shot("5-reach.png");
// 次の敵をボスにする (表示確認用)
await page.evaluate(() => { G.requeue.unshift({ item: DATA.find(d => d.ds.length >= 17), due: 0 }); });
await waitPlay();
s = await S();
check(s.k !== kReach && s.boss, `[battle] 次の敵へ進む: ${s.k} (${s.n}画) boss=${s.boss}`);
await page.waitForTimeout(1400); await shot("6-boss.png");
// 画面の配置: 書き取りエリアが札 (熟語) と重ならない
const lay = await page.evaluate(() => { const a = pad.getBoundingClientRect(), b = promptEl.getBoundingClientRect(); return { pad: [a.left, a.top, a.width, a.height].map(Math.round), prompt: [b.left, b.top, b.width, b.height].map(Math.round), overlap: !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right) }; });
check(!lay.overlap, `[layout] 縦長 420x860: 書き取りエリア ${lay.pad} と 札 ${lay.prompt} は重ならない`);

// (d) 体力 0 → ゲームオーバー → 結果画面
await page.evaluate(() => { G.hp = 1; renderHp(); });
refs = await refsNow();
await drawStroke(refs[0].slice().reverse().filter((_, j) => j % 2 === 0));
s = await S();
check(s.phase === "end" && s.hp === 0, `[battle] 体力1で暴発 → HP=${s.hp} phase=${s.phase}`);
await page.waitForFunction(() => phase === "result", null, { timeout: 5000 });
await page.waitForTimeout(300);
let res = await page.evaluate(() => ({ head: $("#rhead").textContent, rank: $("#rank").textContent, score: $("#rscore").textContent, kills: $("#rK").textContent, dmg: $("#rD").textContent,
  done: $("#rdone").textContent, best: $("#rnew").textContent, bestB: save.bestB, bestW: save.bestW, miss: $("#rmiss").textContent }));
check(res.head === "GAME OVER" && res.kills === "1" && res.done.includes(first) && res.bestB > 0,
  `[result] ゲームオーバー → 結果: "${res.head}" ランク=${res.rank} スコア=${res.score} 倒した敵=${res.kills} 画ダメージ=${res.dmg} 完成させた字="${res.done}" "${res.best}" bestB=${res.bestB} bestW=${res.bestW}`);
log(`[result] まちがえた字: ${res.miss}`);
await shot("7-result.png");

// (e) にげる (手動終了) → 結果画面
await page.click("#bAgain", { force: true });
await waitPlay();
s = await S();
check(s.hp === 10 && s.kills === 0, `[battle] もう一回: HP=${s.hp} 撃破=${s.kills} 1体目=${s.k}`);
await page.click("#bQuit", { force: true });
await page.waitForFunction(() => phase === "result", null, { timeout: 5000 });
res = await page.evaluate(() => ({ head: $("#rhead").textContent, kills: $("#rK").textContent }));
check(res.head === "バトル終了", `[result] にげる → 結果: "${res.head}" 倒した敵=${res.kills}`);

// (f) 図鑑を開いて再生
await page.click("#bTitle", { force: true }); await page.waitForTimeout(200);
const tstat = await page.evaluate(() => $("#tStats").textContent + " / " + $("#bZukan").textContent);
log(`[title] ${tstat}`);
await page.click("#bZukan", { force: true }); await page.waitForTimeout(300);
let zk = await page.evaluate(() => ({ phase, count: $("#zcount").textContent, got: document.querySelectorAll(".zc.got").length, gold: document.querySelectorAll(".zc.gold").length, cells: document.querySelectorAll(".zc").length }));
check(zk.phase === "zukan" && zk.count === "1/193" && zk.got === 1 && zk.gold === 1 && zk.cells === 193, `[zukan] 図鑑: 収録 ${zk.count} マス=${zk.cells} 収録済み=${zk.got} 金の印=${zk.gold}`);
await shot("8-zukan.png");
await page.click(`.zc.got`, { force: true });
await page.waitForTimeout(500);
await shot("9-zplay-mid.png");
await page.waitForFunction(() => ZP.done, null, { timeout: 30000 });
const zp = await page.evaluate(() => {
  const d = zctx.getImageData(0, 0, zc.width, zc.height).data; let lit = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 200) lit++;
  return { k: ZP.k, played: ZP.played, n: ZP.strokes.length, total: ZP.total.toFixed(2), lit, info: $("#zM").textContent };
});
check(zp.k === first && zp.played === zp.n - 1 && zp.lit > 1000, `[zukan] 「${zp.k}」を書き順どおり再生: ${zp.played + 1}/${zp.n}画 再生 ${zp.total}秒, 描いた画素 ${zp.lit} ・ "${zp.info}"`);
await shot("10-zplay.png");
await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.waitForTimeout(100);
log(`[zukan] Escape で閉じる → phase=${await page.evaluate(() => phase)}`);

// (g) 図鑑の容量: 193字すべて (お手本の点列を本人の画とみなす) を収録したときの大きさ、と上限を超えたときの間引き
const cap = await page.evaluate(() => {
  const recs = {};
  for (const d of DATA) recs[d.k] = { d: zEncode(refsFor(d).map(p => ({ p }))), m: d.ds.map(() => 45), c: 1, s: 123, t: 1764000000 };
  const all = JSON.stringify({ v: 1, z: recs }).length;
  return { all, per: Math.round(all / DATA.length), max: Math.max(...Object.values(recs).map(r => r.d.length)) };
});
log(`[zukan] 容量の目安: 193字ぜんぶで ${cap.all.toLocaleString()} 文字 (UTF-16 で約 ${(cap.all * 2 / 1024).toFixed(0)}KB), 1字平均 ${cap.per} 文字, 最大 ${cap.max} 文字 (上限 Z_BUDGET=${await page.evaluate(() => Z_BUDGET)})`);
check(cap.all < (await page.evaluate(() => Z_BUDGET)), `[zukan] 193字ぜんぶ入れても Z_BUDGET に収まる`);
// localStorage をほぼ満杯にしてから図鑑に入れ続け、古い通常記録から間引かれて新しい記録は保存されること
const thin = await page.evaluate(() => {
  let lo = 0, hi = 12e6;
  while (hi - lo > 2000) { const m = (lo + hi) >> 1; try { localStorage.setItem("junk", "x".repeat(m)); lo = m; } catch { hi = m; } }
  localStorage.setItem("junk", "x".repeat(Math.max(0, lo - 30000))); // 残り 約3万文字
  const t0 = zukan.thinned || 0; let lastOk = 0, savedAll = true;
  DATA.forEach((d, i) => {
    const ink = refsFor(d).map(p => ({ p, ms: 400 }));
    zOffer(d.k, i % 3 === 0, 5 + i, ink);
    const ls = JSON.parse(localStorage.getItem(ZKEY));
    if (ls.z[d.k]) lastOk = i + 1; else savedAll = false;
  });
  const ls = JSON.parse(localStorage.getItem(ZKEY)), recs = Object.values(ls.z);
  const out = { quota: lo, thinned: (zukan.thinned || 0) - t0, kept: recs.length, lo: recs.filter(r => r.lo).length, cleanKept: recs.filter(r => r.c).length,
    lastSaved: !!ls.z[DATA[DATA.length - 1].k], savedAll, size: localStorage.getItem(ZKEY).length };
  localStorage.removeItem("junk");
  return out;
});
check(thin.lastSaved && thin.savedAll && thin.thinned > 0,
  `[zukan] 満杯の localStorage (約${(thin.quota / 1e6).toFixed(1)}M文字) で193字を入れる → 毎回保存できた=${thin.savedAll}, 間引き ${thin.thinned}回, 残った記録 ${thin.kept} (点を間引いた ${thin.lo}, ノーミス ${thin.cleanKept}), 図鑑 ${thin.size}文字`);
// 図鑑の記録を壊さないよう、テストで入れた分は戻す
await page.evaluate(k => { const keep = zukan.z[k]; for (const x of Object.keys(zukan.z)) delete zukan.z[x]; zukan.z[k] = keep; delete zukan.thinned; zPersist(k); }, first);

// ───── 3. 横長の画面 ─────
const land = await newPage(1024, 700);
await land.click("#bStart", { force: true });
await waitPlay(land);
const lay2 = await land.evaluate(() => { const a = pad.getBoundingClientRect(), b = promptEl.getBoundingClientRect(); return { pad: [a.left, a.top, a.width, a.height].map(Math.round), prompt: [b.left, b.top, b.width, b.height].map(Math.round), overlap: !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right) }; });
check(!lay2.overlap && lay2.pad[2] >= 300, `[layout] 横長 1024x700: 書き取りエリア ${lay2.pad} と 札 ${lay2.prompt} は重ならない`);
refs = await refsNow(land);
await drawStroke(refs[0].filter((_, j) => j % 2 === 0), { wait: 40 }, land);
await shot("11-landscape.png", land);
await land.close();

// ───── 4. 旧データ互換 ─────
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("kanji5dopa.v1", JSON.stringify({ best: 12345, bestW: 6789, stats: { "圧": [3, 1], "囲": [5, 0, 2, 1] } })); });
await page.reload(); await page.waitForTimeout(400);
s = await page.evaluate(() => ({ t: $("#tStats").textContent, w: $("#bWeak").textContent, hid: $("#bWeak").classList.contains("hide"), best: save.best, bestW: save.bestW, bestB: save.bestB, z: $("#bZukan").textContent }));
check(s.best === 12345 && s.bestW === 6789 && s.bestB === 0 && !s.hid, `[compat] 旧データ読み込み: "${s.t}" 苦手ボタン="${s.w}" 旧best=${s.best} bestW=${s.bestW} bestB=${s.bestB} ${s.z}`);
await shot("0-title.png");
check(errors.length === 0, errors.length ? "[browser] ページのエラー:\n" + errors.join("\n") : "[browser] ページのエラー: なし");
await browser.close();
log(fails ? `RESULT: ${fails} 件 FAIL` : "RESULT: ブラウザ確認はすべて通過");
process.exit(fails ? 1 : 0);
