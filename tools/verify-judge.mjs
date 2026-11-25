// 運筆判定の自己検証。index.html から判定コード (◆JUDGE_BEGIN◆〜◆JUDGE_END◆) と書き順データを
// そのまま取り出して Node で実行する。ブラウザの getPointAtLength の代わりに、ここで SVG パスを弧長で標本化する。
// 使い方: node tools/verify-judge.mjs [index.html]   (結果は標準出力。必須検証が落ちたら exit 1)
import fs from "node:fs";

const htmlPath = process.argv[2] || new URL("../index.html", import.meta.url).pathname;
const html = fs.readFileSync(htmlPath, "utf8");
const pick = re => { const m = html.match(re); if (!m) throw new Error("not found: " + re); return m[1]; };
const judgeSrc = pick(/\/\/ ◆JUDGE_BEGIN◆([\s\S]*?)\/\/ ◆JUDGE_END◆/);
const strokesRaw = pick(/const STROKES_RAW = `([\s\S]*?)`;/);
const raw = pick(/const RAW = `([\s\S]*?)`;/);
const J = new Function(judgeSrc + "\nreturn { JUDGE, judgeStroke, newCharState, resample, plen };")();

// ───── SVG パス (M/m/C/c/S/s/L/l/Z) → 点列。ベジェを細かく折れ線にしてから弧長で等間隔に取る ─────
function parsePath(d) {
  const toks = d.match(/[MmCcSsLlZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
  const pts = []; let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lc = null;
  const num = () => parseFloat(toks[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let s = 1; s <= 48; s++) {
      const t = s / 48, u = 1 - t;
      pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
    lc = [x2, y2]; x = x3; y = y3;
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": x = ox + num(); y = oy + num(); sx = x; sy = y; pts.push([x, y]); lc = null; cmd = rel ? "l" : "L"; break;
      case "L": x = ox + num(); y = oy + num(); pts.push([x, y]); lc = null; break;
      case "C": { const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; cubic(...a); break; }
      case "S": {
        const x1 = lc ? 2 * x - lc[0] : x, y1 = lc ? 2 * y - lc[1] : y;
        const a = [ox + num(), oy + num(), ox + num(), oy + num()]; cubic(x1, y1, ...a); break;
      }
      case "Z": x = sx; y = sy; pts.push([x, y]); break;
      default: throw new Error("unsupported path command " + cmd);
    }
  }
  return pts;
}
const REF_SAMPLES = 64; // index.html と同じ (getPointAtLength で 0..L を 64 等分)
const refPoints = d => J.resample(parsePath(d), REF_SAMPLES + 1);

const DATA = raw.trim().split("\n").map(l => l.trim().split("|")[0]);
const STROKES = new Map(strokesRaw.trim().split("\n").map(l => { const [k, ...ds] = l.trim().split("|"); return [k, ds]; }));
const CHARS = DATA.map(k => ({ k, refs: STROKES.get(k).map(refPoints), dense: STROKES.get(k).map(parsePath) }));

// ───── 乱数と「子どもの指書き」の揺らぎ ─────
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lerp = (a, b, t) => a + (b - a) * t;
function charTransform(r, k = 1) { // 字全体: 回転・拡大縮小・平行移動
  const th = (r() - .5) * 2 * 4 * Math.PI / 180 * k, s = 1 + (r() - .5) * 2 * .1 * k, tx = (r() - .5) * 2 * 6 * k, ty = (r() - .5) * 2 * 6 * k;
  const c = Math.cos(th) * s, si = Math.sin(th) * s;
  return p => [54.5 + c * (p[0] - 54.5) - si * (p[1] - 54.5) + tx, 54.5 + si * (p[0] - 54.5) + c * (p[1] - 54.5) + ty];
}
function kidStroke(dense, r, T, k = 1) {
  const P = J.resample(dense, 120), L = J.plen(P);
  // 両端を少し伸ばす/縮める
  const e0 = (r() - .4) * .2 * k, e1 = (r() - .4) * .24 * k;
  let Q = P;
  const cut0 = Math.max(0, Math.round(-e0 * 119)), cut1 = Math.max(0, Math.round(-e1 * 119));
  Q = Q.slice(cut0, Q.length - cut1);
  if (e0 > 0) { const a = Q[0], b = Q[2], dl = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; Q = [[a[0] + (a[0] - b[0]) / dl * e0 * L, a[1] + (a[1] - b[1]) / dl * e0 * L], ...Q]; }
  if (e1 > 0) { const a = Q[Q.length - 1], b = Q[Q.length - 3], dl = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; Q = [...Q, [a[0] + (a[0] - b[0]) / dl * e1 * L, a[1] + (a[1] - b[1]) / dl * e1 * L]]; }
  Q = J.resample(Q, 120);
  // 低い周波数のよれ + 細かい震え (法線方向)
  const A1 = Math.min(2.5, .08 * L) * k * r(), f1 = 1 + 2 * r(), p1 = r() * 6.28, A2 = Math.min(1.2, .04 * L) * k * r(), f2 = 3 + 4 * r(), p2 = r() * 6.28;
  const W = Q.map((p, i) => {
    const a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
    const u = i / (Q.length - 1), o = A1 * Math.sin(6.283 * f1 * u + p1) + A2 * Math.sin(6.283 * f2 * u + p2) + (r() - .5) * .8 * k;
    return T([p[0] - ty / tl * o, p[1] + tx / tl * o]);
  });
  // 速さがむらのある点の取り方 (pointermove の間隔)
  const out = []; let u = 0;
  while (u < 1) { const x = u * (W.length - 1), i = Math.floor(x), f = x - i, a = W[i], b = W[Math.min(W.length - 1, i + 1)]; out.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]); u += (.01 + .05 * r()); }
  out.push(W[W.length - 1]);
  return out;
}
const shift = (p, dx, dy) => p.map(q => [q[0] + dx, q[1] + dy]);

