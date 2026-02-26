const FEATURES = [
  {
    icon: '⊞',
    title: '多终端平铺，不用切窗口',
    desc: '所有终端一屏排开，不在一堆窗口之间来回找。省下的是每天几十次的 ⌘Tab。',
  },
  {
    icon: '⚙',
    title: 'Skill 一览无余',
    desc: '自动扫描本地所有 Skill 和 MCP，装了什么、在哪里，打开就知道。',
  },
  {
    icon: '💬',
    title: '找到记录，接着聊',
    desc: '历史对话一目了然，找到后直接续聊，不用重新描述上下文。',
  },
  {
    icon: '∞',
    title: '聊天记录永久保存',
    desc: 'CC 30 天自动删除对话，Muxvo 帮你永久存档，随时翻阅。',
  },
  {
    icon: '⇄',
    title: 'CC · Codex · Gemini CLI 随时切',
    desc: '一个界面管理所有 AI CLI 工具，不用开多个终端窗口。',
  },
];

export function Features() {
  return (
    <section className="mv-features" id="features">
      <div className="mv-features__inner">
        <div className="mv-features__header fade-up">
          <p className="mv-features__eyebrow">FEATURES</p>
          <h2 className="mv-features__title">
            效率从哪里来
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
