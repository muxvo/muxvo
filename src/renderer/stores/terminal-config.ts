/**
 * Terminal configuration store
 * Manages terminal theme, font, and cursor settings with persistence via app config
 */

import type { TerminalConfig } from '@/shared/types/config.types';
import { TERMINAL_FONT_FAMILY } from '@/shared/constants/fonts';

const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  themeName: 'dark',
  fontFamily: TERMINAL_FONT_FAMILY,
  fontSize: 14,
  cursorStyle: 'block',
  cursorBlink: true,
};

type Listener = (config: TerminalConfig) => void;

export function createTerminalConfigStore() {
  let config: TerminalConfig = { ...DEFAULT_TERMINAL_CONFIG };
  const listeners = new Set<Listener>();

  async function load(): Promise<TerminalConfig> {
    const result = await window.api.app.getConfig();
    if (result?.data?.terminal) {
      config = { ...DEFAULT_TERMINAL_CONFIG, ...result.data.terminal };
    }
    notify();
    return config;
  }

  async function update(partial: Partial<TerminalConfig>): Promise<void> {
    config = { ...config, ...partial };
    const fullConfig = await window.api.app.getConfig();
    await window.api.app.saveConfig({ ...fullConfig.data, terminal: config });
    notify();
  }

  function getConfig(): TerminalConfig { return config; }

  function subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(): void {
    for (const fn of listeners) fn(config);
  }

  return { load, update, getConfig, subscribe };
}

export type TerminalConfigStore = ReturnType<typeof createTerminalConfigStore>;
export { DEFAULT_TERMINAL_CONFIG };
