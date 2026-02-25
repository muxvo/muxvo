/**
 * E2E verification: Skill search keyword highlighting
 *
 * Strategy:
 * 1. Start vite renderer dev server on port 5173
 * 2. Launch Electron via _electron.launch() with ELECTRON_RENDERER_URL
 * 3. Navigate to Skills panel and test keyword highlighting
 */
import { _electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, '../..');

// Start vite dev server for renderer only
function startViteRenderer() {
  return new Promise((resolveP, reject) => {
    const proc = spawn('npx', ['electron-vite', 'dev', '--no-sandbox'], {
      cwd: PROJECT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: true,
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Even if we don't see the ready message, try after timeout
        resolveP(proc);
      }
    }, 15000);

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      process.stdout.write(`[vite] ${line}`);
      // electron-vite dev prints the URL when ready
      if ((line.includes('localhost') || line.includes('ready') || line.includes('5173')) && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Wait a bit for electron to fully start
        setTimeout(() => resolveP(proc), 3000);
      }
    });

    proc.stderr.on('data', (data) => {
      process.stderr.write(`[vite:err] ${data.toString()}`);
    });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

async function main() {
  console.log('Starting electron-vite dev...');
  const viteProc = await startViteRenderer();
  console.log('electron-vite dev started, connecting via CDP...');

  try {
    // electron-vite dev starts Electron with --remote-debugging-port
    // Try connecting via CDP to the Electron renderer
    const { chromium } = await import('@playwright/test');

    // Wait a moment for Electron window to load
    await new Promise(r => setTimeout(r, 5000));

    // electron-vite dev typically enables remote debugging on port 9222
    // But we should look for the actual Electron window
    // Let's try connecting directly to the dev server as a web page first
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Connect to the vite dev server renderer
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: '/tmp/verify-01-initial.png' });
    console.log('Screenshot 1: Initial state');

    const bodyLen = (await page.locator('body').innerHTML()).length;
    console.log(`Body length: ${bodyLen}`);

    if (bodyLen < 10) {
      console.log('Page is empty, waiting more...');
      await page.waitForTimeout(5000);
      await page.screenshot({ path: '/tmp/verify-01b-retry.png' });
    }

    // Check for skill list - it's an overlay panel opened from sidebar
    // First let's see what's rendered
    const skillListVisible = await page.locator('.skill-list').isVisible().catch(() => false);
    console.log(`Skill list initially visible: ${skillListVisible}`);

    // Skills panel is an overlay - need to find and click the trigger
    // Look for sidebar icons/buttons
    const allClickable = await page.locator('button, a, [role="button"], [class*="icon"], [class*="btn"]').all();
    console.log(`Clickable elements: ${allClickable.length}`);
    for (const el of allClickable.slice(0, 20)) {
      const text = (await el.textContent().catch(() => ''))?.trim();
      const cls = await el.getAttribute('class').catch(() => '');
      const title = await el.getAttribute('title').catch(() => '');
      if (text || title) console.log(`  "${text?.slice(0,30)}" class="${cls}" title="${title}"`);
    }

    // Try to find and click skills button/icon
    let skillsOpened = false;

    // Try title attribute
    const skillBtn = page.locator('[title*="skill" i], [title*="Skill"]');
    if (await skillBtn.count() > 0) {
      await skillBtn.first().click();
      await page.waitForTimeout(1000);
      skillsOpened = true;
      console.log('Clicked skill button via title');
    }

    // Try aria-label
    if (!skillsOpened) {
      const ariaBtn = page.locator('[aria-label*="skill" i]');
      if (await ariaBtn.count() > 0) {
        await ariaBtn.first().click();
        await page.waitForTimeout(1000);
        skillsOpened = true;
        console.log('Clicked skill button via aria-label');
      }
    }

    // Try SVG icon buttons in sidebar
    if (!skillsOpened) {
      const svgBtns = await page.locator('.sidebar button, .sidebar [class*="icon"]').all();
      console.log(`Sidebar SVG buttons: ${svgBtns.length}`);
    }

    await page.screenshot({ path: '/tmp/verify-02-nav.png' });
    console.log('Screenshot 2: After navigation attempt');

    // Check skill list again
    const skillList = page.locator('.skill-list');
    if (await skillList.isVisible().catch(() => false)) {
      await runHighlightTest(page, skillList);
    } else {
      // Dump full page classes for debugging
      const html = await page.content();
      const classes = [...new Set((html.match(/class="([^"]+)"/g) || []).map(c => c.slice(7, -1)))];
      console.log('Unique classes (first 30):');
      classes.slice(0, 30).forEach(c => console.log(`  ${c}`));
      console.log('GREEN FAIL: Could not open skills panel');
      process.exitCode = 1;
    }

    await page.screenshot({ path: '/tmp/verify-04-final.png' });
    await browser.close();
  } finally {
    // Kill the vite process
    viteProc.kill('SIGTERM');
    // Also kill any electron processes it spawned
    try {
      const { execSync } = await import('child_process');
      execSync('pkill -f "electron-vite" 2>/dev/null; pkill -f "electron ." 2>/dev/null', { stdio: 'ignore' });
    } catch {}
  }
  console.log('Done');
}

async function runHighlightTest(page, skillList) {
  const searchInput = skillList.locator('.search-input-wrap__input');
  if (!(await searchInput.isVisible().catch(() => false))) {
    console.log('GREEN FAIL: Search input not found');
    process.exitCode = 1;
    return;
  }

  await searchInput.fill('auto');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/verify-03-search.png' });
  console.log('Screenshot 3: After search "auto"');

  const marks = skillList.locator('mark.search-highlight');
  const markCount = await marks.count();
  console.log(`Found ${markCount} <mark class="search-highlight"> elements`);

  if (markCount > 0) {
    const firstText = await marks.first().textContent();
    console.log(`First mark text: "${firstText}"`);
    console.log('GREEN PASS: Keyword highlighting works in SkillList');
  } else {
    console.log('GREEN FAIL: No highlighted marks found');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
