/**
 * useSkills — fetch real skill list from ~/.claude/skills/ with descriptions.
 * Uses existing IPC: config:get-resources + config:get-resource-content.
 * Subscribes to config:resource-change for real-time updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { trackError } from '@/renderer/hooks/useAnalytics';

export interface SkillItem {
  name: string;
  desc: string;
  path: string;
  source?: string;
  level?: 'system' | 'project';
  projectName?: string;
}

/**
 * Extract project directory name from a project-level skill path.
 * e.g. /Users/rl/.../douban/.codex/skills/test-skill → "douban"
 *      /Users/rl/.../fufuiyouhua/.claude/skills/test-skill → "fufuiyouhua"
 *      /Users/rl/.../douban/skills/test-skill → "douban"
 */
function extractProjectName(skillPath: string): string {
  // Match: .../<projectName>/.claude/skills/ or .../<projectName>/.codex/skills/
  const dotMatch = skillPath.match(/\/([^/]+)\/\.(?:claude|codex)\/skills\//);
  if (dotMatch) return dotMatch[1];
  // Match: .../<projectName>/skills/ (bare Codex layout)
  const bareMatch = skillPath.match(/\/([^/]+)\/skills\//);
  if (bareMatch) return bareMatch[1];
  return '';
}

interface UseSkillsResult {
  skills: SkillItem[];
  loading: boolean;
  error: string | null;
}

/**
 * Extract `description` from YAML frontmatter.
 * Handles: plain, quoted, and multiline block scalar (| / >).
 */
function parseFrontmatterDescription(content: string): string | null {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];

  // Try multiline block scalar: description: | or description: >
  const blockMatch = fm.match(/^description:\s*[|>]-?\s*\n([\s\S]*?)(?=\n\S|\s*$)/m);
  if (blockMatch) {
    return blockMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
      .trim() || null;
  }

  // Single-line: plain, double-quoted, or single-quoted
  const lineMatch = fm.match(/^description:\s*(?:"([^"]*)"|'([^']*)'|(.+))/m);
  if (!lineMatch) return null;

  const raw = lineMatch[1] ?? lineMatch[2] ?? lineMatch[3] ?? '';
  return raw.trim() || null;
}

export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortedRef = useRef(false);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { resources } = await window.api.config.getResources('skills');

      // Batch-read skill content in parallel
      // Supports both directory skills (path/SKILL.md) and standalone .md files (path itself)
      const settled = await Promise.allSettled(
        resources.map(async (r: { name: string; path: string; source?: string; level?: string }) => {
          if (r.path.endsWith('.md')) {
            // Standalone .md file skill
            const { content } = await window.api.config.getResourceContent(r.path);
            return { resource: r, content };
          }
          // Directory skill: read SKILL.md inside
          const { content } = await window.api.config.getResourceContent(r.path + '/SKILL.md');
          return { resource: r, content };
        }),
      );

      if (abortedRef.current) return;

      const items: SkillItem[] = settled.map((result, i) => {
        const resource = resources[i];
        const level = (resource.level as 'system' | 'project') || 'system';
        const projectName = level === 'project' ? extractProjectName(resource.path) : undefined;
        if (result.status === 'fulfilled') {
          const desc = parseFrontmatterDescription(result.value.content);
          return { name: resource.name, desc: desc || resource.name, path: resource.path, source: resource.source, level, projectName };
        }
        return { name: resource.name, desc: resource.name, path: resource.path, source: resource.source, level, projectName };
      });

      items.sort((a, b) => a.name.localeCompare(b.name));
      setSkills(items);
    } catch (err) {
      if (abortedRef.current) return;
      trackError('ipc', { channel: 'config:getResources', message: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : 'Failed to load skills');
      setSkills([]);
    } finally {
      if (!abortedRef.current) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    abortedRef.current = false;
    loadSkills();
    return () => {
      abortedRef.current = true;
    };
  }, [loadSkills]);

  // Real-time updates with 300ms debounce
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const unsub = window.api.config.onResourceChange((data: { type: string }) => {
      if (data.type !== 'skills') return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => loadSkills(), 300);
    });

    return () => {
      unsub();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [loadSkills]);

  return { skills, loading, error };
}
