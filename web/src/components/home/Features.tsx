const FEATURES = [
  {
    icon: '⊞',
    title: '终端不混乱',
    desc: '多终端平铺网格，告别 6 个窗口和无数次 Cmd+Tab。所有 AI CLI 的运行状态一目了然。',
  },
  {
    icon: '⇄',
    title: '多 CLI 无缝切换',
    desc: 'Claude Code、Codex、Gemini CLI — 在同一个界面并行运行，不用纠结该开哪个。',
  },
  {
    icon: '⚙',
    title: 'Skill · MCP 配置一览',
    desc: '自动扫描所有 Skill 和 MCP Server 配置。树形浏览，点击编辑，不用记路径。',
  },
  {
    icon: '🔍',
    title: '聊天记录随时查',
    desc: '全文搜索所有 AI 对话记录。跨项目、跨工具，一键找到三天前的架构方案。',
  },
  {
    icon: '∞',
    title: '永久保存，不怕丢',
    desc: 'Claude Code 30 天自动删除对话？Muxvo 帮你永久保存，随时翻阅。',
  },
  {
    icon: '↩',
    title: '一键继续对话',
    desc: '找到历史对话后，直接继续上次的讨论。不用重新描述上下文，AI 记得一切。',
  },
];

export function Features() {
  return (
    <section className="mv-features" id="features">
      <div className="mv-features__inner">
        <div className="mv-features__header fade-up">
          <p className="mv-features__eyebrow">FEATURES</p>
          <h2 className="mv-features__title">
            不只是终端管理器
          </h2>
        </div>
        <div className="mv-features__grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="mv-fcard fade-up">
              <div className="mv-fcard__icon">{f.icon}</div>
              <h3 className="mv-fcard__title">{f.title}</h3>
              <p className="mv-fcard__desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
