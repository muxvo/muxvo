/**
 * compare — 双层断言 + diff 热力图 + HTML 报告。
 *
 * 层 1（布局）：关键元素包围盒 golden vs current 逐个配对，|Δx/Δy/Δw/Δh| ≤ 1 CSS px
 * 层 2（像素）：pixelmatch（threshold 0.12）；.tile-terminal 文本区放宽，区外（chrome）从严
 *
 * 用法：node src/compare.mjs [fixtureId ...]
 * 产物：report/<id>.diff.png + report/index.html
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { allFixtureIds, resolveFixtures } from './resolve-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, '..');
const reportDir = join(base, 'report');
mkdirSync(reportDir, { recursive: true });

/** 阈值 */
const LAYOUT_TOLERANCE = 1.01; // CSS px（含浮点误差余量）
const PIXEL_THRESHOLD = 0.12; // pixelmatch 感知阈值
const CHROME_MAX_RATIO = 0.005; // 文本区外 diff 像素占比上限 0.5%
const TEXT_MAX_RATIO = 0.05; // 文本区内 diff 像素占比上限 5%
const DPR = 2;

const onlyIds = process.argv.slice(2);
const ids = onlyIds.length ? onlyIds : allFixtureIds();
const descById = Object.fromEntries(resolveFixtures(null).map((f) => [f.id, f.desc || '']));

function compareBoxes(golden, current) {
  const violations = [];
  const sels = new Set([...Object.keys(golden), ...Object.keys(current)]);
  for (const sel of sels) {
    const g = golden[sel] || [];
    const c = current[sel] || [];
    if (g.length !== c.length) {
      violations.push({ sel, type: 'count', golden: g.length, current: c.length });
      continue;
    }
    for (let i = 0; i < g.length; i++) {
      const dx = Math.abs(g[i].x - c[i].x);
      const dy = Math.abs(g[i].y - c[i].y);
      const dw = Math.abs(g[i].w - c[i].w);
      const dh = Math.abs(g[i].h - c[i].h);
      if (dx > LAYOUT_TOLERANCE || dy > LAYOUT_TOLERANCE || dw > LAYOUT_TOLERANCE || dh > LAYOUT_TOLERANCE) {
        violations.push({
          sel,
          type: 'rect',
          index: i,
          golden: g[i],
          current: c[i],
          delta: {
            dx: Math.round(dx * 100) / 100,
            dy: Math.round(dy * 100) / 100,
            dw: Math.round(dw * 100) / 100,
            dh: Math.round(dh * 100) / 100,
          },
        });
      }
    }
  }
  return violations;
}

/** 文本区（.tile-terminal）设备像素 rect 列表 */
function textRects(goldenBoxes) {
  return (goldenBoxes['.tile-terminal'] || []).map((r) => ({
    x0: Math.floor(r.x * DPR),
    y0: Math.floor(r.y * DPR),
    x1: Math.ceil((r.x + r.w) * DPR),
    y1: Math.ceil((r.y + r.h) * DPR),
  }));
}

function inAnyRect(x, y, rects) {
  for (const r of rects) {
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return true;
  }
  return false;
}

const results = [];

for (const id of ids) {
  const gPng = join(base, 'golden', `${id}.png`);
  const cPng = join(base, 'current', `${id}.png`);
  if (!existsSync(gPng) || !existsSync(cPng)) {
    results.push({ id, missing: true });
    console.log(`⚠ ${id}: 缺截图（golden:${existsSync(gPng)} current:${existsSync(cPng)}）`);
    continue;
  }
  const golden = PNG.sync.read(readFileSync(gPng));
  const current = PNG.sync.read(readFileSync(cPng));
  if (golden.width !== current.width || golden.height !== current.height) {
    results.push({ id, missing: true, note: `尺寸不一致 ${golden.width}x${golden.height} vs ${current.width}x${current.height}` });
    continue;
  }

  const { width, height } = golden;
  const diff = new PNG({ width, height });
  pixelmatch(golden.data, current.data, diff.data, width, height, {
    threshold: PIXEL_THRESHOLD,
    alpha: 0.15,
    diffColor: [255, 0, 0],
    aaColor: [255, 200, 0],
  });

  // 分区统计：diff 像素 = 纯红 [255,0,0]
  const gBoxes = JSON.parse(readFileSync(join(base, 'golden', `${id}.boxes.json`), 'utf8'));
  const cBoxes = JSON.parse(readFileSync(join(base, 'current', `${id}.boxes.json`), 'utf8'));
  const rects = textRects(gBoxes);
  let textArea = 0;
  for (const r of rects) textArea += (r.x1 - r.x0) * (r.y1 - r.y0);
  const chromeArea = width * height - textArea;

  let chromeDiff = 0;
  let textDiff = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (diff.data[idx] === 255 && diff.data[idx + 1] === 0 && diff.data[idx + 2] === 0) {
        if (inAnyRect(x, y, rects)) textDiff++;
        else chromeDiff++;
      }
    }
  }

  writeFileSync(join(reportDir, `${id}.diff.png`), PNG.sync.write(diff));

  const layoutViolations = compareBoxes(gBoxes, cBoxes);
  const chromeRatio = chromeArea > 0 ? chromeDiff / chromeArea : 0;
  const textRatio = textArea > 0 ? textDiff / textArea : 0;
  const pass =
    layoutViolations.length === 0 && chromeRatio <= CHROME_MAX_RATIO && textRatio <= TEXT_MAX_RATIO;

  results.push({ id, pass, layoutViolations, chromeDiff, textDiff, chromeRatio, textRatio });
  console.log(
    `${pass ? '✓' : '✗'} ${id}: layout=${layoutViolations.length} 违规, chrome=${(chromeRatio * 100).toFixed(4)}%, text=${(textRatio * 100).toFixed(4)}%`,
  );
  for (const v of layoutViolations.slice(0, 8)) {
    console.log(`    · ${v.sel} ${v.type === 'count' ? `数量 ${v.golden}≠${v.current}` : `#${v.index} Δ${JSON.stringify(v.delta)}`}`);
  }
}

