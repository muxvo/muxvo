const FEATURES = [
  {
    icon: '∞',
    title: '永久存档，找到就续聊',
    desc: 'Claude Code 30 天自动删除对话。Muxvo 帮你永久保存，找到任何历史对话，一键接着聊。',
    screenshot: '/screenshots/dark-chat-history.jpg',
    alt: 'Muxvo chat history — browse and resume any past conversation',
  },
  {
    icon: '⊞',
    title: '一屏排开，告别切窗口',
    desc: '多终端平铺管理，所有窗口一目了然。省下的是每天几十次 ⌘Tab。',
    screenshot: '/screenshots/dark-terminals.jpg',
    alt: 'Muxvo terminal grid — all sessions tiled on one screen',
  },
  {
    icon: '⚙',
    title: '自动扫描，Skill 和 MCP 一目了然',
    desc: '打开就能看到本地所有 Skill 和 MCP 服务器，装了什么、在哪里，不用翻目录。',
    screenshot: '/screenshots/dark-skills.jpg',
    alt: 'Muxvo skills panel — browse all installed skills and MCP servers',
  },
  {
    icon: '⇄',
    title: '统一入口，Codex 和 Gemini CLI 也能管',
    desc: '不只是 Claude Code。Codex、Gemini CLI 也能在同一个界面管理和切换。',
    screenshot: '/screenshots/dark-multi-tool.jpg',
    alt: 'Muxvo multi-tool support — manage Claude Code, Codex, and Gemini CLI',
  },
];

export function FeatureShowcase() {
  return (
    <section className="mv-showcase-section" id="features">
      <div className="mv-showcase-section__header fade-up">
        <p className="mv-showcase-section__eyebrow">核心功能</p>
        <h2 className="mv-showcase-section__title">
          省下来的时间，都是你的
        </h2>
      </div>

      {FEATURES.map((f, i) => (
        <div
          key={i}
          className={`mv-showcase${i % 2 === 1 ? ' mv-showcase--reverse' : ''}`}
        >
          <div className="mv-showcase__text fade-up">
            <div className="mv-showcase__icon">{f.icon}</div>
            <h3 className="mv-showcase__title">{f.title}</h3>
            <p className="mv-showcase__desc">{f.desc}</p>
          </div>
          <div className="mv-showcase__image fade-up">
            <img
              src={f.screenshot}
              alt={f.alt}
              loading="lazy"
              width="1440"
              height="900"
            />
          </div>
        </div>
      ))}
    </section>
  );
}
