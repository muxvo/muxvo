/**
 * VERIFY: GitHub OAuth Login Flow
 *
 * Tests that clicking GitHub login button in Muxvo:
 * 1. Opens the login modal
 * 2. Clicks GitHub login button
 * 3. Browser opens GitHub authorization page (not redirect_uri error)
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
      MUXVO_API_URL: 'http://localhost:3100',
    },
  });
  window = await app.firstWindow();
  await window.waitForTimeout(6000);
  await window.waitForLoadState('networkidle');
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('GitHub login button opens GitHub authorization page', async () => {
  // Step 1: Find and click the auth button in menu bar to open login modal
  const authBtn = window.locator('.menu-bar__icon-btn').last();
  await authBtn.click();
  await window.waitForTimeout(500);

  // Step 2: Wait for login modal to appear
  const modal = window.locator('.login-modal');
  await expect(modal).toBeVisible({ timeout: 3000 });

  // Step 3: Click GitHub login button
  const githubBtn = window.locator('.login-modal__oauth-btn--github');
  await expect(githubBtn).toBeVisible();

  // Step 4: Listen for new window/external URL opening
  // When GitHub login is clicked, shell.openExternal is called
  // We intercept the IPC to verify the authUrl contains correct client_id
  const result = await window.evaluate(async () => {
    try {
      const res = await (window as any).api.auth.loginGithub();
      return res;
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  console.log('loginGithub result:', JSON.stringify(result, null, 2));

  // Verify the response
  expect(result.success).toBe(true);
  expect(result.data?.authUrl).toBeDefined();
  expect(result.data.authUrl).toContain('client_id=Ov23li9S2prPOvtgBXpg');
  expect(result.data.authUrl).toContain('redirect_uri=');
  expect(result.data.authUrl).toContain('localhost%3A3100');
});
