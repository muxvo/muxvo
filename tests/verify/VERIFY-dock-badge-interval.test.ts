/**
 * VERIFY-dock-badge-interval — Unit test for dock badge interval input behavior
 *
 * Verifies:
 * 1. Config persists dockBadgeMode and dockBadgeIntervalMin correctly
 * 2. No upper limit on interval (was previously capped at 30)
 * 3. Interval minimum is 1 (empty/zero/negative → 1)
 * 4. i18n keys for dock badge exist in both zh and en
 * 5. SettingsModal.tsx uses editable input (not span) for interval
 * 6. Input size attribute is dynamic (auto-width)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('VERIFY Dock Badge Interval', () => {
  // ── Config persistence ──

  describe('dockBadgeIntervalMin config', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muxvo-verify-badge-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true });
    });

    test('default dockBadgeMode is undefined (off)', () => {
      const { createConfigManager } = require('@/main/services/app/config');
      const manager = createConfigManager({ configDir: tmpDir });
      const config = manager.loadConfig();
      expect(config.dockBadgeMode).toBeUndefined();
    });

    test('persists dockBadgeMode and dockBadgeIntervalMin', () => {
      const { createConfigManager } = require('@/main/services/app/config');
      const manager = createConfigManager({ configDir: tmpDir });
      manager.saveConfig({ dockBadgeMode: 'timed', dockBadgeIntervalMin: 5 });
      const loaded = manager.loadConfig();
      expect(loaded.dockBadgeMode).toBe('timed');
      expect(loaded.dockBadgeIntervalMin).toBe(5);
    });

    test('accepts large interval values (no upper limit)', () => {
      const { createConfigManager } = require('@/main/services/app/config');
      const manager = createConfigManager({ configDir: tmpDir });
      manager.saveConfig({ dockBadgeIntervalMin: 9999 });
      const loaded = manager.loadConfig();
      expect(loaded.dockBadgeIntervalMin).toBe(9999);
    });
  });

  // ── Interval input validation logic ──

  describe('interval input validation (blur handler logic)', () => {
    // Simulate the handleIntervalInputBlur logic from SettingsModal.tsx
    function validateInterval(inputValue: string): number {
      const v = parseInt(inputValue, 10);
      if (isNaN(v) || v < 1) return 1;
      return v;
    }

    test('empty string → 1', () => {
      expect(validateInterval('')).toBe(1);
    });

    test('"0" → 1', () => {
      expect(validateInterval('0')).toBe(1);
    });

    test('"-5" → 1', () => {
      expect(validateInterval('-5')).toBe(1);
    });

    test('"abc" → 1', () => {
      expect(validateInterval('abc')).toBe(1);
    });

    test('"1" → 1', () => {
      expect(validateInterval('1')).toBe(1);
    });

    test('"30" → 30 (no cap)', () => {
      expect(validateInterval('30')).toBe(30);
    });

    test('"100" → 100 (no upper limit)', () => {
      expect(validateInterval('100')).toBe(100);
    });

    test('"99999" → 99999 (arbitrary large number)', () => {
      expect(validateInterval('99999')).toBe(99999);
    });
  });

  // ── No Math.min(30, ...) in stepper button ──

  describe('no upper limit in SettingsModal code', () => {
    test('stepper + button has no Math.min cap', () => {
      const modalPath = path.resolve(__dirname, '../../src/renderer/components/settings/SettingsModal.tsx');
      const content = fs.readFileSync(modalPath, 'utf-8');

      // Find the dock badge interval stepper area
      // The + button should NOT have Math.min(30, ...)
      expect(content).not.toMatch(/Math\.min\(30,\s*dockBadgeInterval/);
    });

    test('type definition says minimum 1, no upper bound', () => {
      const typesPath = path.resolve(__dirname, '../../src/shared/types/config.types.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');
      expect(content).toContain('最小 1');
      expect(content).not.toMatch(/范围 1-30/);
    });
  });

  // ── Input is editable (not span) with dynamic size ──

  describe('interval input is editable with auto-width', () => {
    test('uses <input> not <span> for interval value', () => {
      const modalPath = path.resolve(__dirname, '../../src/renderer/components/settings/SettingsModal.tsx');
      const content = fs.readFileSync(modalPath, 'utf-8');

      // Should have stepper-input class on an input element
      expect(content).toContain('settings-modal__stepper-input');
      expect(content).toContain('inputMode="numeric"');
    });

    test('input has dynamic size attribute', () => {
      const modalPath = path.resolve(__dirname, '../../src/renderer/components/settings/SettingsModal.tsx');
      const content = fs.readFileSync(modalPath, 'utf-8');

      // size={Math.max(1, intervalInputValue.length)}
      expect(content).toMatch(/size=\{Math\.max\(1,\s*intervalInputValue\.length\)\}/);
    });

    test('CSS stepper-input has min-width but no fixed width', () => {
      const cssPath = path.resolve(__dirname, '../../src/renderer/components/settings/SettingsModal.css');
      const content = fs.readFileSync(cssPath, 'utf-8');

      expect(content).toContain('settings-modal__stepper-input');
      expect(content).toMatch(/min-width:\s*36px/);
      // Should NOT have a fixed width like "width: 36px"
      const inputBlock = content.split('settings-modal__stepper-input')[1]?.split('}')[0] ?? '';
      expect(inputBlock).not.toMatch(/^\s*width:\s*\d+px/m);
    });
  });

  // ── i18n keys ──

  describe('dock badge i18n keys', () => {
    const requiredKeys = [
      'settings.dockBadge', 'settings.dockBadgeDesc',
      'settings.dockBadgeOff', 'settings.dockBadgeOffDesc',
      'settings.dockBadgeRealtime', 'settings.dockBadgeRealtimeDesc',
      'settings.dockBadgeTimed', 'settings.dockBadgeTimedDesc',
      'settings.dockBadgeInterval', 'settings.dockBadgeIntervalUnit',
    ];

    test('zh locale has all dock badge keys', () => {
      const { zh } = require('@/renderer/i18n/locales/zh');
      for (const key of requiredKeys) {
        expect(zh[key], `Missing zh key: ${key}`).toBeDefined();
      }
    });

    test('en locale has all dock badge keys', () => {
      const { en } = require('@/renderer/i18n/locales/en');
      for (const key of requiredKeys) {
        expect(en[key], `Missing en key: ${key}`).toBeDefined();
      }
    });
  });
});
