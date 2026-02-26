/**
 * Analytics 埋点烟雾测试
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
    console.log(`   ⚠️ ${label} — 未找到元素 (${selector})`);
    return false;
  }
}

async function main() {
  // 确保没有其他 Electron/Muxvo 实例
  try { execSync('pkill -9 -f Electron 2>/dev/null'); } catch {}
  await new Promise(r => setTimeout(r, 1500));

  console.log('🚀 启动 Muxvo (Playwright)...');
  const app: ElectronApplication = await _electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    timeout: 30000,
  });

  const win: Page = await app.firstWindow();
  await win.waitForTimeout(8000);
  await win.waitForLoadState('networkidle');
  console.log('✅ 窗口已加载');

  // 截图看看当前 UI 状态
  await win.screenshot({ path: '/tmp/muxvo-analytics-test.png' });
  console.log('   📸 截图保存到 /tmp/muxvo-analytics-test.png');

  // ── 操作 1: 创建终端 ──
  console.log('\n📌 操作: 创建终端...');
  // 底部栏的 + 按钮，或者用 text 匹配
  await click(win, '.bottom-bar button, button:has-text("+")', '创建终端');

  // ── 操作 2: Skills 面板 ──
  console.log('📌 操作: 切换面板...');
  await click(win, 'button:has-text("Skills")', 'Skills 面板');
  await click(win, 'button:has-text("MCP")', 'MCP 面板');
  await click(win, 'button:has-text("Hooks")', 'Hooks 面板');
  await click(win, 'button:has-text("Plugins")', 'Plugins 面板');

  // Chat 标签（可能是中文"对话历史"）
  await click(win, 'button.menu-bar__tab:nth-child(6)', 'Chat 面板');

  // 回到 Terminals
  await click(win, 'button.menu-bar__tab:nth-child(1)', '回到 Terminals');

  // ── 操作 3: 设置 ──
  console.log('📌 操作: 打开设置...');
  await click(win, '.menu-bar__icon-btn', '打开设置');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // ── 查询 analytics 数据 ──
  console.log('\n📊 查询 analytics 数据...');
  const today = new Date().toISOString().slice(0, 10);
  const summary = await win.evaluate(async (date: string) => {
    return await (window as any).api.analytics.getSummary(date, date);
  }, today);

  console.log('\n═══════════════════════════════════════');
  console.log('  📊 Analytics 埋点验证结果');
  console.log('═══════════════════════════════════════');

  if (summary?.success && summary.data?.length > 0) {
    const day = summary.data[0];
    console.log(`  日期: ${day.date}`);
    console.log(`  事件总数: ${day.totalEvents}`);
    console.log('');
    console.log('  事件明细:');
    const entries = Object.entries(day.eventCounts as Record<string, number>)
      .sort(([, a], [, b]) => (b as number) - (a as number));
    for (const [event, count] of entries) {
      console.log(`    ✅ ${event}: ${count}次`);
    }

    // 检查关键事件
    const expected = ['session.start', 'terminal.create', 'screen.view', 'chat.open'];
    console.log('\n  关键事件检查:');
    let pass = 0;
    for (const e of expected) {
      const found = (day.eventCounts as Record<string, number>)[e];
      const ok = !!found;
      if (ok) pass++;
      console.log(`    ${ok ? '✅' : '❌'} ${e}: ${found || 0}次`);
    }
    console.log(`\n  通过: ${pass}/${expected.length}`);
  } else {
    console.log('  ❌ 未获取到数据:', JSON.stringify(summary));
  }

  console.log('═══════════════════════════════════════\n');

  await app.close();
  console.log('🏁 测试完成');
}

main().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
