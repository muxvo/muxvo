export function FeatureConfig() {
  return (
    <section className="feature-section feature-section--alt">
      <div className="feature-inner feature-inner--reversed">
        <div className="feature-text fade-up">
          <span className="feature-badge">配置管理</span>
          <h2 className="feature-title">
            Skill · MCP · 配置，<span className="text-amber">一目了然</span>
          </h2>
          <p className="feature-desc">
            Skill 文件在 ~/.claude/commands/，MCP 配置在 settings.json，CLAUDE.md 在项目根目录……
            想看看自己到底配了什么？用 Muxvo 一键扫描，树形浏览，点击即编辑。
          </p>
          <ul className="feature-list">
            <li>
              <span className="text-amber">&#9654;</span> 自动扫描所有 Skill 和 MCP Server
            </li>
            <li>
              <span className="text-amber">&#9654;</span> 树形浏览，不用记路径
            </li>
            <li>
              <span className="text-amber">&#9654;</span> 点击直接编辑，保存即生效
            </li>
          </ul>
        </div>

        <div className="feature-mock fade-up">
          <div className="mock-config-panel">
            <div className="mock-config-sidebar">
              <div className="mock-config-group">
                <div className="mock-config-group-title">&#9660; Skills</div>
                <div className="mock-config-item">commit-msg</div>
                <div className="mock-config-item">code-review</div>
                <div className="mock-config-item mock-config-item--active">test-gen</div>
                <div className="mock-config-item">doc-writer</div>
              </div>
              <div className="mock-config-group">
                <div className="mock-config-group-title">&#9660; MCP Servers</div>
                <div className="mock-config-item">filesystem</div>
                <div className="mock-config-item">github</div>
                <div className="mock-config-item">postgres</div>
              </div>
              <div className="mock-config-group">
                <div className="mock-config-group-title">&#9660; CLAUDE.md</div>
                <div className="mock-config-item">~/project-a</div>
                <div className="mock-config-item">~/project-b</div>
              </div>
            </div>
            <div className="mock-config-content">
              <div className="mock-config-content-header">
                <span className="text-amber">test-gen</span>
                <span className="mock-config-content-path">~/.claude/commands/test-gen.md</span>
              </div>
              <div className="mock-config-content-body">
                <div className="mock-code-line"><span className="c-dim"># Test Generator</span></div>
                <div className="mock-code-line">&nbsp;</div>
                <div className="mock-code-line">Generate comprehensive tests for</div>
                <div className="mock-code-line">the specified module. Include:</div>
                <div className="mock-code-line">- Unit tests for each function</div>
                <div className="mock-code-line">- Edge cases and error handling</div>
                <div className="mock-code-line">- Integration test scaffolding</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
