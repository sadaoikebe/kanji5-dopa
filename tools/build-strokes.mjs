// KanjiVG の SVG (kanji/0xxxx.svg) から、index.html の193字ぶんの画パスを抜き出して埋め込む。
// 使い方: node tools/build-strokes.mjs <KanjiVGのsvgがあるディレクトリ> [index.html]
// 取得元: https://github.com/KanjiVG/kanjivg (CC BY-SA 3.0, © Ulrich Apel)
import fs from "node:fs";
import path from "node:path";

const [dir, htmlPath = new URL("../index.html", import.meta.url).pathname] = process.argv.slice(2);
if (!dir) { console.error("usage: node build-strokes.mjs <svgdir> [index.html]"); process.exit(1); }
const html = fs.readFileSync(htmlPath, "utf8");
const raw = html.match(/const RAW = `([\s\S]*?)`;/)[1];
const chars = raw.trim().split("\n").map(l => l.trim().split("|")[0]);

const SAFE_D = /^[MmCcSsLlHhVvQqTtZz0-9.,\-\s]+$/;
const out = [];
for (const k of chars) {
  const hex = k.codePointAt(0).toString(16).padStart(5, "0");
  const svg = fs.readFileSync(path.join(dir, hex + ".svg"), "utf8");
  const strokes = [];
  for (const m of svg.matchAll(/<path\b[^>]*>/g)) {
    const id = m[0].match(/\bid="kvg:([0-9a-f]+)-s(\d+)"/);
    const d = m[0].match(/\bd="([^"]*)"/);
    if (!id || !d) continue;
    if (id[1] !== hex) throw new Error(`${k}: unexpected id ${id[0]}`);
    if (!SAFE_D.test(d[1])) throw new Error(`${k}: unsafe path data`);
    strokes.push([+id[2], d[1].replace(/\s+/g, " ").trim()]);
  }
  strokes.sort((a, b) => a[0] - b[0]);
  strokes.forEach(([n], i) => { if (n !== i + 1) throw new Error(`${k}: stroke numbers not contiguous`); });
  if (!strokes.length) throw new Error(`${k}: no strokes`);
  out.push(k + "|" + strokes.map(s => s[1]).join("|"));
}
const block = "const STROKES_RAW = `\n" + out.join("\n") + "\n`;";
const re = /\/\/ ◆STROKES_BEGIN◆[\s\S]*?\/\/ ◆STROKES_END◆/;
if (!re.test(html)) throw new Error("markers not found in index.html");
fs.writeFileSync(htmlPath, html.replace(re, `// ◆STROKES_BEGIN◆ (tools/build-strokes.mjs で生成。KanjiVG, CC BY-SA 3.0)\n${block}\n// ◆STROKES_END◆`));
const total = out.reduce((a, l) => a + l.split("|").length - 1, 0);
console.log(`embedded ${out.length} kanji, ${total} strokes`);
