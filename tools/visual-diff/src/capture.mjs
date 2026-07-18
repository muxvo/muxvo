/**
 * capture — 对 golden（老 app fixture 页）或 current（新 web 复刻页）逐场景截图。
 *
 * 用法：node src/capture.mjs golden|current [fixtureId ...]
 * 环境：GOLDEN_URL / CURRENT_URL 覆盖默认地址
 *  - golden:  http://localhost:5199/fixture.html  （muxvo-legacy: npm run fixture:serve）
 *  - current: http://localhost:5198/?screenshot=1 （muxvo/web: npm run dev）
 *
 * 产物：<target>/<id>.png（1440×900@2x）+ <target>/<id>.boxes.json（关键元素包围盒，CSS px）
 * playwright 复用 muxvo-legacy/node_modules（版本 1.58.2，chromium 浏览器已在 ms-playwright 缓存）。
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolveFixtures } from './resolve-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRequire = createRequire(
  join(here, '..', '..', '..', '..', 'muxvo-legacy', 'package.json'),
);
const { chromium } = legacyRequire('playwright');

const TARGETS = {
  golden: process.env.GOLDEN_URL || 'http://localhost:5199/fixture.html',
  current: process.env.CURRENT_URL || 'http://localhost:5198/?screenshot=1',
};

/**
 * 包围盒断言的关键元素（两侧用同一份选择器，按 DOM 顺序逐个配对）。
 * M2 任务4 起按屏配置于 fixtures/box-selectors.json（terminal-grid 键逐字搬运 M0 列表）；
 * 新屏复刻时必须先登记其选择器表，缺键即 throw（防静默零采样假绿）。
 */
const BOX_SELECTORS_BY_SCREEN = JSON.parse(
  readFileSync(join(here, '..', 'fixtures', 'box-selectors.json'), 'utf8'),
);

/** 时钟冻结 epoch（_CONTRACT.md「确定性铁律」）：两侧对称，消除相对时间类渲染的非确定性 */
const CAPTURE_EPOCH = '2026-06-01T12:00:00.000Z';

const target = process.argv[2];
if (!TARGETS[target]) {
  console.error('usage: node src/capture.mjs golden|current [fixtureId ...]');
  process.exit(1);
}
const onlyIds = process.argv.slice(3);
const resolved = resolveFixtures(onlyIds.length ? onlyIds : null);
// hover fixture 排到最后：page.hover 后虚拟鼠标位置残留在页面内，Chromium 在后续 DOM
// 重渲染时会按残留位置重算 :hover——把带 hover 的场景后置，保证无 hover 场景零污染。
const fixtures = [...resolved.filter((fx) => !fx.hover), ...resolved.filter((fx) => fx.hover)];
const outDir = join(here, '..', target);
mkdirSync(outDir, { recursive: true });

// 直连下载被墙 + npmmirror 缺 mac 构建：固定用本机已有 headless shell（与 1.58.2 实测兼容）。
// 两侧截图同一浏览器渲染，对比公平性不受版本影响。可用 CHROMIUM_PATH 覆盖。
// B5 起 pin 1200：1223 被 playwright GC 清理（2026-06-25），1200 对 f1/ftv-md/sk-list/
// mb-focused 四代表屏 vs 冻结 golden 实测 layout=0 违规 + diff 像素 0.0000%（像素级等价）。
const executablePath =
  process.env.CHROMIUM_PATH ||
  join(
    process.env.HOME,
    'Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  );
// 软件光栅（--disable-gpu）：backdrop-filter: blur() 在 GPU 光栅路径下对 GPU 竞争敏感——多 agent 并发把
// GPU 打满时，欢迎屏/菜单栏等磨砂玻璃屏会出现弥漫性亚像素漂移（wel-card 实测 ~0.87% chrome，超 0.5% 上限，
// preflight step5 偶发红），隔离下却逐字节等价。软件光栅不碰 GPU、对机器负载确定，且对全部冻结 golden
// 逐字节等价（`--disable-gpu` 全量 compare 实测 77/77 chrome=0.0000%，含所有 blur 屏）——固定软件光栅
// 消除该非确定性根因，golden 不变、无性能损失（全量 capture 17.9s vs GPU 18.1s）。
const browser = await chromium.launch({ executablePath, args: ['--disable-gpu'] });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.error(`[console.error] ${m.text()}`);
});

