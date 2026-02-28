const DOWNLOAD_URL = 'https://muxvo.com/download/Muxvo-arm64.dmg';

export function Hero() {
  return (
    <section className="mv-hero">
      {/* Ambient glow */}
      <div className="mv-hero__glow" />

      {/* Text block */}
      <div className="mv-hero__text">
        <p className="mv-hero__eyebrow">为 Claude Code 重度用户打造</p>
        <h1 className="mv-hero__title">
          Claude Code，效率拉满。
        </h1>
        <p className="mv-hero__sub">
          在终端里用 CC，切窗口、翻记录、找配置全靠自己。Muxvo 帮你省掉这些时间。
        </p>
        <div className="mv-hero__actions">
          <a href={DOWNLOAD_URL} className="btn-amber btn-amber-lg">
            下载 macOS 版
          </a>
          <a
            href="https://github.com/muxvo/muxvo"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            GitHub 源码
          </a>
        </div>
      </div>

      {/* Real product screenshot */}
      <div className="mv-hero__mock fade-up">
        <div className="mv-mock">
          <div className="mv-mock__screenshot">
            <img
              src="/screenshots/dark-4terminals.jpg"
              alt="Muxvo terminal grid — multiple AI CLI sessions at a glance"
              loading="eager"
              width="2410"
              height="1608"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
