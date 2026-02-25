export function Panorama() {
  return (
    <section className="panorama" id="product">
      <div className="panorama-header fade-up">
        <h2>
          一个工作台，<span className="text-amber">管理</span>一切。
        </h2>
        <p>终端、对话、配置、Skill — AI CLI 工作流的一切所需。</p>
      </div>

      <div className="panorama-frame fade-up">
        <span className="blueprint-corner blueprint-corner--tl">+</span>
        <span className="blueprint-corner blueprint-corner--tr">+</span>
        <span className="blueprint-corner blueprint-corner--bl">+</span>
        <span className="blueprint-corner blueprint-corner--br">+</span>

        <div className="panorama-shot">
          <div className="p-main">
            <div className="p-pane">
              <div className="p-pane-title">CLAUDE CODE</div>
              <div className="p-pane-path">~/project-a</div>
              <span className="p-pane-prompt">$</span> claude "review PR #42"
              <br />
              <span className="p-pane-success">Reading diff...</span>
              <br />
              Found 3 issues in src/auth.ts
              <br />
              Suggesting fixes...
            </div>
            <div className="p-pane">
              <div className="p-pane-title">CODEX</div>
              <div className="p-pane-path">~/project-b</div>
              <span className="p-pane-prompt">$</span> codex "generate tests"
              <br />
              <span className="p-pane-success">Creating test suite...</span>
              <br />
              12 tests generated
              <br />
              Coverage: 94%
            </div>
            <div className="p-pane">
              <div className="p-pane-title">GEMINI CLI</div>
              <div className="p-pane-path">~/project-c</div>
              <span className="p-pane-prompt">$</span> gemini chat
              <br />
              How can I help you today?
              <br />
              <span className="p-pane-prompt">&gt;</span> Explain the auth flow
            </div>
            <div className="p-pane">
              <div className="p-pane-title">BUILD</div>
              <div className="p-pane-path">~/project-a</div>
              <span className="p-pane-prompt">$</span> npm run build
              <br />
              <span className="p-pane-success">Build complete.</span>
              <br />
              dist/main.js &nbsp;48.2 kB
              <br />
              dist/style.css &nbsp;6.1 kB
            </div>
          </div>

          <div className="p-sidebar">
            <div className="p-pane p-pane--sidebar">
              <div className="p-sidebar-title">Chat History</div>
              <div className="p-sidebar-meta">
                12 sessions across 3 projects
              </div>
              <div className="p-sidebar-item">
                Today &middot; project-a &middot; PR Review
              </div>
              <div className="p-sidebar-item">
                Today &middot; project-b &middot; Test Gen
              </div>
              <div className="p-sidebar-item">
                Yesterday &middot; project-c &middot; Auth Flow
              </div>
              <div className="p-sidebar-item p-sidebar-item-dim">
                + 9 more sessions
              </div>
            </div>
            <div className="p-pane p-pane--sidebar">
              <div className="p-sidebar-title">Skill Market</div>
              <div className="p-sidebar-meta">
                8 installed &middot; 3 updates
              </div>
              <div className="p-sidebar-item">
                <span className="p-sidebar-item-amber">commit-msg</span> v2.1
              </div>
              <div className="p-sidebar-item">
                <span className="p-sidebar-item-amber">code-review</span> v1.4
              </div>
              <div className="p-sidebar-item">
                <span className="p-sidebar-item-amber">test-gen</span> v3.0
              </div>
            </div>
            <div className="p-pane p-pane--sidebar">
              <div className="p-sidebar-title">Config</div>
              <div className="p-sidebar-meta">3 CLIs configured</div>
              <div className="p-sidebar-item">
                Claude Code &middot; opus-4
              </div>
              <div className="p-sidebar-item">Codex &middot; o3</div>
              <div className="p-sidebar-item">Gemini CLI &middot; 2.5-pro</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
