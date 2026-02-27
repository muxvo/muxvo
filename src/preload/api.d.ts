/**
 * Type declaration for window.api exposed by preload script
 */

import type { MuxvoAPI } from './index';

declare global {
  interface Window {
    api: MuxvoAPI;
  }

  /** App version injected by Vite define */
  const __APP_VERSION__: string;
}