// ───── 判定ヘルパー ─────
const ID = p => p;
function feed(ch, strokes) { // strokes を順に入れて、各結果を返す
  const cs = J.newCharState(ch.refs);
  return { res: strokes.map(s => J.judgeStroke(cs, s)), cs };
}
function afterCorrect(ch, k, stroke) { // 0..k-1 を正しく書いた後に stroke を入れた結果
  const cs = J.newCharState(ch.refs);
  for (let i = 0; i < k; i++) { const r = J.judgeStroke(cs, ch.refs[i]); if (r.result !== "ok") throw new Error(`${ch.k}: clean prefix rejected at ${i}`); }
  return J.judgeStroke(cs, stroke);
}

const log = [];
const out = s => { console.log(s); log.push(s); };
let fatal = 0;
const check = (name, ok, total, must) => {
  const pct = (ok / total * 100).toFixed(2);
  out(`${must ? (ok === total ? "PASS" : "FAIL") : "INFO"}  ${name}: ${ok}/${total} (${pct}%)`);
  if (must && ok !== total) fatal++;
};
const reasons = list => { const m = {}; for (const r of list) m[r] = (m[r] || 0) + 1; return Object.entries(m).map(([k, v]) => `${k}=${v}`).join(" "); };

out(`judge thresholds: ${JSON.stringify(J.JUDGE)}`);
out(`data: ${CHARS.length} kanji, ${CHARS.reduce((a, c) => a + c.refs.length, 0)} strokes`);
out("");

