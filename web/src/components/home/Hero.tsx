const DOWNLOAD_URL =
  'https://github.com/muxvo/muxvo/releases/latest/download/Muxvo-arm64.dmg';

export function Hero() {
  return (
    <section className="mv-hero">
      {/* Ambient glow */}
      <div className="mv-hero__glow" />

      {/* Text block */}
      <div className="mv-hero__text">
        <p className="mv-hero__eyebrow">为 Claude Code 重度用户打造</p>
        <h1 className="mv-hero__title">
          Claude Code，效率拉满。
        </h1>
        <p className="mv-hero__sub">
          在终端里用 CC，切窗口、翻记录、找配置全靠自己。Muxvo 帮你省掉这些时间。
        </p>
        <div className="mv-hero__actions">
          <a href={DOWNLOAD_URL} className="btn-amber btn-amber-lg">
            下载 macOS 版
          </a>
          <a
            href="https://github.com/muxvo/muxvo"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            GitHub 源码
          </a>
        </div>
      </div>

      {/* App mockup — the hero's hero */}
      <div className="mv-hero__mock fade-up">
        <div className="mv-mock">
          {/* Title bar */}
          <div className="mv-mock__bar">
            <span className="mv-mock__dot mv-mock__dot--r" />
            <span className="mv-mock__dot mv-mock__dot--y" />
            <span className="mv-mock__dot mv-mock__dot--g" />
            <span className="mv-mock__bar-title">Muxvo</span>
            <div className="mv-mock__bar-tabs">
              <span className="mv-mock__bar-tab mv-mock__bar-tab--active">Terminals</span>
              <span className="mv-mock__bar-tab">Chat</span>
              <span className="mv-mock__bar-tab">Config</span>
            </div>
          </div>

          {/* Body: terminals + sidebar */}
          <div className="mv-mock__body">
            {/* Terminal panes: CC main + Dev Server auxiliary */}
            <div className="mv-mock__terminals">
              <Terminal
                name="CLAUDE CODE"
                path="~/acme-api"
                active
                main
                lines={[
                  { prompt: true, text: 'claude "fix auth middleware"' },
                  { dim: true, text: 'Reading src/middleware/auth.ts...' },
                  { dim: true, text: 'Found 2 issues in validateToken()' },
                  { dim: true, text: 'Applying fix...' },
                  { success: true, text: '✓ Fixed 2 issues, 1 file changed' },
                ]}
              />
              <Terminal
                name="CLAUDE CODE"
                path="~/acme-web"
                active
                lines={[
                  { prompt: true, text: 'claude "add dark mode toggle"' },
                  { dim: true, text: 'Scanning theme configuration...' },
                  { success: true, text: '✓ Added toggle, 3 files changed' },
                ]}
              />
              <Terminal
                name="DEV SERVER"
                path="~/acme-api"
                lines={[
                  { prompt: true, text: 'npm run dev' },
                  { success: true, text: 'Listening on :3000' },
                  { dim: true, text: 'GET /api/users 200 12ms' },
                ]}
              />
            </div>

            {/* Sidebar */}
            <div className="mv-mock__sidebar">
              {/* Chat History */}
              <div className="mv-mock__sb-section">
                <div className="mv-mock__sb-head">
                  <span className="mv-mock__sb-icon">💬</span>
                  Chat History
                </div>
                <div className="mv-mock__sb-meta">14 sessions · 3 projects</div>
                <SbItem label="Fix auth middleware" tag="CC" time="just now" />
                <SbItem label="Add dark mode" tag="CC" time="2h ago" />
                <SbItem label="Refactor DB layer" tag="CC" time="yesterday" />
                <div className="mv-mock__sb-more">+ 11 more sessions</div>
              </div>

              {/* Config */}
              <div className="mv-mock__sb-section">
                <div className="mv-mock__sb-head">
                  <span className="mv-mock__sb-icon">⚙️</span>
                  Config
                </div>
                <div className="mv-mock__sb-meta">8 skills · 3 MCP servers</div>
                <SbItem label="commit-msg" tag="Skill" />
                <SbItem label="code-review" tag="Skill" />
                <SbItem label="filesystem" tag="MCP" />
                <SbItem label="github" tag="MCP" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- sub-components ---- */

function Terminal({
  name,
  path,
  active,
  main,
  lines,
}: {
  name: string;
  path: string;
  active?: boolean;
  main?: boolean;
  lines: { prompt?: boolean; dim?: boolean; success?: boolean; text: string }[];
}) {
  return (
    <div className={`mv-term${main ? ' mv-term--main' : ''}`}>
      <div className="mv-term__head">
        <span
          className={`mv-term__status ${active ? 'mv-term__status--on' : 'mv-term__status--idle'}`}
        />
        <span className="mv-term__name">{name}</span>
        <span className="mv-term__path">{path}</span>
      </div>
      <div className="mv-term__body">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`mv-term__line${l.dim ? ' mv-term__line--dim' : ''}${l.success ? ' mv-term__line--ok' : ''}`}
          >
            {l.prompt && <span className="mv-term__prompt">$ </span>}
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function SbItem({
  label,
  tag,
  time,
}: {
  label: string;
  tag: string;
  time?: string;
}) {
  return (
    <div className="mv-mock__sb-item">
      <span className="mv-mock__sb-tag">{tag}</span>
      <span className="mv-mock__sb-label">{label}</span>
      {time && <span className="mv-mock__sb-time">{time}</span>}
    </div>
  );
}