// 时钟冻结：argless new Date() 与 Date.now() 钉死到 CAPTURE_EPOCH（带参构造不动）。
// 终端网格屏不读时钟，对既有 golden 零影响（改后 15 场景 compare 全绿验证）。
await page.addInitScript(`(() => {
  const FIXED_MS = Date.parse('${CAPTURE_EPOCH}');
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) { super(FIXED_MS); } else { super(...args); }
    }
    static now() { return FIXED_MS; }
  }
  window.Date = FixedDate;
})();`);

await page.goto(TARGETS[target], { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__fixturePageUp === true, null, { timeout: 15000 });

async function settle() {
  await page.evaluate(
    () =>
      new Promise((res) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 50))),
      ),
  );
}

for (const fx of fixtures) {
  await page.evaluate((data) => window.__loadFixture(data), fx);
  await page.waitForFunction(() => window.__fixtureReady === true, null, { timeout: 15000 });

  // golden 侧瞬时态后置步骤（新 web 直接由 fixture 渲染，不需要）
  if (target === 'golden') {
    if (fx.editing) {
      const idx = fx.terminals.findIndex((t) => t.id === fx.editing.id);
      // JS click（不动鼠标，避免 hover 样式入图）→ 等输入框出现 → 原生 setter 设值
      await page.evaluate((i) => {
        document.querySelectorAll('.tile')[i].querySelector('.tile-name-clickable').click();
      }, idx);
      await page.waitForSelector('.tile-custom-name-input', { timeout: 5000 });
      await page.evaluate(
        ({ idx: i, value }) => {
          const input = document.querySelectorAll('.tile')[i].querySelector('.tile-custom-name-input');
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          ).set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        { idx, value: fx.editing.value },
      );
      await settle();
    }
    if (fx.dragging || fx.dragOver) {
      await page.evaluate(
        ({ draggingIdx, dragOverIdx }) => {
          const tiles = document.querySelectorAll('.tile');
          if (draggingIdx >= 0) tiles[draggingIdx].classList.add('dragging');
          if (dragOverIdx >= 0) tiles[dragOverIdx].classList.add('drag-over');
        },
        {
          draggingIdx: fx.dragging ? fx.terminals.findIndex((t) => t.id === fx.dragging) : -1,
          dragOverIdx: fx.dragOver ? fx.terminals.findIndex((t) => t.id === fx.dragOver) : -1,
        },
      );
      await settle();
    }
  }

  // hover 态：两侧对称真实悬停（强制 class 需改生产 CSS，违反 legacy 冻结）。
  // hover fixture 已后置（见上），残留鼠标位置不污染其余场景。
  if (fx.hover) {
    await page.locator(fx.hover.selector).nth(fx.hover.index ?? 0).hover();
    await settle();
  }

  // 吸收异步态（如 isGitRepo 探测）落地后的一帧重渲染
  await settle();
  await page.screenshot({ path: join(outDir, `${fx.id}.png`) });

  const screenSelectors = BOX_SELECTORS_BY_SCREEN[fx.screen ?? 'terminal-grid'];
  if (!screenSelectors) {
    throw new Error(`box-selectors.json 缺少屏 "${fx.screen}" 的选择器表（${fx.id}）`);
  }
  const boxes = await page.evaluate((selectors) => {
    const out = {};
    for (const sel of selectors) {
      out[sel] = Array.from(document.querySelectorAll(sel)).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x * 100) / 100,
          y: Math.round(r.y * 100) / 100,
          w: Math.round(r.width * 100) / 100,
          h: Math.round(r.height * 100) / 100,
        };
      });
    }
    return out;
  }, screenSelectors);
  writeFileSync(join(outDir, `${fx.id}.boxes.json`), JSON.stringify(boxes, null, 1));

  console.log(`✓ ${target}/${fx.id}.png`);
}

await browser.close();
console.log(`done: ${fixtures.length} fixture(s) → ${outDir}`);
