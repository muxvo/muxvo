/**
 * VERIFY: 官网首页真实产品截图展示
 *
 * 验证目标：
 * 1. Hero 区包含真实产品截图（不是 CSS 模拟终端）
 * 2. 4 个 Feature Showcase 区段各含截图 + 标题
 * 3. 所有截图能正常加载（naturalWidth > 0）
 * 4. 交替布局正确（奇数行反转）
 */
import { test, expect, chromium } from '@playwright/test';

const WEB_URL = 'http://localhost:5180';

test.describe('官网截图展示验证', () => {
  test('Hero 区包含真实产品截图', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    try {
      await page.goto(WEB_URL, { waitUntil: 'networkidle' });

      // Hero 截图容器存在
      const heroMock = page.locator('.mv-mock__screenshot');
      await expect(heroMock).toBeVisible();

      // Hero 截图 img 存在且 src 包含 dark-terminals
      const heroImg = heroMock.locator('img');
      await expect(heroImg).toBeVisible();
      const heroSrc = await heroImg.getAttribute('src');
      expect(heroSrc).toContain('dark-terminals');

      // 截图实际加载成功（naturalWidth > 0）
      const heroNatWidth = await heroImg.evaluate(
        (el: HTMLImageElement) => el.naturalWidth,
      );
      expect(heroNatWidth).toBeGreaterThan(0);

      // 不应存在旧的 CSS mock 终端内容（.mv-mock__body）
      const mockBody = page.locator('.mv-mock__body');
      await expect(mockBody).toHaveCount(0);
    } finally {
      await browser.close();
    }
  });

  test('6 个 Feature Showcase 区段各含截图和标题', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    try {
      await page.goto(WEB_URL, { waitUntil: 'networkidle' });

      // 6 个 showcase 区段
      const showcases = page.locator('.mv-showcase');
      await expect(showcases).toHaveCount(6);

      // 每个区段都有图片和标题
      const expectedScreenshots = [
        'dark-resume-chat',
        'dark-4terminals',
        'dark-focused',
        'dark-file-view',
        'dark-skills',
        'dark-multi-tool',
      ];
      const expectedTitles = [
        '永久存档，找到就续聊',
        '一屏排开，告别切窗口',
        '聚焦模式，沉浸对话',
        '文件按钮，看完就改',
        '自动扫描，Skill 和 MCP 一目了然',
        '统一入口，Codex 和 Gemini CLI 也能管',
      ];

      for (let i = 0; i < 6; i++) {
        const showcase = showcases.nth(i);

        // 标题文字
        const title = showcase.locator('.mv-showcase__title');
        await expect(title).toHaveText(expectedTitles[i]);

        // 截图 img
        const img = showcase.locator('.mv-showcase__image img');
        await expect(img).toBeVisible();
        const src = await img.getAttribute('src');
        expect(src).toContain(expectedScreenshots[i]);

        // 截图加载成功
        const natWidth = await img.evaluate(
          (el: HTMLImageElement) => el.naturalWidth,
        );
        expect(natWidth).toBeGreaterThan(0);
      }
    } finally {
      await browser.close();
    }
  });

  test('交替布局：奇数索引区段有 reverse 类', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    try {
      await page.goto(WEB_URL, { waitUntil: 'networkidle' });

      const showcases = page.locator('.mv-showcase');

      // 索引 0, 2, 4 不含 reverse
      for (const idx of [0, 2, 4]) {
        const cls = await showcases.nth(idx).getAttribute('class');
        expect(cls).not.toContain('mv-showcase--reverse');
      }

      // 索引 1, 3, 5 含 reverse
      for (const idx of [1, 3, 5]) {
        const cls = await showcases.nth(idx).getAttribute('class');
        expect(cls).toContain('mv-showcase--reverse');
      }
    } finally {
      await browser.close();
    }
  });

  test('Section 标题存在', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    try {
      await page.goto(WEB_URL, { waitUntil: 'networkidle' });

      // eyebrow 标签
      const eyebrow = page.locator('.mv-showcase-section__eyebrow');
      await expect(eyebrow).toHaveText('核心功能');

      // section 标题
      const sectionTitle = page.locator('.mv-showcase-section__title');
      await expect(sectionTitle).toHaveText('省下来的时间，都是你的');
    } finally {
      await browser.close();
    }
  });
});
