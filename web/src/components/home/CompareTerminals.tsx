export function CompareTerminals() {
  return (
    <section className="compare-section" id="features">
      <div className="compare-before">
        <div className="compare-inner fade-left">
          <span className="compare-label label-problem">// THE PROBLEM</span>
          <h3 className="compare-title">终端窗口地狱</h3>
          <p className="compare-desc">
            6 个终端窗口，3 个项目，无数次 Cmd+Tab。你知道 Claude Code
            在哪个窗口里跑着，但找到它需要 15 秒。
          </p>
          <div className="mock-windows-enhanced">
            <div className="mock-win-e mock-win-1">
              <div className="mock-titlebar">
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-titlebar-text">~/project-a</span>
              </div>
              <div className="mock-cmd">$ claude "review this code"</div>
              <div className="mock-output">Analyzing 12 files...</div>
              <div className="mock-output">Processing src/main...</div>
            </div>
            <div className="mock-win-e mock-win-2">
              <div className="mock-titlebar">
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-titlebar-text">~/project-b</span>
              </div>
              <div className="mock-cmd">$ codex --model o3</div>
              <div className="mock-output">Generating tests...</div>
            </div>
            <div className="mock-win-e mock-win-3">
              <div className="mock-titlebar">
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-titlebar-text">~/project-c/api</span>
              </div>
              <div className="mock-cmd">$ gemini chat</div>
              <div className="mock-output">What would you like to discuss?</div>
            </div>
            <div className="mock-win-e mock-win-4">
              <div className="mock-titlebar">
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-titlebar-text">~/project-a/src</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="compare-divider" />
      <div className="compare-after">
        <div className="compare-inner fade-right">
          <span className="compare-label label-solution">// THE SOLUTION</span>
          <h3 className="compare-title">平铺终端管理</h3>
          <p className="compare-desc">
            全屏网格布局。每个终端有固定位置，一眼看到所有 AI CLI
            工具的运行状态。不再切换——因为管理界面让一切都在视野中。
          </p>
          <div className="mock-grid">
            <div className="grid-pane">
              <div className="grid-pane-title">CLAUDE CODE</div>
              <div className="grid-pane-path">~/project-a</div>
              <div className="grid-pane-output">Analyzing 12 files...</div>
              <div className="grid-pane-output grid-pane-success">
                &#10003; Found 3 issues
              </div>
            </div>
            <div className="grid-pane">
              <div className="grid-pane-title">CODEX</div>
              <div className="grid-pane-path">~/project-b</div>
              <div className="grid-pane-output">Generating tests...</div>
              <div className="grid-pane-output grid-pane-success">
                Created 5 test files
              </div>
            </div>
            <div className="grid-pane">
              <div className="grid-pane-title">GEMINI CLI</div>
              <div className="grid-pane-path">~/project-c</div>
              <div className="grid-pane-output">Ready for input...</div>
            </div>
            <div className="grid-pane">
              <div className="grid-pane-title">NPM RUN</div>
              <div className="grid-pane-path">~/project-a</div>
              <div className="grid-pane-output">dev server on :3000</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
