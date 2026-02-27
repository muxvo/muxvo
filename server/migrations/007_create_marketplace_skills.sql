-- Up

CREATE TABLE marketplace_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  author VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'Other',
  installs INTEGER NOT NULL DEFAULT 0,
  score NUMERIC(3,1) NOT NULL DEFAULT 0.0,
  status VARCHAR(20) NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_marketplace_skills_category ON marketplace_skills (category);
CREATE INDEX idx_marketplace_skills_status ON marketplace_skills (status);

-- Seed with initial data
INSERT INTO marketplace_skills (name, description, author, category, installs, score) VALUES
  ('Code Review Pro',      'Automated code review with style, security, and performance checks. Provides actionable suggestions inline.',                'muxvo-team',   'Coding',     2450, 9.2),
  ('Test Generator',       'Generate comprehensive unit tests from source code. Supports Jest, Vitest, and pytest.',                                    'testcraft',    'Coding',     1830, 8.7),
  ('Architecture Advisor', 'Analyze codebase and suggest architectural improvements. Detects anti-patterns and proposes refactoring strategies.',        'archwise',     'Coding',     3210, 9.0),
  ('Docker Compose Gen',   'Generate Docker Compose configurations from project structure. Multi-stage builds with best practices.',                    'devops-kit',   'DevOps',     1120, 8.5),
  ('CI Pipeline Builder',  'Create GitHub Actions workflows from project requirements. Supports build, test, deploy, and release automation.',          'ciforge',      'DevOps',      970, 8.3),
  ('API Doc Writer',       'Generate OpenAPI specs and markdown documentation from code. Includes request/response examples.',                          'docsmith',     'Writing',    1640, 8.9),
  ('Commit Message Craft', 'Craft semantic commit messages from staged diffs. Follows Conventional Commits and detects breaking changes.',              'muxvo-team',   'Writing',    4100, 9.4),
  ('Bug Hunter',           'Systematic bug detection using static analysis patterns. Finds null dereferences, race conditions, and memory leaks.',      'buglab',       'Coding',      890, 7.8),
  ('Dependency Auditor',   'Scan project dependencies for known vulnerabilities, license conflicts, and outdated packages.',                            'secwatch',     'DevOps',     1350, 8.6),
  ('Research Summarizer',  'Summarize technical papers, RFCs, and documentation into actionable engineering notes.',                                    'paperstack',   'Research',    760, 8.1),
  ('Cron Job Scheduler',   'Design and validate cron expressions. Generates systemd timers and cloud scheduler configs.',                               'automate-io',  'Automation',  520, 7.5),
  ('Database Schema Gen',  'Generate database schemas and migrations from natural language. Supports PostgreSQL, MySQL, and SQLite.',                   'dataforge',    'Coding',     1080, 8.4),
  ('Release Notes Writer', 'Auto-generate release notes from git history and PR descriptions. Markdown and changelog format.',                          'docsmith',     'Writing',     690, 7.9),
  ('Log Analyzer',         'Parse and analyze application logs to find patterns, anomalies, and root causes for errors.',                               'logwise',      'Research',    440, 7.6),
  ('Workflow Automator',   'Build multi-step automation pipelines triggered by file changes, webhooks, or schedules.',                                  'automate-io',  'Automation',  380, 7.2);

-- Down

DROP TABLE IF EXISTS marketplace_skills;
