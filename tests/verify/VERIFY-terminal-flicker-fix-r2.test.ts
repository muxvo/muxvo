/**
 * VERIFY-terminal-flicker-fix-r2 — Second round terminal flicker prevention
 *
 * Remaining flicker after round 1 caused by:
 * 1. usePanelContext() in TerminalTile bypasses React.memo (context changes trigger re-render)
 * 2. borderGlow animation conflicts with transition on same CSS properties
 * 3. perspective: 1200px on grid causes unnecessary 3D recalculation during mode switch
 * 4. TerminalSidebar conditional mount/unmount causes layout disruption on focus switch
 *
 * These are structural/architectural fixes — flicker is a temporal visual phenomenon
 * that cannot be directly asserted in E2E tests. We verify the fix mechanisms are in place.
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// 1. PanelContext dispatch separation (prevents React.memo bypass)
// ============================================================================
describe('PanelDispatchContext separation', () => {
  it('PanelContext exports usePanelDispatch hook', () => {
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/contexts/PanelContext.tsx'),
      'utf-8'
    );

    // Must export usePanelDispatch
    expect(code).toMatch(/export\s+function\s+usePanelDispatch/);
    // Must have separate PanelDispatchContext
    expect(code).toMatch(/PanelDispatchContext/);
    // Provider must wrap children with PanelDispatchContext.Provider
    expect(code).toMatch(/PanelDispatchContext\.Provider\s+value=\{dispatch\}/);
  });

  it('TerminalTile uses usePanelDispatch instead of usePanelContext', () => {
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/TerminalTile.tsx'),
      'utf-8'
    );

    // Must import usePanelDispatch
    expect(code).toMatch(/usePanelDispatch/);
    // Must NOT import or call usePanelContext (which subscribes to state)
    expect(code).not.toMatch(/usePanelContext/);
  });
});

// ============================================================================
// 2. borderGlow animation / transition conflict resolution
// ============================================================================
describe('borderGlow animation-transition conflict fix', () => {
  it('.tile--waiting overrides transition to exclude animated properties', () => {
    const fs = require('fs');
    const css = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/TileEffects.css'),
      'utf-8'
    );

    // .tile--waiting must have its own transition declaration
    // that excludes border-color and outline-color (managed by borderGlow animation)
    expect(css).toMatch(/\.tile--waiting\s*\{[^}]*transition:\s*[^;]*box-shadow/s);

    // Extract the actual CSS transition value (not from comments).
    // Strip comments first, then extract from .tile--waiting block.
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const waitingBlock = noComments.match(/\.tile--waiting\s*\{([^}]*)\}/s);
    expect(waitingBlock).not.toBeNull();
    const waitingTransition = waitingBlock![1].match(/transition:\s*([^;]*)/);
    expect(waitingTransition).not.toBeNull();
    // The transition value itself must not include border-color or outline-color
    expect(waitingTransition![1]).not.toMatch(/border-color/);
    expect(waitingTransition![1]).not.toMatch(/outline-color/);
  });
});

// ============================================================================
// 3. No perspective on grid container
// ============================================================================
describe('Grid container perspective removal', () => {
  it('TilingGrid gridStyle does not include perspective', () => {
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/TerminalGrid.tsx'),
      'utf-8'
    );

    // Find the gridStyle object and verify no perspective property
    const gridStyleMatch = code.match(/const\s+gridStyle[\s\S]*?=\s*\{([\s\S]*?)\};/);
    expect(gridStyleMatch).not.toBeNull();
    expect(gridStyleMatch![1]).not.toMatch(/perspective/);
  });
});

// ============================================================================
// 4. CSS-only sidebar — no separate TerminalSidebar in TerminalGrid
// ============================================================================
describe('CSS-only sidebar layout (no dual instances)', () => {
  it('TerminalGrid does not import or render TerminalSidebar', () => {
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/TerminalGrid.tsx'),
      'utf-8'
    );

    // TerminalSidebar should not be imported or used — sidebar is CSS-only now
    expect(code).not.toMatch(/import\s*\{[^}]*TerminalSidebar/);
    expect(code).not.toMatch(/<TerminalSidebar/);
  });

  it('Non-focused terminals are positioned via CSS absolute in right 25%', () => {
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/TerminalGrid.tsx'),
      'utf-8'
    );

    // Non-focused terminals use absolute positioning with width: '25%'
    expect(code).toMatch(/width:\s*'25%'/);
    // They are not hidden with width:0/height:0/opacity:0
    expect(code).not.toMatch(/width:\s*0,\s*\n?\s*height:\s*0/);
  });

  it('XTermRenderer no longer accepts suppressResize prop', () => {
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/XTermRenderer.tsx'),
      'utf-8'
    );

    // suppressResize should be completely removed
    expect(code).not.toMatch(/suppressResize/);
  });
});
