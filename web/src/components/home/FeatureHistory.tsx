export function FeatureHistory() {
  return (
    <section className="feature-section">
      <div className="feature-inner">
        <div className="feature-text fade-up">
          <span className="feature-badge">聊天历史</span>
          <h2 className="feature-title">
            永久保存，<span className="text-amber">随时续聊</span>
          </h2>
          <p className="feature-desc">
            Claude Code 的对话记录 30 天后自动删除。三天前的架构方案？上周的 debug 思路？都没了。
            Muxvo 自动保存所有聊天记录，全文搜索，一键继续上次对话。
          </p>
          <ul className="feature-list">
            <li>
              <span className="text-amber">&#9654;</span> 永久保存，不受 30 天限制
            </li>
            <li>
              <span className="text-amber">&#9654;</span> 全文搜索，跨项目、跨工具
            </li>
            <li>
              <span className="text-amber">&#9654;</span> 一键继续上次对话，不用重新描述上下文
            </li>
          </ul>
        </div>

        <div className="feature-mock fade-up">
          <div className="mock-history-panel">
            <div className="mock-history-search">
              <span className="mock-history-search-icon">&#128269;</span>
              <span className="mock-history-search-text">&quot;架构方案&quot;</span>
            </div>
            <div className="mock-history-list">
              <div className="mock-history-item">
                <div className="mock-history-item-header">
                  <span className="mock-history-item-tool">Claude Code</span>
                  <span className="mock-history-item-project">project-a</span>
                  <span className="mock-history-item-date">3 天前</span>
                </div>
                <div className="mock-history-item-snippet">
                  建议采用微服务<span className="text-amber">架构方案</span>，将核心模块拆分为独立服务...
                </div>
                <div className="mock-history-item-action">继续对话 →</div>
              </div>
              <div className="mock-history-item">
                <div className="mock-history-item-header">
                  <span className="mock-history-item-tool">Gemini CLI</span>
                  <span className="mock-history-item-project">project-b</span>
                  <span className="mock-history-item-date">1 周前</span>
                </div>
                <div className="mock-history-item-snippet">
                  对比了三种<span className="text-amber">架构方案</span>后，推荐六边形架构...
                </div>
                <div className="mock-history-item-action">继续对话 →</div>
              </div>
              <div className="mock-history-item mock-history-item--saved">
                <div className="mock-history-item-header">
                  <span className="mock-history-item-tool">Codex</span>
                  <span className="mock-history-item-project">project-c</span>
                  <span className="mock-history-item-date">45 天前</span>
                  <span className="mock-history-item-badge">已保存</span>
                </div>
                <div className="mock-history-item-snippet">
                  这个<span className="text-amber">架构方案</span>的优势在于松耦合和可测试性...
                </div>
                <div className="mock-history-item-action">继续对话 →</div>
              </div>
            </div>
            <div className="mock-history-note">
              <span className="c-dim">&#128274;</span> 45 天前的记录 — 在 Claude Code 中已被删除，Muxvo 为你保留
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