// === HTML 报告 ===
const rows = results
  .map((r) => {
    if (r.missing) {
      return `<section class="fx fail"><h2>${r.id} <span class="badge fail">缺失</span></h2><p>${r.note || '截图缺失'}</p></section>`;
    }
    const badge = r.pass ? '<span class="badge pass">PASS</span>' : '<span class="badge fail">FAIL</span>';
    const viol = r.layoutViolations.length
      ? `<details${r.pass ? '' : ' open'}><summary>布局违规 ${r.layoutViolations.length} 项</summary><pre>${JSON.stringify(r.layoutViolations, null, 2)}</pre></details>`
      : '<p class="ok">布局包围盒全部 ≤1px ✓</p>';
    return `
<section class="fx ${r.pass ? 'pass' : 'fail'}">
  <h2>${r.id} ${badge} <small>${descById[r.id] || ''}</small></h2>
  <p>chrome diff：${(r.chromeRatio * 100).toFixed(4)}%（上限 ${(CHROME_MAX_RATIO * 100).toFixed(1)}%）·
     文本区 diff：${(r.textRatio * 100).toFixed(4)}%（上限 ${(TEXT_MAX_RATIO * 100).toFixed(0)}%）</p>
  ${viol}
  <div class="imgs">
    <figure><figcaption>老 app（golden）</figcaption><a href="../golden/${r.id}.png" target="_blank"><img src="../golden/${r.id}.png" /></a></figure>
    <figure><figcaption>新 web（current）</figcaption><a href="../current/${r.id}.png" target="_blank"><img src="../current/${r.id}.png" /></a></figure>
    <figure><figcaption>diff 热力图</figcaption><a href="${r.id}.diff.png" target="_blank"><img src="${r.id}.diff.png" /></a></figure>
  </div>
</section>`;
  })
  .join('\n');

const passCount = results.filter((r) => r.pass).length;
const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"/><title>探针 3 视觉回归报告</title>
<style>
  body { background:#0a0e14; color:#d4d4d8; font-family:-apple-system,'PingFang SC',sans-serif; padding:24px; }
  h1 { font-size:20px; } h2 { font-size:15px; margin:0 0 8px; } small { color:#71717a; font-weight:400; }
  .badge { font-size:11px; padding:2px 8px; border-radius:4px; vertical-align:2px; }
  .badge.pass { background:rgba(74,222,128,.15); color:#4ade80; }
  .badge.fail { background:rgba(248,113,113,.15); color:#f87171; }
  .fx { border:1px solid #1e2530; border-radius:10px; padding:16px; margin:16px 0; }
  .fx.fail { border-color:rgba(248,113,113,.4); }
  .imgs { display:flex; gap:12px; }
  figure { flex:1; margin:0; min-width:0; }
  figcaption { font-size:12px; color:#71717a; margin-bottom:4px; }
  img { width:100%; border:1px solid #1e2530; border-radius:6px; display:block; }
  pre { font-size:11px; background:#0d1117; padding:8px; border-radius:6px; overflow:auto; max-height:240px; }
  .ok { color:#4ade80; font-size:12px; } p { font-size:13px; }
  summary { cursor:pointer; font-size:12px; color:#f87171; }
</style></head><body>
<h1>M0 探针 3 · 终端 tile 网格复刻 — 视觉回归报告</h1>
<p>${passCount}/${results.length} PASS · 1440×900@2x · 布局 ≤1px + 像素感知（chrome ≤${(CHROME_MAX_RATIO * 100).toFixed(1)}% / 文本区 ≤${(TEXT_MAX_RATIO * 100).toFixed(0)}%）· ${new Date().toLocaleString('zh-CN')}</p>
${rows}
</body></html>`;

writeFileSync(join(reportDir, 'index.html'), html);
console.log(`\n报告：${join(reportDir, 'index.html')}（${passCount}/${results.length} PASS）`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
