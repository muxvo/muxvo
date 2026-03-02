/**
 * Terminal Addon Manager — manages xterm.js addon lifecycle
 * Phase 1: WebGL (with silent fallback) + Unicode11 + FitAddon
 * Phase 3: Image + Search addons
 *
 * WebGL context management:
 * - Global counter enforces MAX_WEBGL_CONTEXTS limit (Chromium ~16 cap)
 * - Context loss uses exponential backoff, permanent Canvas degradation after 3 losses
 * - Font readiness gate prevents TextureAtlas glyph mapping errors
 *
 * NOTE: Ligatures addon removed (2026-03-02) — caused intermittent 333% CPU usage.
 * The addon runs expensive OpenType font table analysis on every WebGL render pass,
 * especially during TextureAtlas rebuilds. Most monospace fonts (Menlo, SF Mono, Monaco)
 * don't support ligatures anyway.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ImageAddon } from '@xterm/addon-image';
import { SearchAddon } from '@xterm/addon-search';

// Global WebGL context counter — shared across all AddonManager instances
let activeWebglCount = 0;
const MAX_WEBGL_CONTEXTS = 4;

/** Exported for testing only */
export function _getActiveWebglCount(): number {
  return activeWebglCount;
}

export interface AddonSet {
  fit: FitAddon;
  webgl: WebglAddon | null;
  unicode11: Unicode11Addon;
  image: ImageAddon | null;
  search: SearchAddon;
}

export interface AddonManager {
  loadAll(): Promise<AddonSet>;
  disposeAll(): void;
  releaseWebgl(): void;
  getFitAddon(): FitAddon;
  getSearchAddon(): SearchAddon;
}

export function createAddonManager(term: Terminal): AddonManager {
  let fitAddon: FitAddon | null = null;
  let webglAddon: WebglAddon | null = null;
  let unicode11Addon: Unicode11Addon | null = null;
  let imageAddon: ImageAddon | null = null;
  let searchAddon: SearchAddon | null = null;
  let disposed = false;
  let contextLossCount = 0;

  function loadWebgl(): WebglAddon | null {
    if (activeWebglCount >= MAX_WEBGL_CONTEXTS) {
      console.warn(`[AddonManager] WebGL context limit reached (${activeWebglCount}/${MAX_WEBGL_CONTEXTS}), using Canvas renderer`);
      return null;
    }

    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        console.warn(`[GLYPH:webgl] ${Date.now()} CONTEXT_LOSS lossCount=${contextLossCount + 1} activeCount=${activeWebglCount}`);
        addon.dispose();
        webglAddon = null;
        activeWebglCount--;
        contextLossCount++;

        if (contextLossCount >= 3) {
          console.warn(`[GLYPH:webgl] ${Date.now()} DEGRADED_TO_CANVAS lossCount=${contextLossCount}`);
          return;
        }

        const delay = Math.min(1000 * Math.pow(2, contextLossCount - 1), 4000);
        setTimeout(() => {
          if (disposed) return;
          if (activeWebglCount < MAX_WEBGL_CONTEXTS) {
            console.log(`[GLYPH:webgl] ${Date.now()} RECOVERING delay=${delay}ms activeCount=${activeWebglCount}`);
            webglAddon = loadWebgl();
          }
        }, delay);
      });
      term.loadAddon(addon);
      activeWebglCount++;
      console.log(`[GLYPH:webgl] ${Date.now()} CREATED activeCount=${activeWebglCount}`);
      return addon;
    } catch (e) {
      console.warn('[AddonManager] WebGL addon failed to load, falling back to canvas renderer', e);
      return null;
    }
  }

  return {
    async loadAll(): Promise<AddonSet> {
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      unicode11Addon = new Unicode11Addon();
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = '11';

      // Wait for fonts to be ready before initializing WebGL
      // to prevent TextureAtlas glyph mapping errors
      await document.fonts.ready;

      if (disposed) {
        return {
          fit: fitAddon,
          webgl: null,
          unicode11: unicode11Addon!,
          image: null,
          search: searchAddon!,
        };
      }

      webglAddon = loadWebgl();

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
        image: imageAddon,
        search: searchAddon,
      };
    },

    disposeAll(): void {
      disposed = true;
      if (searchAddon) {
        try { searchAddon.dispose(); } catch { /* already disposed */ }
        searchAddon = null;
      }
      if (imageAddon) {
        try { imageAddon.dispose(); } catch { /* already disposed */ }
        imageAddon = null;
      }
      if (webglAddon) {
        try { webglAddon.dispose(); } catch { /* already disposed */ }
        webglAddon = null;
        activeWebglCount--;
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

    releaseWebgl(): void {
      if (webglAddon) {
        try { webglAddon.dispose(); } catch { /* already disposed */ }
        webglAddon = null;
        activeWebglCount--;
      }
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
