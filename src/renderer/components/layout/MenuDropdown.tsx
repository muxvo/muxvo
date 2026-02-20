/**
 * MenuDropdown — Skills / MCP dropdown panel
 * Shown below the MenuBar when Skills or MCP tab is active.
 */

import { useRef, useEffect } from 'react';
import { useFocusTrap } from '@/renderer/hooks/useFocusTrap';
import { useSkills } from '@/renderer/hooks/useSkills';
import './MenuDropdown.css';

// ── Demo data (MCP — will be replaced with real data later) ──

const MCP_DEMO = [
  { name: 'filesystem', desc: 'Local file system access with sandboxing', type: 'stdio' as const, detail: 'npx @anthropic/mcp-fs' },
  { name: 'github', desc: 'GitHub API integration for repos and PRs', type: 'stdio' as const, detail: 'npx @anthropic/mcp-github' },
  { name: 'web-search', desc: 'Web search via Brave Search API', type: 'http' as const, detail: 'https://mcp.brave.com/v1' },
];

// ── Component ──

interface MenuDropdownProps {
  type: 'skills' | 'mcp';
  onClose: () => void;
}

export function MenuDropdown({ type, onClose }: MenuDropdownProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { skills, loading, error } = useSkills();

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

  const isSkills = type === 'skills';
  const title = isSkills ? 'Skills' : 'MCP Servers';
  const count = isSkills ? (loading && skills.length === 0 ? '...' : skills.length) : MCP_DEMO.length;

  return (
    <div className="menu-dropdown" ref={containerRef} role="menu">
      <div className="menu-dropdown__header">
        {title}
        <span className="menu-dropdown__count">{count}</span>
      </div>
      <div className="menu-dropdown__content">
        {isSkills
          ? loading && skills.length === 0
            ? (
              <div className="menu-dropdown__status">
                <div className="menu-dropdown__spinner" />
                <span>Loading skills...</span>
              </div>
            )
            : error
            ? (
              <div className="menu-dropdown__status menu-dropdown__status--error">
                <span>Failed to load skills</span>
                <span className="menu-dropdown__status-hint">{error}</span>
              </div>
            )
            : skills.length === 0
            ? (
              <div className="menu-dropdown__status">
                <span>No skills found</span>
                <span className="menu-dropdown__status-hint">~/.claude/skills/</span>
              </div>
            )
            : skills.map((s) => (
              <div className="menu-dropdown__item" key={s.name} role="menuitem" tabIndex={0}>
                <div className="menu-dropdown__item-icon menu-dropdown__item-icon--skill">⚡</div>
                <div className="menu-dropdown__item-body">
                  <div className="menu-dropdown__item-name">{s.name}</div>
                  <div className="menu-dropdown__item-desc">{s.desc}</div>
                  <div className="menu-dropdown__item-meta">{s.path}</div>
                </div>
              </div>
            ))
          : MCP_DEMO.map((m) => (
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
