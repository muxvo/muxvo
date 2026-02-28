/**
 * VERIFY: Login buttons are clickable and show terms confirmation dialog
 *
 * Tests that:
 * 1. Login buttons are NOT disabled when modal opens
 * 2. Clicking a button shows the terms confirmation overlay
 * 3. Clicking "Cancel" dismisses the overlay
 * 4. Clicking "Agree & Continue" dismisses overlay and executes the action
 *
 * Prerequisite: vite renderer server on port 5173
 *   npx vite --config tests/e2e/vite-renderer.config.ts
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');

let app: ElectronApplication;
let window: Page;

test.setTimeout(60000);

test.beforeAll(async () => {
  app = await _electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    },
  });
  window = await app.firstWindow();
  await window.waitForTimeout(8000);
  await window.waitForLoadState('networkidle');

  // If user is already logged in, logout first so we can test the login modal
  const isLoggedIn = await window.evaluate(() => {
    const avatar = document.querySelector('.user-dropdown__avatar');
    return !!avatar;
  });
  if (isLoggedIn) {
    // Click user dropdown to open it
    const trigger = window.locator('.user-dropdown__trigger');
    await trigger.click();
    await window.waitForTimeout(300);
    // Click logout button
    const logoutBtn = window.locator('.user-dropdown__item--danger, button:has-text("登出"), button:has-text("Logout")');
    if (await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await logoutBtn.click();
      await window.waitForTimeout(1000);
    } else {
      // Fallback: logout via API
      await window.evaluate(async () => {
        await (window as any).api.auth.logout();
      });
      await window.waitForTimeout(1000);
    }
  }
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('login buttons are clickable and terms guard works', async () => {
  // Step 1: Open login modal
  // After logout, the auth button should be visible
  const authBtn = window.locator('button[title="登录"], button[title="Login"]');
  const authBtnVisible = await authBtn.isVisible({ timeout: 3000 }).catch(() => false);

  if (authBtnVisible) {
    await authBtn.click();
    await window.waitForTimeout(500);
  } else {
    // Fallback: open modal via IPC dispatch
    await window.evaluate(() => {
      // Find React root and dispatch OPEN_LOGIN_MODAL
      const event = new CustomEvent('open-login-modal');
      globalThis.dispatchEvent(event);
    });
    // If custom event doesn't work, try clicking the user icon area
    const iconBtn = window.locator('.menu-bar__icon-btn').first();
    if (await iconBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await iconBtn.click();
      await window.waitForTimeout(500);
    }
  }

  const modal = window.locator('.login-modal');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Step 2: All three OAuth buttons should NOT be disabled
  const githubBtn = window.locator('.login-modal__oauth-btn--github');
  const googleBtn = window.locator('.login-modal__oauth-btn--google');
  const emailBtn = window.locator('.login-modal__oauth-btn--email');

  await expect(githubBtn).toBeVisible();
  await expect(googleBtn).toBeVisible();
  await expect(emailBtn).toBeVisible();

  await expect(githubBtn).toBeEnabled();
  await expect(googleBtn).toBeEnabled();
  await expect(emailBtn).toBeEnabled();

  // Step 3: Click email button - should show terms confirmation (not navigate directly)
  await emailBtn.click();
  await window.waitForTimeout(300);

  const termsConfirm = window.locator('.login-modal__terms-confirm');
  await expect(termsConfirm).toBeVisible({ timeout: 3000 });

  // Step 4: Click Cancel - overlay should disappear, still on buttons page
  const cancelBtn = window.locator('.login-modal__terms-confirm-cancel');
  await cancelBtn.click();
  await window.waitForTimeout(300);

  await expect(termsConfirm).not.toBeVisible();
  // Still on buttons page - email button still visible
  await expect(emailBtn).toBeVisible();

  // Step 5: Click email again, this time click "Agree & Continue"
  await emailBtn.click();
  await window.waitForTimeout(300);
  await expect(termsConfirm).toBeVisible({ timeout: 3000 });

  const agreeBtn = window.locator('.login-modal__terms-confirm-agree');
  await agreeBtn.click();
  await window.waitForTimeout(500);

  // Step 6: Should have navigated to login form (email mode)
  const loginForm = window.locator('.login-modal__email-form');
  await expect(loginForm).toBeVisible({ timeout: 3000 });
  await expect(termsConfirm).not.toBeVisible();
});