// 1. お手本パスそのもの (書き順どおり) は全画通る
{
  let ok = 0, okS = 0, tot = 0; const fails = [];
  for (const ch of CHARS) {
    const dense = ch.dense.map(d => J.resample(d, 40));
    const { res, cs } = feed(ch, dense);
    okS += res.filter(r => r.result === "ok").length; tot += res.length;
    if (cs.k === ch.refs.length) ok++; else fails.push(ch.k);
  }
  check("[必須1] お手本どおりの画列 → 全画確定して字が完成", ok, CHARS.length, true);
  out(`      画単位 ${okS}/${tot}${fails.length ? "  失敗: " + fails.join("") : ""}`);
}
// 1b. 子どもの指書き相当の揺らぎ (よれ・震え・長さ・字全体の回転/拡縮/ずれ) を入れても通る
for (const [label, k, trials, must] of [["子どもの指書き相当の揺らぎ", 1, 30, false], ["揺らぎ1.5倍 (かなり雑)", 1.5, 10, false]]) {
  let ok = 0, tot = 0, sOk = 0, sTot = 0; const why = [], who = {};
  for (const ch of CHARS) for (let t = 0; t < trials; t++) {
    const r = rng(ch.k.codePointAt(0) * 1000 + t + k * 7), T = charTransform(r, k);
    const cs = J.newCharState(ch.refs); let good = true;
    for (let i = 0; i < ch.refs.length; i++) {
      const res = J.judgeStroke(cs, kidStroke(ch.dense[i], r, T, k)); sTot++;
      if (res.result === "ok") sOk++; else { good = false; why.push(res.reason || res.result); who[ch.k] = (who[ch.k] || 0) + 1; break; }
    }
    tot++; if (good) ok++;
  }
  check(`[甘さ] ${label} → 1回目で全画確定した字`, ok, tot, must);
  out(`      画単位 ${sOk}/${sTot}  落ちた理由: ${reasons(why) || "なし"}  落ちた字: ${Object.entries(who).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a, b]) => a + b).join(" ")}`);
}
out("");

// 2. 書き順を入れ替えたものは弾かれる
{
  let ok = 0, tot = 0; const bad = [];
  for (const ch of CHARS) for (let k = 0; k + 1 < ch.refs.length; k++) {
    const r = afterCorrect(ch, k, ch.refs[k + 1]); tot++;
    if (r.result === "miss") ok++; else bad.push(`${ch.k}${k + 1}<->${k + 2}`);
  }
  check("[必須2] 隣り合う2画を入れ替え (k+1画目を k画目の番に書く) → 弾く", ok, tot, true);
  if (bad.length) out("      通ってしまった: " + bad.join(" "));
  let ok2 = 0, tot2 = 0; const bad2 = [];
  for (const ch of CHARS) for (let k = 0; k < ch.refs.length; k++) for (let j = k + 1; j < ch.refs.length; j++) {
    const r = afterCorrect(ch, k, ch.refs[j]); tot2++;
    if (r.result === "miss") ok2++; else bad2.push(`${ch.k}${k + 1}<-${j + 1}`);
  }
  check("[必須2] まだ書いていない後の画 (すべての組) を先に書く → 弾く", ok2, tot2, true);
  if (bad2.length) out("      通ってしまった: " + bad2.slice(0, 40).join(" "));
  // 揺らぎ入りの入れ替え
  let ok3 = 0, tot3 = 0; const bad3 = [];
  for (const ch of CHARS) for (let k = 0; k + 1 < ch.refs.length; k++) for (let t = 0; t < 5; t++) {
    const r = rng(ch.k.codePointAt(0) * 31 + k * 101 + t), T = charTransform(r);
    const res = afterCorrect(ch, k, kidStroke(ch.dense[k + 1], r, T)); tot3++;
    if (res.result === "miss") ok3++; else bad3.push(`${ch.k}${k + 1}<->${k + 2}`);
  }
  check("[参考] 揺らぎ入りで隣の2画を入れ替え → 弾く", ok3, tot3, false);
  if (bad3.length) out("      通ってしまった: " + [...new Set(bad3)].slice(0, 30).join(" "));
}
out("");

