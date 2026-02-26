import { useState, useMemo, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  API config                                                         */
/* ------------------------------------------------------------------ */
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.muxvo.com';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type Category = 'Coding' | 'DevOps' | 'Writing' | 'Research' | 'Automation' | 'Other';

interface Skill {
  id: string;
  name: string;
  description: string;
  author: string;
  category: Category;
  installs: number;
  score: number;
}

/* ------------------------------------------------------------------ */
/*  Static fallback data                                               */
/* ------------------------------------------------------------------ */
const FALLBACK_SKILLS: Skill[] = [
  { id: '1',  name: 'Code Review Pro',      description: 'Automated code review with style, security, and performance checks. Provides actionable suggestions inline.',                author: 'muxvo-team',   category: 'Coding',     installs: 2450, score: 9.2 },
  { id: '2',  name: 'Test Generator',        description: 'Generate comprehensive unit tests from source code. Supports Jest, Vitest, and pytest.',                                    author: 'testcraft',    category: 'Coding',     installs: 1830, score: 8.7 },
  { id: '3',  name: 'Architecture Advisor',  description: 'Analyze codebase and suggest architectural improvements. Detects anti-patterns and proposes refactoring strategies.',        author: 'archwise',     category: 'Coding',     installs: 3210, score: 9.0 },
  { id: '4',  name: 'Docker Compose Gen',    description: 'Generate Docker Compose configurations from project structure. Multi-stage builds with best practices.',                    author: 'devops-kit',   category: 'DevOps',     installs: 1120, score: 8.5 },
  { id: '5',  name: 'CI Pipeline Builder',   description: 'Create GitHub Actions workflows from project requirements. Supports build, test, deploy, and release automation.',          author: 'ciforge',      category: 'DevOps',     installs: 970,  score: 8.3 },
  { id: '6',  name: 'API Doc Writer',        description: 'Generate OpenAPI specs and markdown documentation from code. Includes request/response examples.',                          author: 'docsmith',     category: 'Writing',    installs: 1640, score: 8.9 },
  { id: '7',  name: 'Commit Message Craft',  description: 'Craft semantic commit messages from staged diffs. Follows Conventional Commits and detects breaking changes.',              author: 'muxvo-team',   category: 'Writing',    installs: 4100, score: 9.4 },
  { id: '8',  name: 'Bug Hunter',            description: 'Systematic bug detection using static analysis patterns. Finds null dereferences, race conditions, and memory leaks.',      author: 'buglab',       category: 'Coding',     installs: 890,  score: 7.8 },
  { id: '9',  name: 'Dependency Auditor',    description: 'Scan project dependencies for known vulnerabilities, license conflicts, and outdated packages.',                            author: 'secwatch',     category: 'DevOps',     installs: 1350, score: 8.6 },
  { id: '10', name: 'Research Summarizer',   description: 'Summarize technical papers, RFCs, and documentation into actionable engineering notes.',                                    author: 'paperstack',   category: 'Research',   installs: 760,  score: 8.1 },
  { id: '11', name: 'Cron Job Scheduler',    description: 'Design and validate cron expressions. Generates systemd timers and cloud scheduler configs.',                               author: 'automate-io',  category: 'Automation', installs: 520,  score: 7.5 },
  { id: '12', name: 'Database Schema Gen',   description: 'Generate database schemas and migrations from natural language. Supports PostgreSQL, MySQL, and SQLite.',                   author: 'dataforge',    category: 'Coding',     installs: 1080, score: 8.4 },
  { id: '13', name: 'Release Notes Writer',  description: 'Auto-generate release notes from git history and PR descriptions. Markdown and changelog format.',                          author: 'docsmith',     category: 'Writing',    installs: 690,  score: 7.9 },
  { id: '14', name: 'Log Analyzer',          description: 'Parse and analyze application logs to find patterns, anomalies, and root causes for errors.',                               author: 'logwise',      category: 'Research',   installs: 440,  score: 7.6 },
  { id: '15', name: 'Workflow Automator',    description: 'Build multi-step automation pipelines triggered by file changes, webhooks, or schedules.',                                  author: 'automate-io',  category: 'Automation', installs: 380,  score: 7.2 },
];

const CATEGORIES: ('All' | Category)[] = ['All', 'Coding', 'DevOps', 'Writing', 'Research', 'Automation', 'Other'];

const CATEGORY_COLORS: Record<Category, string> = {
  Coding:     '#60a5fa',
  DevOps:     '#34d399',
  Writing:    '#c084fc',
  Research:   '#fb923c',
  Automation: '#f472b6',
  Other:      '#94a3b8',
};

function formatInstalls(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/* ------------------------------------------------------------------ */
/*  API fetch hook                                                     */
/* ------------------------------------------------------------------ */
function useSkills(search: string, category: 'All' | Category) {
  const [skills, setSkills] = useState<Skill[]>(FALLBACK_SKILLS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFromApi, setIsFromApi] = useState(false);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (category !== 'All') params.set('category', category);
    params.set('limit', '50');

    try {
      const res = await fetch(`${API_BASE}/marketplace/search?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkills(data.items);
      setIsFromApi(true);
    } catch {
      // API failed — fall back to static data with client-side filtering
      setIsFromApi(false);
      setError('Using offline data');
      setSkills(FALLBACK_SKILLS);
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => {
    // Debounce search input
    const timer = setTimeout(fetchSkills, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchSkills]);

  return { skills, loading, error, isFromApi };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function Discover() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<'All' | Category>('All');

  const { skills, loading, error, isFromApi } = useSkills(search, activeCategory);

  // Client-side filtering as fallback when using static data
  const filtered = useMemo(() => {
    if (isFromApi) return skills;
    return skills.filter((s) => {
      const matchCategory = activeCategory === 'All' || s.category === activeCategory;
      const q = search.toLowerCase();
      const matchSearch = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.author.toLowerCase().includes(q);
      return matchCategory && matchSearch;
    });
  }, [skills, search, activeCategory, isFromApi]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-after)' }}>
      {/* ============ HEADER ============ */}
      <header className="max-w-[1200px] mx-auto px-6 pt-16 text-center">
        <p
          className="text-[13px] font-semibold tracking-widest uppercase mb-3"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}
        >
          SKILL MARKETPLACE
        </p>
        <h1
          className="text-5xl max-sm:text-4xl font-bold m-0"
          style={{ letterSpacing: '-0.02em', lineHeight: 1.15 }}
        >
          Discover <span style={{ color: 'var(--amber)' }}>Skills</span>
        </h1>
        <p
          className="text-lg mt-3 max-w-[600px] mx-auto"
          style={{ color: 'var(--text-after-sec)', lineHeight: 1.6 }}
        >
          Browse community-built skills for Claude Code, Codex, and Gemini CLI.
          Each skill is AI-scored for quality.
        </p>
      </header>

      {/* ============ SEARCH + FILTERS ============ */}
      <div className="max-w-[1200px] mx-auto px-6 pt-10">
        {/* Search bar */}
        <div
          className="flex items-center rounded-[10px] px-5 py-3.5 max-w-[560px] mx-auto"
          style={{
            background: 'var(--bg-after-card)',
            border: '1px solid var(--border-after-active)',
          }}
        >
          <span className="mr-3 text-base shrink-0" style={{ color: 'var(--amber)' }}>
            &#128269;
          </span>
          <input
            type="text"
            className="discover-search flex-1 bg-transparent border-none outline-none text-sm"
            placeholder="Search skills by name, description, or author..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-after)',
              caretColor: 'var(--amber)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="bg-transparent border-none cursor-pointer text-base px-1 leading-none"
              style={{ color: 'var(--text-after-sec)' }}
            >
              &#x2715;
            </button>
          )}
        </div>

        {/* Category pills */}
        <div className="flex flex-wrap gap-2.5 justify-center mt-6">
          {CATEGORIES.map((cat) => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className="py-1.5 px-4.5 rounded-full font-semibold text-[13px] cursor-pointer transition-all duration-150"
                style={{
                  border: `1px solid ${active ? 'var(--amber)' : 'var(--border-after)'}`,
                  background: active ? 'var(--amber-glow)' : 'transparent',
                  color: active ? 'var(--amber)' : 'var(--text-after-sec)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Status indicator */}
        {error && (
          <div className="text-center mt-4">
            <span className="text-xs px-3 py-1 rounded-full" style={{ color: 'var(--text-after-sec)', background: 'var(--bg-after-card)' }}>
              {error}
            </span>
          </div>
        )}
      </div>

      {/* ============ SKILL GRID ============ */}
      <div className="max-w-[1200px] mx-auto px-6 pt-10 pb-20">
        <style>{`
          .discover-search::placeholder {
            color: var(--text-before-dim);
          }
          .discover-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
          }
          @media (max-width: 1023px) {
            .discover-grid { grid-template-columns: repeat(2, 1fr) !important; }
          }
          @media (max-width: 639px) {
            .discover-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
        {loading ? (
          <div className="text-center py-20" style={{ color: 'var(--text-after-sec)' }}>
            <p className="text-lg">Loading skills...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20" style={{ color: 'var(--text-after-sec)' }}>
            <p className="text-lg mb-2">No skills found</p>
            <p className="text-sm">Try a different search term or category.</p>
          </div>
        ) : (
          <div className="discover-grid">
            {filtered.map((skill) => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SkillCard                                                          */
/* ------------------------------------------------------------------ */
function SkillCard({ skill }: { skill: Skill }) {
  const [hovered, setHovered] = useState(false);
  const catColor = CATEGORY_COLORS[skill.category];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex flex-col rounded-[10px] p-6 transition-all duration-200"
      style={{
        background: 'var(--bg-after-card)',
        border: `1px solid ${hovered ? 'var(--border-after-active)' : 'var(--border-after)'}`,
        boxShadow: hovered ? '0 0 24px var(--amber-glow)' : 'none',
      }}
    >
      {/* Top row: category tag + score */}
      <div className="flex justify-between items-center mb-3">
        <span
          className="text-[11px] font-semibold py-0.5 px-2.5 rounded-xl"
          style={{
            fontFamily: 'var(--font-mono)',
            background: `${catColor}18`,
            color: catColor,
            letterSpacing: '0.03em',
          }}
        >
          {skill.category}
        </span>
        <span
          className="text-[13px] font-bold"
          style={{ color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}
        >
          {skill.score.toFixed(1)}
        </span>
      </div>

      {/* Name */}
      <h3 className="text-[17px] font-bold m-0 mb-2 leading-snug" style={{ color: 'var(--text-after)' }}>
        {skill.name}
      </h3>

      {/* Description */}
      <p
        className="text-[13px] m-0 flex-1 mb-4"
        style={{ color: 'var(--text-after-sec)', lineHeight: 1.6 }}
      >
        {skill.description}
      </p>

      {/* Bottom row: author + installs */}
      <div
        className="flex justify-between items-center pt-3"
        style={{ borderTop: '1px solid var(--border-after)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-after-sec)', fontFamily: 'var(--font-mono)' }}>
          @{skill.author}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-after-sec)', fontFamily: 'var(--font-mono)' }}>
          {formatInstalls(skill.installs)} installs
        </span>
      </div>
    </div>
  );
}
