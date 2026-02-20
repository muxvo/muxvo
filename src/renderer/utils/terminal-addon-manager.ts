/**
 * Terminal Addon Manager — manages xterm.js addon lifecycle
 * Phase 1: WebGL (with silent fallback) + Unicode11 + FitAddon
 * Phase 3: Ligatures (dynamic import) + Image + Search addons
 */

import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ImageAddon } from '@xterm/addon-image';
import { SearchAddon } from '@xterm/addon-search';

export interface AddonSet {
  fit: FitAddon;
  webgl: WebglAddon | null;
  unicode11: Unicode11Addon;
  ligatures: IDisposable | null;
  image: ImageAddon | null;
  search: SearchAddon;
}

export interface AddonManager {
  loadAll(): AddonSet;
  disposeAll(): void;
  recoverWebgl(): void;
  getFitAddon(): FitAddon;
  getSearchAddon(): SearchAddon;
}

export function createAddonManager(term: Terminal): AddonManager {
  let fitAddon: FitAddon | null = null;
  let webglAddon: WebglAddon | null = null;
  let unicode11Addon: Unicode11Addon | null = null;
  let ligaturesAddon: IDisposable | null = null;
  let imageAddon: ImageAddon | null = null;
  let searchAddon: SearchAddon | null = null;

  function loadWebgl(): WebglAddon | null {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        console.warn('[AddonManager] WebGL context lost, disposing WebGL addon');
        addon.dispose();
        webglAddon = null;
      });
      term.loadAddon(addon);
      return addon;
    } catch (e) {
      console.warn('[AddonManager] WebGL addon failed to load, falling back to canvas renderer', e);
      return null;
    }
  }

  return {
    loadAll(): AddonSet {
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      unicode11Addon = new Unicode11Addon();
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = '11';

      webglAddon = loadWebgl();

      // Ligatures addon (optional, loaded via dynamic import to avoid bundling issues)
      // Use direct .mjs path because the package's "main" field points to a missing .js file
      // @ts-expect-error -- .mjs has no declaration file
      import('@xterm/addon-ligatures/lib/addon-ligatures.mjs').then(({ LigaturesAddon }: { LigaturesAddon: new () => IDisposable }) => {
        try {
          const addon = new LigaturesAddon();
          term.loadAddon(addon);
          ligaturesAddon = addon;
        } catch (e) {
          console.warn('[AddonManager] Ligatures addon failed to load', e);
        }
      }).catch((e) => {
        console.warn('[AddonManager] Ligatures addon not available', e);
      });

      // Image addon (optional, sixel support)
      try {
        imageAddon = new ImageAddon({ sixelSupport: true });
        term.loadAddon(imageAddon);
      } catch (e) {
        console.warn('[AddonManager] Image addon failed to load', e);
        imageAddon = null;
      }

      // Search addon (lightweight, always loaded)
      searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);

      return {
        fit: fitAddon,
        webgl: webglAddon,
        unicode11: unicode11Addon,
        ligatures: ligaturesAddon,
        image: imageAddon,
        search: searchAddon,
      };
    },

    disposeAll(): void {
      if (searchAddon) {
        try { searchAddon.dispose(); } catch { /* already disposed */ }
        searchAddon = null;
      }
      if (imageAddon) {
        try { imageAddon.dispose(); } catch { /* already disposed */ }
        imageAddon = null;
      }
      if (ligaturesAddon) {
        try { ligaturesAddon.dispose(); } catch { /* already disposed */ }
        ligaturesAddon = null;
      }
      if (webglAddon) {
        try { webglAddon.dispose(); } catch { /* already disposed */ }
        webglAddon = null;
      }
      if (unicode11Addon) {
        try { unicode11Addon.dispose(); } catch { /* already disposed */ }
        unicode11Addon = null;
      }
      if (fitAddon) {
        try { fitAddon.dispose(); } catch { /* already disposed */ }
        fitAddon = null;
      }
    },

    recoverWebgl(): void {
      if (webglAddon) {
        try { webglAddon.dispose(); } catch { /* already disposed */ }
      }
      webglAddon = loadWebgl();
    },

    getFitAddon(): FitAddon {
      if (!fitAddon) {
        throw new Error('[AddonManager] FitAddon not loaded. Call loadAll() first.');
      }
      return fitAddon;
    },

    getSearchAddon(): SearchAddon {
      if (!searchAddon) {
        throw new Error('[AddonManager] SearchAddon not loaded. Call loadAll() first.');
      }
      return searchAddon;
    },
  };
}