// 3. 1画を逆向きにしたものは弾かれる
{
  let ok = 0, tot = 0; const bad = [];
  for (const ch of CHARS) for (let k = 0; k < ch.refs.length; k++) {
    const r = afterCorrect(ch, k, ch.refs[k].slice().reverse()); tot++;
    if (r.result === "miss") ok++; else bad.push(`${ch.k}${k + 1}(${r.result})`);
  }
  check("[必須3] 1画を逆向き (終点→始点) に書く → 弾く", ok, tot, true);
  if (bad.length) out("      通ってしまった: " + bad.join(" "));
  let ok2 = 0, tot2 = 0; const bad2 = [], why = [];
  for (const ch of CHARS) for (let k = 0; k < ch.refs.length; k++) for (let t = 0; t < 5; t++) {
    const r = rng(ch.k.codePointAt(0) * 17 + k * 7 + t), T = charTransform(r);
    const res = afterCorrect(ch, k, kidStroke(ch.dense[k], r, T).reverse()); tot2++;
    if (res.result === "miss") { ok2++; why.push(res.reason); } else bad2.push(`${ch.k}${k + 1}`);
  }
  check("[参考] 揺らぎ入りの逆向き → 弾く", ok2, tot2, false);
  out(`      弾いた理由: ${reasons(why)}${bad2.length ? "  通ってしまった: " + [...new Set(bad2)].slice(0, 30).join(" ") : ""}`);
}
out("");

// 4. 全体を大きくずらしたものは弾かれる
{
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [.707, .707], [-.707, .707], [.707, -.707], [-.707, -.707]];
  for (const D of [30, 40]) {
    let ok = 0, tot = 0, accepted = 0, completed = 0; const bad = [];
    for (const ch of CHARS) for (const [ux, uy] of dirs) {
      const { res, cs } = feed(ch, ch.refs.map(p => shift(p, ux * D, uy * D))); tot++;
      const a = res.filter(r => r.result === "ok").length; accepted += a;
      if (cs.k === ch.refs.length) completed++;
      if (res[0].result === "miss" && cs.k < ch.refs.length) ok++; else bad.push(`${ch.k}(${ux},${uy})`);
    }
    check(`[必須4] 字全体を ${D} (枠の${(D / 109 * 100).toFixed(0)}%) ずらして書く → 1画目から弾き、字は完成しない`, ok, tot, true);
    out(`      完成してしまった字 ${completed}、たまたま別の画として通った画 ${accepted}${bad.length ? "  " + bad.slice(0, 20).join(" ") : ""}`);
  }
  let ok = 0, tot = 0; const bad = [];
  for (const ch of CHARS) for (let k = 0; k < ch.refs.length; k++) for (const [ux, uy] of dirs) {
    const r = afterCorrect(ch, k, shift(ch.refs[k], ux * 30, uy * 30)); tot++;
    if (r.result !== "ok") ok++; else bad.push(`${ch.k}${k + 1}`);
  }
  check("[必須4] 途中の1画だけを 30 ずらす (8方向) → 弾く", ok, tot, true);
  if (bad.length) out("      通ってしまった: " + bad.slice(0, 30).join(" "));
}
out("");

