/**
 * Type declaration for window.api exposed by preload script
 */

import type { MuxvoAPI } from './index';

declare global {
  interface Window {
    api: MuxvoAPI;
  }
}
