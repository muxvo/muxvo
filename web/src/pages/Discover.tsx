import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

/* ------------------------------------------------------------------ */
/*  Design tokens (from landing page CSS variables)                   */
/* ------------------------------------------------------------------ */
const T = {
  bgAfter: '#06080c',
  bgAfterCard: '#0d1117',
  borderAfter: '#1e2530',
  borderAfterActive: 'rgba(232,167,72,0.4)',
  textAfter: '#f5f5f5',
  textAfterSec: '#9ca3af',
  amber: '#e8a748',
  amberLight: '#f5c563',
  amberGlow: 'rgba(232,167,72,0.12)',
  fontDisplay: "'DM Sans', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', monospace",
} as const;

/* ------------------------------------------------------------------ */
/*  Static skill data                                                 */
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

const SKILLS: Skill[] = [
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
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function Discover() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<'All' | Category>('All');

  const filtered = useMemo(() => {
    return SKILLS.filter((s) => {
      const matchCategory = activeCategory === 'All' || s.category === activeCategory;
      const q = search.toLowerCase();
      const matchSearch = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.author.toLowerCase().includes(q);
      return matchCategory && matchSearch;
    });
  }, [search, activeCategory]);

  return (
    <div style={{
      minHeight: '100vh',
      background: T.bgAfter,
      color: T.textAfter,
      fontFamily: T.fontDisplay,
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* --- Google Fonts link (injected once) --- */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />

      {/* ============ NAV ============ */}
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: 64,
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(6,8,12,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${T.borderAfter}`,
      }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 24px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'baseline', gap: 8, textDecoration: 'none' }}>
            <span style={{ fontWeight: 700, fontSize: 18, color: T.amber }}>Muxvo</span>
          </Link>
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <Link to="/" style={{ fontSize: 14, color: T.textAfterSec, textDecoration: 'none' }}>Home</Link>
            <Link to="/discover" style={{ fontSize: 14, color: T.amber, textDecoration: 'none' }}>Discover</Link>
          </div>
        </div>
      </nav>

      {/* ============ HEADER ============ */}
      <header style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '64px 24px 0',
        textAlign: 'center',
      }}>
        <p style={{
          fontFamily: T.fontMono,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color: T.amber,
          marginBottom: 12,
        }}>
          SKILL MARKETPLACE
        </p>
        <h1 style={{
          fontSize: 48,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          margin: 0,
        }}>
          Discover <span style={{ color: T.amber }}>Skills</span>
        </h1>
        <p style={{
          fontSize: 18,
          color: T.textAfterSec,
          marginTop: 12,
          maxWidth: 600,
          marginLeft: 'auto',
          marginRight: 'auto',
          lineHeight: 1.6,
        }}>
          Browse community-built skills for Claude Code, Codex, and Gemini CLI. Each skill is AI-scored for quality.
        </p>
      </header>

      {/* ============ SEARCH + FILTERS ============ */}
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '40px 24px 0',
      }}>
        {/* Search bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: T.bgAfterCard,
          border: `1px solid ${T.borderAfterActive}`,
          borderRadius: 10,
          padding: '14px 20px',
          maxWidth: 560,
          margin: '0 auto',
        }}>
          <span style={{ color: T.amber, marginRight: 12, fontSize: 16, flexShrink: 0 }}>&#128269;</span>
          <input
            type="text"
            className="discover-search"
            placeholder="Search skills by name, description, or author..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontFamily: T.fontMono,
              fontSize: 14,
              color: T.textAfter,
              caretColor: T.amber,
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                background: 'transparent',
                border: 'none',
                color: T.textAfterSec,
                cursor: 'pointer',
                fontSize: 16,
                padding: '0 4px',
                lineHeight: 1,
              }}
            >
              &#x2715;
            </button>
          )}
        </div>

        {/* Category pills */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
          marginTop: 24,
        }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '7px 18px',
                borderRadius: 20,
                border: `1px solid ${activeCategory === cat ? T.amber : T.borderAfter}`,
                background: activeCategory === cat ? T.amberGlow : 'transparent',
                color: activeCategory === cat ? T.amber : T.textAfterSec,
                fontFamily: T.fontDisplay,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ============ SKILL GRID ============ */}
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}>
        <style>{`
          .discover-search::placeholder {
            color: #5a5e6a;
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
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: T.textAfterSec }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>No skills found</p>
            <p style={{ fontSize: 14 }}>Try a different search term or category.</p>
          </div>
        ) : (
          <div className="discover-grid">
            {filtered.map((skill) => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        )}
      </div>

      {/* ============ FOOTER ============ */}
      <footer style={{
        background: T.bgAfter,
        padding: '0 24px 48px',
      }}>
        <div style={{
          height: 1,
          background: `linear-gradient(to right, transparent, ${T.amber}, transparent)`,
          marginBottom: 48,
        }} />
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: T.amber }}>Muxvo</span>
          <span style={{ fontFamily: T.fontMono, fontSize: 13, color: T.textAfterSec }}>
            The desktop workbench for AI CLI tools.
          </span>
          <span style={{ fontSize: 13, color: T.textAfterSec }}>&copy; 2026 Muxvo. MIT License.</span>
        </div>
      </footer>
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
      style={{
        background: T.bgAfterCard,
        border: `1px solid ${hovered ? T.borderAfterActive : T.borderAfter}`,
        borderRadius: 10,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        boxShadow: hovered ? `0 0 24px ${T.amberGlow}` : 'none',
      }}
    >
      {/* Top row: category tag + score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          fontFamily: T.fontMono,
          padding: '3px 10px',
          borderRadius: 12,
          background: `${catColor}18`,
          color: catColor,
          letterSpacing: '0.03em',
        }}>
          {skill.category}
        </span>
        <span style={{
          fontSize: 13,
          fontWeight: 700,
          color: T.amber,
          fontFamily: T.fontMono,
        }}>
          {skill.score.toFixed(1)}
        </span>
      </div>

      {/* Name */}
      <h3 style={{
        fontSize: 17,
        fontWeight: 700,
        color: T.textAfter,
        margin: 0,
        marginBottom: 8,
        lineHeight: 1.3,
      }}>
        {skill.name}
      </h3>

      {/* Description */}
      <p style={{
        fontSize: 13,
        color: T.textAfterSec,
        lineHeight: 1.6,
        margin: 0,
        flex: 1,
        marginBottom: 16,
      }}>
        {skill.description}
      </p>

      {/* Bottom row: author + installs */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 12,
        borderTop: `1px solid ${T.borderAfter}`,
      }}>
        <span style={{
          fontSize: 12,
          color: T.textAfterSec,
          fontFamily: T.fontMono,
        }}>
          @{skill.author}
        </span>
        <span style={{
          fontSize: 12,
          color: T.textAfterSec,
          fontFamily: T.fontMono,
        }}>
          {formatInstalls(skill.installs)} installs
        </span>
      </div>
    </div>
  );
}
