/**
 * Mermaid initialization and rendering utility.
 *
 * - Initializes mermaid with startOnLoad: false (we control rendering manually)
 * - Adapts mermaid theme to the current UI theme (light/dark)
 * - Listens for theme changes to re-initialize
 */

import mermaid from 'mermaid';

function currentMermaidTheme(): 'default' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
}

let initialized = false;

function initMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: currentMermaidTheme(),
    securityLevel: 'loose',
  });
  initialized = true;
}

// Re-initialize on theme change
if (typeof window !== 'undefined') {
  window.addEventListener('muxvo:theme-change', () => {
    initMermaid();
  });
}

/**
 * Render a mermaid diagram to SVG string.
 * Returns the SVG markup or null on failure.
 */
export async function renderMermaid(id: string, code: string): Promise<string | null> {
  if (!initialized) initMermaid();
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch {
    return null;
  }
}

/**
 * Run mermaid on all `.mermaid` elements within a container.
 * Used by MarkdownPreview after dangerouslySetInnerHTML.
 */
export async function runMermaidInContainer(container: HTMLElement): Promise<void> {
  if (!initialized) initMermaid();
  const nodes = container.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])');
  if (nodes.length === 0) return;
  try {
    await mermaid.run({ nodes });
  } catch {
    // Silently ignore render errors for individual diagrams
  }
}
