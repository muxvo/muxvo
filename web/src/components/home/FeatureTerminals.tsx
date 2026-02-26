export function FeatureTerminals() {
  return (
    <section className="feature-section" id="features">
      <div className="feature-inner">
        <div className="feature-text fade-up">
          <span className="feature-badge">终端管理</span>
          <h2 className="feature-title">
            三种 AI CLI，<span className="text-amber">一个界面</span>
          </h2>
          <p className="feature-desc">
            Claude Code、Codex、Gemini CLI — 不再需要 6 个终端窗口和无数次 Cmd+Tab。
            Muxvo 把所有终端平铺在一个全屏网格中，每个工具的运行状态一目了然。
          </p>
          <ul className="feature-list">
            <li>
              <span className="text-amber">&#9654;</span> 多终端平铺布局，告别窗口切换
            </li>
            <li>
              <span className="text-amber">&#9654;</span> Claude Code / Codex / Gemini CLI 同时运行
            </li>
            <li>
              <span className="text-amber">&#9654;</span> 一键新建终端，自动分配位置
            </li>
          </ul>
        </div>

        <div className="feature-mock fade-up">
          <div className="mock-grid-4">
            <div className="mock-pane">
              <div className="mock-pane-header">
                <span className="mock-pane-dot mock-pane-dot--active" />
                <span className="mock-pane-label">CLAUDE CODE</span>
                <span className="mock-pane-path">~/project-a</span>
              </div>
              <div className="mock-pane-body">
                <div className="mock-line"><span className="c-prompt">$</span> claude &quot;fix the auth bug&quot;</div>
                <div className="mock-line c-dim">Analyzing 12 files...</div>
                <div className="mock-line c-success">&#10003; Fixed 3 issues</div>
              </div>
            </div>
            <div className="mock-pane">
              <div className="mock-pane-header">
                <span className="mock-pane-dot mock-pane-dot--active" />
                <span className="mock-pane-label">CODEX</span>
                <span className="mock-pane-path">~/project-b</span>
              </div>
              <div className="mock-pane-body">
                <div className="mock-line"><span className="c-prompt">$</span> codex --model o3</div>
                <div className="mock-line c-dim">Generating tests...</div>
                <div className="mock-line c-success">Created 5 test files</div>
              </div>
            </div>
            <div className="mock-pane">
              <div className="mock-pane-header">
                <span className="mock-pane-dot mock-pane-dot--active" />
                <span className="mock-pane-label">GEMINI CLI</span>
                <span className="mock-pane-path">~/project-c</span>
              </div>
              <div className="mock-pane-body">
                <div className="mock-line"><span className="c-prompt">$</span> gemini chat</div>
                <div className="mock-line c-dim">Session active</div>
                <div className="mock-line"><span className="c-prompt">&gt;</span> Explain this code</div>
              </div>
            </div>
            <div className="mock-pane">
              <div className="mock-pane-header">
                <span className="mock-pane-dot mock-pane-dot--idle" />
                <span className="mock-pane-label">DEV SERVER</span>
                <span className="mock-pane-path">~/project-a</span>
              </div>
              <div className="mock-pane-body">
                <div className="mock-line"><span className="c-prompt">$</span> npm run dev</div>
                <div className="mock-line c-success">Server on :3000</div>
                <div className="mock-line c-dim">Watching...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
