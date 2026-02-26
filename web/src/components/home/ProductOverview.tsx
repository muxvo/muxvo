export function ProductOverview() {
  return (
    <section className="overview-section">
      <div className="overview-header fade-up">
        <h2 className="overview-title">
          不是终端，不是 IDE — 是<span className="text-amber">工作台</span>
        </h2>
        <p className="overview-subtitle">
          终端、对话、配置 — AI CLI 工作流的一切所需，在一个窗口里。
        </p>
      </div>

      <div className="overview-mock fade-up">
        <div className="overview-frame">
          {/* Title bar */}
          <div className="overview-titlebar">
            <span className="mock-dot mock-dot--red" />
            <span className="mock-dot mock-dot--yellow" />
            <span className="mock-dot mock-dot--green" />
            <span className="overview-titlebar-text">Muxvo — ~/projects</span>
          </div>

          <div className="overview-body">
            {/* Main: 4 terminals */}
            <div className="overview-main">
              <div className="overview-pane">
                <div className="overview-pane-tab">
                  <span className="overview-pane-dot overview-pane-dot--active" />
                  CLAUDE CODE
                </div>
                <div className="overview-pane-content">
                  <span className="c-prompt">$</span> claude &quot;review this PR&quot;<br />
                  <span className="c-success">Reading diff...</span><br />
                  Found 3 issues in auth.ts<br />
                  <span className="c-success">Suggesting fixes...</span>
                </div>
              </div>
              <div className="overview-pane">
                <div className="overview-pane-tab">
                  <span className="overview-pane-dot overview-pane-dot--active" />
                  CODEX
                </div>
                <div className="overview-pane-content">
                  <span className="c-prompt">$</span> codex &quot;add tests&quot;<br />
                  <span className="c-success">Creating suite...</span><br />
                  12 tests generated<br />
                  Coverage: 94%
                </div>
              </div>
              <div className="overview-pane">
                <div className="overview-pane-tab">
                  <span className="overview-pane-dot overview-pane-dot--active" />
                  GEMINI CLI
                </div>
                <div className="overview-pane-content">
                  <span className="c-prompt">$</span> gemini chat<br />
                  How can I help?<br />
                  <span className="c-prompt">&gt;</span> Explain auth flow
                </div>
              </div>
              <div className="overview-pane">
                <div className="overview-pane-tab">
                  <span className="overview-pane-dot overview-pane-dot--idle" />
                  BUILD
                </div>
                <div className="overview-pane-content">
                  <span className="c-prompt">$</span> npm run build<br />
                  <span className="c-success">Build complete.</span><br />
                  dist/main.js 48.2 kB
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="overview-sidebar">
              <div className="overview-sidebar-block">
                <div className="overview-sidebar-title">Chat History</div>
                <div className="overview-sidebar-meta">12 sessions · 3 projects</div>
                <div className="overview-sidebar-item">Today · PR Review</div>
                <div className="overview-sidebar-item">Today · Test Gen</div>
                <div className="overview-sidebar-item">Yesterday · Auth Flow</div>
                <div className="overview-sidebar-item overview-sidebar-item--dim">+ 9 more</div>
              </div>
              <div className="overview-sidebar-block">
                <div className="overview-sidebar-title">Config</div>
                <div className="overview-sidebar-meta">8 skills · 3 MCP servers</div>
                <div className="overview-sidebar-item"><span className="text-amber">commit-msg</span> v2.1</div>
                <div className="overview-sidebar-item"><span className="text-amber">code-review</span> v1.4</div>
                <div className="overview-sidebar-item"><span className="text-amber">test-gen</span> v3.0</div>
              </div>
              <div className="overview-sidebar-block">
                <div className="overview-sidebar-title">CLI Tools</div>
                <div className="overview-sidebar-meta">3 connected</div>
                <div className="overview-sidebar-item">
                  <span className="overview-status overview-status--online" /> Claude Code · opus-4
                </div>
                <div className="overview-sidebar-item">
                  <span className="overview-status overview-status--online" /> Codex · o3
                </div>
                <div className="overview-sidebar-item">
                  <span className="overview-status overview-status--online" /> Gemini CLI · 2.5-pro
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
