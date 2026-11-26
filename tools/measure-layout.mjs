// 書き取りエリアの大きさを画面サイズごとに実測する (headless Chromium)。
// 合格条件 (縦長): 欄の一辺 (canvas の CSS px) >= 画面幅の 88%、欄が画面で最も大きい要素、
//                  札・敵 (近づいた状態、ボスも) が欄に重ならない、列が表示領域からはみ出さない。
// 横長: 欄が列の高さいっぱい (現行の考え方) で、札と重ならない。
// 使い方: PW=/path/to/node_modules/playwright/index.mjs node tools/measure-layout.mjs [index.html] [スクショ保存先]
const { chromium } = await import(process.env.PW || "playwright");
const path = await import("node:path");
const here = new URL(".", import.meta.url).pathname;
const htmlPath = path.resolve(process.argv[2] || here + "../index.html"), shotDir = process.argv[3] || "";
// [幅, 高さ, 説明]。Android は画面そのもの・URL バー表示 (-56)・さらにステータスとナビゲーションのバー (-24-48) の3段で測る
const SIZES = [
  [360, 740, "Android 360x740 (バー無し)"], [360, 684, "Android 360x740 + URL バー"], [360, 612, "Android 360x740 + URL/ステータス/ナビ"],
  [412, 915, "Android 412x915 (バー無し)"], [412, 859, "Android 412x915 + URL バー"], [412, 787, "Android 412x915 + URL/ステータス/ナビ"],
  [390, 844, "iPhone 390x844 (バー無し)"], [390, 664, "iPhone 390x844 + Safari のバー"],
  [320, 568, "小さい iPhone SE 320x568 (参考)"], [768, 1024, "タブレット縦 768x1024 (参考)"],
];
const LAND = [[1024, 700, "横長 1024x700"], [844, 390, "スマホ横 844x390"], [915, 412, "Android 横 915x412"]];
const browser = await chromium.launch();
let fails = 0;
const log = s => console.log(s);
const check = (ok, s) => { if (!ok) fails++; log(`${ok ? "PASS" : "FAIL"}  ${s}`); };
const errors = [];
async function measure(w, h, name, land) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  p.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await p.goto("file://" + htmlPath); await p.waitForTimeout(300);
  await p.click("#bStart", { force: true });
  await p.waitForFunction(() => phase === "play" && E && E.state === "come", null, { timeout: 8000 });
  const res = [];
  for (const boss of [false, true]) {
    if (boss) await p.evaluate(() => { // ボス (21画まで) を出して、札の幅が一番広い条件でも測る
      const it = DATA.reduce((a, d) => d.ds.length > a.ds.length ? d : a); G.requeue.unshift({ item: it, due: 0 }); E.limit = limitSec(E.n); E.prog = .995;
    });
    if (boss) await p.waitForFunction(() => phase === "play" && E && E.boss && E.state === "come" && C && !C.locked, null, { timeout: 10000 });
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      E.limit = 1e4;
      const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const ov = (a, b) => !(a.b <= b.t || a.t >= b.b || a.r <= b.l || a.l >= b.r);
      const padR = R(pad), wrapR = R(padWrap), prR = { ...R(promptEl) };
      // 札は出現の拡大アニメ中でないときの寸法で測る
      // 敵の体の外接矩形 (角 1.3u 上 〜 裾 .95u 下、肩 ±1.05u) を、遠い・中間・目の前の3段で
      const foe = [];
      for (const pg of [0, .5, .999]) { E.prog = pg; E.hitAt = -9; const g = foeGeom(), q = foePos(g); foe.push({ pg, l: q.x - q.u * 1.05, r: q.x + q.u * 1.05, t: q.y - q.u * 1.3, b: q.y + q.u * .95, u: q.u }); }
      E.prog = .3;
      // 欄が一番大きい要素か: 欄の祖先・子孫以外で、画面に見えるもの (背景・枠・文字のある要素、Canvas に描いた敵の体の外接矩形) の面積と比べる。
      // 背景も枠も無い入れ物 (#stage, #arena など、場所を区切るだけで見えない div) は除く。入れ物の大きさは "box" として別に記録する
      let biggest = null, box = null;
      const visible = el => { const cs = getComputedStyle(el); return cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 ||
        [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); };
      for (const el of document.querySelectorAll("#game *")) {
        if (el.contains(pad) || pad.contains(el) || el === padWrap || padWrap.contains(el)) continue;
        if (!el.offsetParent) continue;
        const b = el.getBoundingClientRect(), a = b.width * b.height, it = { id: el.id || el.className || el.tagName, a: Math.round(a), w: Math.round(b.width), h: Math.round(b.height) };
        if (!visible(el)) { if (!box || a > box.a) box = it; continue; }
        if (!biggest || a > biggest.a) biggest = it;
      }
      for (const f of foe) { const w = f.r - f.l, h = f.b - f.t; if (w * h > biggest.a) biggest = { id: `敵(prog=${f.pg})`, a: Math.round(w * h), w: Math.round(w), h: Math.round(h) }; }
      const ctrlR = R($("#ctrl")), mute = R($("#mute")), tk = R(ticker), st = R(statusEl), hud = R($("#hud")), hearts = R(heartsEl);
      return { box, W: innerWidth, H: innerHeight, vh: getComputedStyle(document.documentElement).getPropertyValue("--vh").trim(), side: arena.classList.contains("side"),
        pad: padR, wrap: wrapR, prompt: prR, foe, biggest, ctrl: ctrlR, hud, ticker: tk, status: st,
        promptOverlap: ov(prR, wrapR), foeOverlap: foe.some(f => ov(f, wrapR)), foePromptOverlap: foe.map(f => ov(f, prR)),
        muteOverlap: ov(mute, wrapR), heartsFit: hearts.r <= R($("#gaugeSlot")).l + 1 && hearts.l >= R($("#scoreBox")).r - 1,
        statusFit: statEl(), tickerFit: ticker.scrollWidth <= ticker.clientWidth + 1, overflow: Math.max(ctrlR.b, wrapR.b) > innerHeight + .5 };
      function statEl() { return statusEl.scrollWidth <= statusEl.clientWidth + 1; }
    });
    res.push({ boss, ...r });
    if (shotDir) await p.screenshot({ path: `${shotDir}/${w}x${h}${boss ? "-boss" : ""}.png` });
  }
  if (!land) { // 復習表示と図鑑の再生の字の大きさ
    const z = await p.evaluate(() => {
      const it = C.item;
      openReview({ item: it, own: [], rest: C.refPts, from: 0 });
      const rv = rvc.getBoundingClientRect(), rvw = $("#rvwrap").getBoundingClientRect(), rvLast = $("#rvskip").getBoundingClientRect();
      closeReview();
      zukan.z[it.k] = { d: zEncode(refsFor(it).map(p => ({ p }))), m: it.ds.map(() => 40), c: 1, s: 100, t: 1764000000 };
      openZPlay(it.k);
      const zp = zc.getBoundingClientRect(), zbt = document.querySelector("#zplay .cbtns").getBoundingClientRect();
      closeZPlay(); delete zukan.z[it.k];
      return { rv: rv.width, rvBottom: Math.max(rvw.bottom, rvLast.bottom), zp: zp.width, zpBottom: zbt.bottom, H: innerHeight, W: innerWidth };
    });
    res.z = z;
  }
  await p.close();
  return res;
}
const f1 = x => Math.round(x);
log(`# 書き取りエリアの実測 (${new Date().toISOString().slice(0, 10)})`);
log(`# 一辺 = canvas#pad の CSS px。枠 (4px) を含む欄の外寸は +8px。比 = 一辺 / 画面幅`);
for (const [w, h, name] of SIZES) {
  const rs = await measure(w, h, name, false);
  for (const r of rs) {
    const side = r.pad.w, ratio = side / r.W, sq = Math.abs(r.pad.w - r.pad.h) < 1;
    log(`\n[${name}${r.boss ? " ボス" : ""}] 表示 ${r.W}x${r.H} --vh=${r.vh} 敵の位置=${r.side ? "札の横" : "札の下"}`);
    log(`  欄 ${f1(side)}x${f1(r.pad.h)} @(${f1(r.pad.l)},${f1(r.pad.t)}) 画面幅の ${(ratio * 100).toFixed(1)}% ・ 次に大きい見える要素 ${r.biggest.id} ${r.biggest.w}x${r.biggest.h} (見えない入れ物で最大は #${r.box.id} ${r.box.w}x${r.box.h})`);
    log(`  HUD 高さ ${f1(r.hud.h)} ・ 状態 ${f1(r.status.t)}-${f1(r.status.b)} ・ 札 ${f1(r.prompt.l)},${f1(r.prompt.t)} ${f1(r.prompt.w)}x${f1(r.prompt.h)} ・ ティッカー ${f1(r.ticker.t)}-${f1(r.ticker.b)} ・ ボタン ${f1(r.ctrl.t)}-${f1(r.ctrl.b)} (高さ ${f1(r.ctrl.h)})`);
    log(`  敵 (遠/中/目の前) u=${r.foe.map(f => f1(f.u)).join("/")} 外接 ${r.foe.map(f => `${f1(f.l)},${f1(f.t)}-${f1(f.r)},${f1(f.b)}`).join(" / ")}`);
    check(sq && ratio >= .88, `${name}${r.boss ? " ボス" : ""}: 欄の一辺 ${f1(side)}px = 画面幅の ${(ratio * 100).toFixed(1)}% (>= 88%)`);
    check(r.biggest.a < side * side, `${name}${r.boss ? " ボス" : ""}: 欄 (${f1(side * side)}px²) が画面で最も大きい (次は ${r.biggest.id} ${r.biggest.a}px²)`);
    check(!r.promptOverlap && !r.foeOverlap, `${name}${r.boss ? " ボス" : ""}: 札・敵が欄に重ならない (札=${r.promptOverlap} 敵=${r.foeOverlap})`);
    check(!r.overflow && !r.muteOverlap, `${name}${r.boss ? " ボス" : ""}: 列が表示領域に収まる (欄の下端 ${f1(r.wrap.b)} ボタンの下端 ${f1(r.ctrl.b)} <= ${r.H}) ・ 音ボタンが欄に重ならない`);
    check(r.heartsFit && r.statusFit && r.tickerFit, `${name}${r.boss ? " ボス" : ""}: HUD のハートが1行に収まる=${r.heartsFit} 状態の行が切れない=${r.statusFit} ティッカーが切れない=${r.tickerFit}`);
    if (r.side) log(`  INFO 敵と札の重なり (札の横のとき): ${r.foePromptOverlap.join("/")}`);
  }
  const z = rs.z;
  check(z.rv / z.W >= .85 && z.zp / z.W >= .85 && z.rvBottom <= z.H && z.zpBottom <= z.H,
    `${name}: 復習表示の字 ${Math.round(z.rv)}px (画面幅の ${(z.rv / z.W * 100).toFixed(1)}%) ・ 図鑑の再生の字 ${Math.round(z.zp)}px (${(z.zp / z.W * 100).toFixed(1)}%) ・ どちらも画面に収まる (下端 ${Math.round(z.rvBottom)} / ${Math.round(z.zpBottom)} <= ${z.H})`);
}
for (const [w, h, name] of LAND) {
  const rs = await measure(w, h, name, true);
  for (const r of rs) {
    const side = r.pad.w, colH = r.ctrl.t - r.hud.b, lim = Math.min(colH, (r.W - 16) * .6);
    log(`\n[${name}${r.boss ? " ボス" : ""}] 表示 ${r.W}x${r.H}`);
    log(`  欄 ${f1(side)}x${f1(r.pad.h)} @(${f1(r.pad.l)},${f1(r.pad.t)}) 画面の高さの ${(side / r.H * 100).toFixed(1)}% ・ HUD と操作ボタンの間 ${f1(colH)}px ・ 札 ${f1(r.prompt.l)},${f1(r.prompt.t)} ${f1(r.prompt.w)}x${f1(r.prompt.h)}`);
    check(side >= lim - 24 && !r.promptOverlap && !r.foeOverlap && !r.overflow, `${name}${r.boss ? " ボス" : ""}: 欄が列の高さいっぱい (${f1(side)}px / 列の高さ ${f1(colH)}px、上限 画面幅の60%)、札・敵と重ならない、はみ出さない`);
  }
}
check(errors.length === 0, errors.length ? "ページのエラー:\n" + errors.join("\n") : "ページのエラー: なし");
await browser.close();
log(fails ? `\nRESULT: ${fails} 件 FAIL` : "\nRESULT: 実測はすべて通過");
process.exit(fails ? 1 : 0);
