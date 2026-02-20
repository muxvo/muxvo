/**
 * MenuDropdown — MCP dropdown panel
 * Shown below the MenuBar when MCP tab is active.
 * Skills now uses a full-page SkillsPanel instead.
 */

import { useRef, useEffect } from 'react';
import { useFocusTrap } from '@/renderer/hooks/useFocusTrap';
import './MenuDropdown.css';

// ── Demo data (MCP — will be replaced with real data later) ──

const MCP_DEMO = [
  { name: 'filesystem', desc: 'Local file system access with sandboxing', type: 'stdio' as const, detail: 'npx @anthropic/mcp-fs' },
  { name: 'github', desc: 'GitHub API integration for repos and PRs', type: 'stdio' as const, detail: 'npx @anthropic/mcp-github' },
  { name: 'web-search', desc: 'Web search via Brave Search API', type: 'http' as const, detail: 'https://mcp.brave.com/v1' },
];

// ── Component ──

interface MenuDropdownProps {
  type: 'mcp';
  onClose: () => void;
}

export function MenuDropdown({ onClose }: MenuDropdownProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, true, onClose);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !target.closest('.menu-bar')
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div className="menu-dropdown" ref={containerRef} role="menu">
      <div className="menu-dropdown__header">
        MCP Servers
        <span className="menu-dropdown__count">{MCP_DEMO.length}</span>
      </div>
      <div className="menu-dropdown__content">
        {MCP_DEMO.map((m) => (
          <div className="menu-dropdown__item" key={m.name} role="menuitem" tabIndex={0}>
            <div className="menu-dropdown__item-icon menu-dropdown__item-icon--mcp">🔌</div>
            <div className="menu-dropdown__item-body">
              <div className="menu-dropdown__item-name">{m.name}</div>
              <div className="menu-dropdown__item-desc">{m.desc}</div>
              <div className="menu-dropdown__item-meta">{m.detail}</div>
            </div>
            <div className={`menu-dropdown__item-status menu-dropdown__item-status--${m.type}`}>
              {m.type.toUpperCase()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
