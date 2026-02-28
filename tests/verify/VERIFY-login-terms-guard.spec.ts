/**
 * VERIFY: Login buttons are clickable and show terms confirmation dialog
 *
 * Tests that:
 * 1. Login buttons are NOT disabled when modal opens
 * 2. Clicking a button shows the terms confirmation overlay
 * 3. Clicking "Cancel" dismisses the overlay
 * 4. Clicking "Agree & Continue" dismisses overlay and executes the action
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');

let app: ElectronApplication;
let window: Page;

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
  await window.waitForTimeout(6000);
  await window.waitForLoadState('networkidle');
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('login buttons are clickable and terms guard works', async () => {
  // Step 1: Open login modal via auth button in menu bar
  const authBtn = window.locator('.menu-bar__icon-btn').last();
  await authBtn.click();
  await window.waitForTimeout(500);

  const modal = window.locator('.login-modal');
  await expect(modal).toBeVisible({ timeout: 3000 });

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
  await expect(termsConfirm).toBeVisible({ timeout: 2000 });

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
  await expect(termsConfirm).toBeVisible({ timeout: 2000 });

  const agreeBtn = window.locator('.login-modal__terms-confirm-agree');
  await agreeBtn.click();
  await window.waitForTimeout(500);

  // Step 6: Should have navigated to login form (email mode)
  // The email button switches to login mode, so we should see the password form
  const loginForm = window.locator('.login-modal__email-form');
  await expect(loginForm).toBeVisible({ timeout: 2000 });
  // And terms confirm should be gone
  await expect(termsConfirm).not.toBeVisible();
});
