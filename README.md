# 漢字ブースト⑤ 書き取り

小学5年生の漢字193字を、指やペンで実際に書いて覚える1ファイルのブラウザゲーム。書き順まで1画ずつ判定する。
演出は [sadaoikebe/speedometer](https://github.com/sadaoikebe/speedometer) の考え方を借りている
(ワープトンネルの背景シェーダー、3色パレットの循環、画面の縁ゲージ、バネで揺れる針と残像、衝撃波、花火、全画面フラッシュ、モード切替の裏返り)。

`index.html` をブラウザで開くだけで遊べる。通信なし (書き順データは中に埋め込み済み)。記録は localStorage に保存。

## あそびかた

- 言葉と読みを見て、□に入る漢字を大きな枠に1画ずつ書く。指・ペン・マウスどれでもよい
- 正しい画 (書き順・位置・向き・形がだいたい合う) だけが確定して、きれいな線に置き換わる。ちがう画は赤く弾けて消えるので、同じ画を書き直す
- 同じ画を3回続けてまちがえると、次の画のお手本が薄く出て、光の点が書く向きに走る。「💡ヒント」ボタンでも出せる (1ミス扱い)
- 1回 10字 (苦手だけ特訓は苦手の数に合わせて3〜10字)。制限時間はない。「おわる」でいつでも結果へ
- 得点 = (基本1000 − ミス1画ごとに150 + 速さボーナス最大800) × COMBO倍率。速さボーナスは「2 + 1.1×画数」秒より速いほど多い
- COMBO はノーミスで書けた字の連続。3 / 6 でギアが上がって色が変わり、10 から金色で得点2倍
- ミスした字は3字後にもう一度出る。ミスの多い字ほど出やすい
- 「苦手だけ特訓」はミスしたことがあって、まだ書き取りマスターしていない字だけを出す。マスター = ノーミスで3回以上書けて、ノーミス回数がミス画数の2倍より多い

調整用の定数は `index.html` の「調整用の定数」の段に、判定の許容度は `JUDGE` にある。

## 運筆判定のしくみ

- 書き取りエリアは Pointer Events で1本の指だけを追い、1画ずつ点列を取る (KanjiVG の 109×109 座標に直す)
- お手本の点列は、埋め込んだ SVG パスからブラウザの `getPointAtLength` で取る
- 書いた画とお手本を弧長で33点にリサンプルし、始点・終点のずれ、対応点の平均距離、始点→終点の向き、8区間ごとの進む向き、始点→終点の線からの膨らみ方 (形)、長さを見る。子どもの指書きを前提に甘めにしてある
- 「次に書くべき画」に合っても、ほかの画 (まだ書いていない画、もう書いた画) のほうがはっきり良く合うなら、書き順ちがいとして弾く
- 確定した画から字全体のずれを少しだけ (最大 9) 補正する
- 弾いた理由 (書き順 / 逆向き / 位置 / 形) を画面に出す。うっかりタップはミスに数えない

### 自己検証

判定コードは `index.html` の `◆JUDGE_BEGIN◆`〜`◆JUDGE_END◆` に DOM なしで書いてあり、Node でそのまま実行できる。

```sh
node tools/verify-judge.mjs          # 193字 × (お手本どおり / 入れ替え / 逆向き / ずらし / 形ちがい / 揺らぎ) を検証
PW=/path/to/playwright/index.mjs node tools/browser-test.mjs   # Chromium で getPointAtLength と画面操作を確認 (任意)
```

最新の結果は `tools/verify-log.txt`。

## 書き順データ (KanjiVG)

書き順データは [KanjiVG](https://kanjivg.tagaini.net/) (© Ulrich Apel and contributors) の
SVG から、193字ぶんの各画の `d` 属性だけを書き順どおりに抜き出して `index.html` に埋め込んでいる。
KanjiVG は [Creative Commons Attribution-Share Alike 3.0 (CC BY-SA 3.0)](https://creativecommons.org/licenses/by-sa/3.0/) で配布されており、
`index.html` に埋め込んだ書き順データ (STROKES_RAW) も同じ CC BY-SA 3.0 に従う。

作り直すとき (取得はビルド時だけ):

```sh
mkdir -p /tmp/kvg
node -e 'const s=require("fs").readFileSync("index.html","utf8").match(/const RAW = `([\s\S]*?)`/)[1];
  for (const l of s.trim().split("\n")) console.log(l.trim().codePointAt(0).toString(16).padStart(5,"0"))' |
  while read h; do curl -fsSL -o /tmp/kvg/$h.svg https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/$h.svg; done
node tools/build-strokes.mjs /tmp/kvg     # index.html の ◆STROKES◆ 区間を書き換える
```

今回の取得元は KanjiVG master `9d7220d` (2026-11-18)。

## 保存データ (localStorage `kanji5dopa.v1`)

キーは旧4択版と同じで、旧データは壊さずに読み込む。

- `stats[字]` は `[4択の正解, 4択のミス, ノーミスで書けた回数, 書き取りのミス画数]`。旧版の2要素の配列はそのまま残し、書き取りの記録は3・4番目に足す
- マスター判定は書き取りの記録 (3・4番目) だけで行う。4択で覚えた字でも、書けるまではマスターにならない。苦手だけ特訓には4択でまちがえた字も入る
- ベストスコアは書き取り用に `bestW` を新しく持つ。旧 `best` (4択60秒の点) は点の付け方がちがうので比べず、消さずに残す
