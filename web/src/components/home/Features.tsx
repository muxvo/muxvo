const FEATURES = [
  {
    icon: '∞',
    title: '永久存档，找到就续聊',
    desc: 'Claude Code 30 天自动删除对话。Muxvo 帮你永久保存，找到任何历史对话，一键接着聊。',
  },
  {
    icon: '⊞',
    title: '一屏排开，告别切窗口',
    desc: '多终端平铺管理，所有窗口一目了然。省下的是每天几十次 ⌘Tab。',
  },
  {
    icon: '⚙',
    title: '自动扫描，Skill 和 MCP 一目了然',
    desc: '打开就能看到本地所有 Skill 和 MCP 服务器，装了什么、在哪里，不用翻目录。',
  },
  {
    icon: '⇄',
    title: '统一入口，Codex 和 Gemini CLI 也能管',
    desc: '不只是 Claude Code。Codex、Gemini CLI 也能在同一个界面管理和切换。',
  },
];

export function Features() {
  return (
    <section className="mv-features" id="features">
      <div className="mv-features__inner">
        <div className="mv-features__header fade-up">
          <h2 className="mv-features__title">
            核心功能
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
