/**
 * MenuDropdown — Skills / MCP dropdown panel
 * Shown below the MenuBar when Skills or MCP tab is active.
 */

import { useRef, useEffect } from 'react';
import { useFocusTrap } from '@/renderer/hooks/useFocusTrap';
import './MenuDropdown.css';

// ── Demo data (will be replaced with IPC config:get-resources later) ──

const SKILLS_DEMO = [
  { name: 'commit', desc: 'Generate conventional commit messages from staged changes' },
  { name: 'review-pr', desc: 'Analyze PR diff and provide structured code review' },
  { name: 'refactor', desc: 'Identify and apply safe refactoring patterns' },
  { name: 'test-gen', desc: 'Generate unit tests for selected functions' },
];

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
  const items = isSkills ? SKILLS_DEMO : MCP_DEMO;
  const title = isSkills ? 'Skills' : 'MCP Servers';

  return (
    <div className="menu-dropdown" ref={containerRef} role="menu">
      <div className="menu-dropdown__header">
        {title}
        <span className="menu-dropdown__count">{items.length}</span>
      </div>
      <div className="menu-dropdown__content">
        {isSkills
          ? SKILLS_DEMO.map((s) => (
              <div className="menu-dropdown__item" key={s.name} role="menuitem" tabIndex={0}>
                <div className="menu-dropdown__item-icon menu-dropdown__item-icon--skill">⚡</div>
                <div className="menu-dropdown__item-body">
                  <div className="menu-dropdown__item-name">{s.name}</div>
                  <div className="menu-dropdown__item-desc">{s.desc}</div>
                  <div className="menu-dropdown__item-meta">~/.claude/skills/{s.name}/</div>
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