// 5. 形がちがう画は弾かれる (始点と終点は同じで、途中の形だけ変える)
{
  let okV = 0, totV = 0, okV4 = 0, totV4 = 0, okVs = 0, totVs = 0, okL = 0, totL = 0; const badV = [], badV4 = [], badVs = [], badL = [];
  for (const ch of CHARS) for (let k = 0; k < ch.refs.length; k++) {
    const R = ch.refs[k], a = R[0], b = R[R.length - 1], cl = Math.hypot(b[0] - a[0], b[1] - a[1]), L = J.plen(R);
    if (L < 20 || cl < 10) continue;
    let dev = 0;
    for (const p of R) dev = Math.max(dev, Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / cl);
    if (dev / cl < .12) { // ほぼまっすぐの画 → 途中で大きく曲げた「く」の字 (左右両方)
      for (const sg of [1, -1]) {
        const V = h => { const nx = -(b[1] - a[1]) / cl * sg, ny = (b[0] - a[0]) / cl * sg; return J.resample([a, [(a[0] + b[0]) / 2 + nx * cl * h, (a[1] + b[1]) / 2 + ny * cl * h], b], 40); };
        const r5 = afterCorrect(ch, k, V(.5)), r4 = afterCorrect(ch, k, V(.4));
        if (cl >= 25) {
          totV++; if (r5.result === "miss") okV++; else badV.push(`${ch.k}${k + 1}`);
          totV4++; if (r4.result === "miss") okV4++; else badV4.push(`${ch.k}${k + 1}`);
        } else { totVs++; if (r5.result === "miss") okVs++; else badVs.push(`${ch.k}${k + 1}`); }
      }
    } else if (dev / cl >= .3) { // 大きく折れる画 → まっすぐ1本
      const res = afterCorrect(ch, k, J.resample([a, b], 40)); totL++;
      if (res.result === "miss") okL++; else badL.push(`${ch.k}${k + 1}`);
    }
  }
  check("[形] まっすぐの画 (弦25以上) を「く」の字 (中央で弦の50%ふくらむ、左右両方) に曲げて書く → 弾く", okV, totV, true);
  if (badV.length) out("      通ってしまった: " + badV.slice(0, 30).join(" "));
  check("[形] 同上で ふくらみ 40% → 弾く (参考)", okV4, totV4, false);
  if (badV4.length) out("      通ってしまった: " + badV4.slice(0, 30).join(" "));
  check("[形] 短いまっすぐの画 (弦10〜25) を「く」の字 (50%) に曲げて書く → 弾く (指書きの誤差と近いので参考)", okVs, totVs, false);
  if (badVs.length) out("      通ってしまった: " + badVs.slice(0, 30).join(" "));
  check("[形] 大きく折れる画 (折れ・曲がり) をまっすぐ1本で書く → 弾く", okL, totL, false);
  if (badL.length) out("      通ってしまった: " + badL.slice(0, 40).join(" "));
}
out("");

// 6. うっかりタップは数えない / 点の画はタップでも可
{
  let ign = 0, tot = 0;
  for (const ch of CHARS) for (let k = 0; k < ch.refs.length; k++) {
    if (J.plen(ch.refs[k]) <= J.JUDGE.DOT) continue;
    const r = afterCorrect(ch, k, [[5, 5]]); tot++; if (r.result === "ignore") ign++;
  }
  check("[タップ] 枠の隅のうっかりタップ → ミスに数えない", ign, tot, true);
}
out("");
out(fatal ? `RESULT: ${fatal} 件の必須検証が失敗` : "RESULT: 必須検証はすべて通過");
process.exitCode = fatal ? 1 : 0;

// DEBUG=1 で、揺らぎ入りの正しい画が落ちたときの指標を出す (調整用)
if (process.env.DEBUG) {
  const J2 = new Function(judgeSrc + "\nreturn { compareStroke, prepRef, resample, plen, JUDGE };")();
  const rows = [];
  for (const k of [1, 1.5]) for (const ch of CHARS) for (let t = 0; t < (k === 1 ? 30 : 10); t++) {
    const r = rng(ch.k.codePointAt(0) * 1000 + t + k * 7), T = charTransform(r, k);
    const cs = J.newCharState(ch.refs);
    for (let i = 0; i < ch.refs.length; i++) {
      const s = kidStroke(ch.dense[i], r, T, k), res = J.judgeStroke(cs, s);
      if (res.result !== "ok") {
        const m = J2.compareStroke(J2.resample(s, J2.JUDGE.N), J2.plen(s), J2.prepRef(ch.refs[i]), cs.off);
        rows.push(`${k} ${ch.k}${i + 1} ${res.reason} avg=${m.avg.toFixed(1)} dS=${m.dS.toFixed(1)} dE=${m.dE.toFixed(1)} dir=${m.dir.toFixed(2)} seg=${m.seg.toFixed(2)} bend=${m.bend.toFixed(2)} len=${m.lenOk} off=${cs.off.map(v => v.toFixed(1))}`);
        break;
      }
    }
  }
  console.log(rows.join("\n"));
}
