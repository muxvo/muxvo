const FEATURES = [
  {
    icon: '⊞',
    title: '终端不混乱',
    desc: '多终端平铺管理，所有窗口一目了然，不用在一堆终端之间来回切换。',
  },
  {
    icon: '⚙',
    title: '立刻检测本地所有 Skill',
    desc: '自动扫描你本地安装的所有 Skill，知道自己装了什么，方便管理。',
  },
  {
    icon: '💬',
    title: '聊天记录方便查看，还能接着对话',
    desc: '历史聊天记录一目了然，找到之前的对话后可以直接接着聊，不用重新描述上下文。',
  },
  {
    icon: '∞',
    title: '永久保存聊天记录',
    desc: 'Claude Code 30 天会自动删除对话记录，Muxvo 帮你永久保存，随时翻阅。',
  },
  {
    icon: '⇄',
    title: '支持 CC / Codex / Gemini CLI，随时切换',
    desc: '不只是 Claude Code，还支持 Codex 和 Gemini CLI，在一个界面随时切换任何 CLI 工具。',
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
