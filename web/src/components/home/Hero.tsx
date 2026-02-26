const DOWNLOAD_URL = 'https://github.com/muxvo/muxvo/releases/latest/download/Muxvo-arm64.dmg';

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-content fade-up">
        <h1 className="hero-title">
          AI CLI 的<span className="text-amber">工作台</span>
        </h1>
        <p className="hero-subtitle">
          终端管理 · 配置浏览 · 聊天历史 · 永久保存
          <br />
          Claude Code / Codex / Gemini CLI — 在一个界面无缝切换
        </p>
        <div className="hero-actions">
          <a href={DOWNLOAD_URL} className="btn-amber btn-amber-lg">
            Download for macOS
          </a>
          <a
            href="https://github.com/muxvo/muxvo"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            View on GitHub
          </a>
        </div>
      </div>

      {/* App Mock */}
      <div className="hero-mock fade-up">
        <div className="mock-app">
          <div className="mock-app-titlebar">
            <span className="mock-dot mock-dot--red" />
            <span className="mock-dot mock-dot--yellow" />
            <span className="mock-dot mock-dot--green" />
            <span className="mock-app-name">Muxvo</span>
          </div>
          <div className="mock-app-body">
            <div className="mock-app-main">
              <div className="mock-terminal">
                <div className="mock-terminal-tab">CLAUDE CODE</div>
                <div className="mock-terminal-line">
                  <span className="c-prompt">$</span> claude &quot;review PR #42&quot;
                </div>
                <div className="mock-terminal-line c-dim">Reading diff...</div>
                <div className="mock-terminal-line c-success">Found 3 issues in src/auth.ts</div>
              </div>
              <div className="mock-terminal">
                <div className="mock-terminal-tab">CODEX</div>
                <div className="mock-terminal-line">
                  <span className="c-prompt">$</span> codex &quot;generate tests&quot;
                </div>
                <div className="mock-terminal-line c-dim">Creating test suite...</div>
                <div className="mock-terminal-line c-success">12 tests generated, coverage 94%</div>
              </div>
              <div className="mock-terminal">
                <div className="mock-terminal-tab">GEMINI CLI</div>
                <div className="mock-terminal-line">
                  <span className="c-prompt">$</span> gemini chat
                </div>
                <div className="mock-terminal-line c-dim">How can I help you today?</div>
                <div className="mock-terminal-line">
                  <span className="c-prompt">&gt;</span> Explain the auth flow
                </div>
              </div>
              <div className="mock-terminal">
                <div className="mock-terminal-tab">DEV SERVER</div>
                <div className="mock-terminal-line">
                  <span className="c-prompt">$</span> npm run dev
                </div>
                <div className="mock-terminal-line c-success">Server on :3000</div>
                <div className="mock-terminal-line c-dim">Watching for changes...</div>
              </div>
            </div>
            <div className="mock-app-sidebar">
              <div className="mock-sidebar-section">
                <div className="mock-sidebar-title">Chat History</div>
                <div className="mock-sidebar-item">Today · PR Review</div>
                <div className="mock-sidebar-item">Today · Test Gen</div>
                <div className="mock-sidebar-item mock-sidebar-item--dim">Yesterday · Auth Flow</div>
              </div>
              <div className="mock-sidebar-section">
                <div className="mock-sidebar-title">Config</div>
                <div className="mock-sidebar-item">
                  <span className="text-amber">Skills</span> · 8 installed
                </div>
                <div className="mock-sidebar-item">
                  <span className="text-amber">MCP</span> · 3 servers
                </div>
                <div className="mock-sidebar-item">
                  <span className="text-amber">CLAUDE.md</span> · project-a
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
