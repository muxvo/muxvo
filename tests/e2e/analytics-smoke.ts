/**
 * Analytics 埋点烟雾测试
 * 前提: vite renderer server 需已在 :5173 运行
 * 运行: npx tsx tests/e2e/analytics-smoke.ts
 */

import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'path';
import { execSync } from 'child_process';

const PROJECT = resolve(__dirname, '../..');

async function click(win: Page, selector: string, label: string) {
  try {
    const el = win.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 3000 });
    await el.click();
    await win.waitForTimeout(600);
    console.log(`   ✅ ${label}`);
    return true;
  } catch {
    console.log(`   ⚠️ ${label} — 未找到 (${selector})`);
    return false;
  }
}

async function main() {
  // 杀掉已有 Electron
  try { execSync('pkill -9 -f "Electron.app/Contents/MacOS/Electron" 2>/dev/null'); } catch {}
  await new Promise(r => setTimeout(r, 1500));

  console.log('🚀 启动 Muxvo (Playwright + ELECTRON_RENDERER_URL)...');
  const app: ElectronApplication = await _electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' },
    timeout: 30000,
  });

  const win: Page = await app.firstWindow();
  await win.waitForTimeout(8000);
  await win.waitForLoadState('networkidle');

  await win.screenshot({ path: '/tmp/muxvo-analytics-test.png' });
  const bodyLen = await win.evaluate(() => document.body.innerHTML.length);
  console.log(`✅ 窗口已加载 (body: ${bodyLen} chars)\n`);

  if (bodyLen < 200) {
    console.log('❌ 白屏，跳过 UI 操作\n');
  } else {
    // ── 创建终端 ──
    console.log('📌 创建终端...');
    await click(win, 'button:has-text("+")', '创建终端');

    // ── 切换面板 ──
    console.log('📌 切换面板...');
    await click(win, 'button.menu-bar__tab:has-text("Skills")', 'Skills');
    await click(win, 'button.menu-bar__tab:has-text("MCP")', 'MCP');
    await click(win, 'button.menu-bar__tab:has-text("Hooks")', 'Hooks');
    await click(win, 'button.menu-bar__tab:has-text("Plugins")', 'Plugins');

    // Chat tab (最后一个 tab)
    const tabs = win.locator('button.menu-bar__tab');
    const tabCount = await tabs.count();
    if (tabCount >= 6) {
      await tabs.nth(5).click();
      await win.waitForTimeout(600);
      console.log('   ✅ Chat');
    }
    // 回到 terminals
    await tabs.nth(0).click();
    await win.waitForTimeout(300);

    // ── 设置 ──
    console.log('📌 打开设置...');
    await click(win, '.menu-bar__icon-btn', '设置');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }

  // ── 查询数据 ──
  console.log('\n📊 查询 analytics...');
  const today = new Date().toISOString().slice(0, 10);
  const summary = await win.evaluate(async (date: string) => {
    return await (window as any).api.analytics.getSummary(date, date);
  }, today);

  console.log('\n═══════════════════════════════════════');
  console.log('       📊 埋点验证结果');
  console.log('═══════════════════════════════════════');

  if (summary?.success && summary.data?.length > 0) {
    const day = summary.data[0];
    console.log(`  日期: ${day.date}  事件总数: ${day.totalEvents}\n`);
    const entries = Object.entries(day.eventCounts as Record<string, number>)
      .sort(([, a], [, b]) => (b as number) - (a as number));
    for (const [event, count] of entries) {
      console.log(`  ✅ ${event.padEnd(20)} ${count}次`);
    }

    const expected = ['session.start', 'terminal.create', 'screen.view', 'chat.open'];
    console.log('\n  --- 关键事件 ---');
    let pass = 0;
    for (const e of expected) {
      const found = (day.eventCounts as Record<string, number>)[e];
      if (found) pass++;
      console.log(`  ${found ? '✅' : '❌'} ${e.padEnd(20)} ${found || 0}次`);
    }
    console.log(`\n  结果: ${pass}/${expected.length} 通过`);
  } else {
    console.log('  ❌ 无数据:', JSON.stringify(summary));
  }

  console.log('═══════════════════════════════════════\n');
  await app.close();
  console.log('🏁 完成');
}

main().catch((err) => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
