export function CompareConversations() {
  return (
    <section className="compare-section compare-section--reversed" id="lost-conversations">
      <div className="compare-before">
        <div className="compare-inner fade-right">
          <span className="compare-label label-problem">// THE PROBLEM</span>
          <h3 className="compare-title">对话记录去哪了？</h3>
          <p className="compare-desc">
            Claude 三天前建议了一个架构方案，但你不记得在哪个 session 里。打开
            ~/.claude/history，翻了 20 个 JSON 文件。放弃了。
          </p>
          <div className="mock-file-list">
            <div className="file-path-header">~/.claude/projects/</div>
            <div className="file-item">
              <span className="file-name">session_2026-02-18_143022.json</span>
              <span className="file-size">2.3 KB</span>
            </div>
            <div className="file-item">
              <span className="file-name">session_2026-02-17_091544.json</span>
              <span className="file-size">5.1 KB</span>
            </div>
            <div className="file-item">
              <span className="file-name">session_2026-02-16_220318.json</span>
              <span className="file-size">1.8 KB</span>
            </div>
            <div className="file-item">
              <span className="file-name">session_2026-02-15_103655.json</span>
              <span className="file-size">
                8.4 KB<span className="file-unknown">?</span>
              </span>
            </div>
            <div className="file-item">
              <span className="file-name">session_2026-02-14_184201.json</span>
              <span className="file-size">3.7 KB</span>
            </div>
            <div className="file-item">
              <span className="file-name">session_2026-02-13_072910.json</span>
              <span className="file-size">4.2 KB</span>
            </div>
            <div className="file-item">
              <span className="file-name">session_2026-02-12_155447.json</span>
              <span className="file-size">6.0 KB</span>
            </div>
            <div className="file-more">...还有 47 个文件</div>
          </div>
        </div>
      </div>
      <div className="compare-divider" />
      <div className="compare-after">
        <div className="compare-inner fade-left">
          <span className="compare-label label-solution">// THE SOLUTION</span>
          <h3 className="compare-title">聊天历史搜索</h3>
          <p className="compare-desc">
            全文搜索所有 AI CLI 对话记录。输入关键词，跨 session、跨工具，秒级返回。
          </p>
          <div className="mock-search-ui">
            <div className="search-input-row">
              <span className="search-icon">&#128269;</span>
              <span className="search-text">"架构方案"</span>
            </div>
            <div className="search-result-item">
              <div className="search-result-header">
                Session #42 &middot; Claude Code &middot; project-a
              </div>
              <div className="search-result-snippet">
                建议采用微服务<span className="search-highlight">架构方案</span>
                ，将核心模块拆分为独立服务...
              </div>
            </div>
            <div className="search-result-item">
              <div className="search-result-header">
                Session #38 &middot; Claude Code &middot; project-b
              </div>
              <div className="search-result-snippet">
                对比了三种<span className="search-highlight">架构方案</span>
                后，推荐六边形架构...
              </div>
            </div>
            <div className="search-result-item">
              <div className="search-result-header">
                Session #31 &middot; Gemini CLI &middot; project-c
              </div>
              <div className="search-result-snippet">
                这个<span className="search-highlight">架构方案</span>
                的优势在于松耦合和可测试性...
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
