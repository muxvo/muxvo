const DOWNLOAD_URL =
  'https://github.com/muxvo/muxvo/releases/latest/download/Muxvo-arm64.dmg';

export function Cta() {
  return (
    <section className="mv-cta" id="download">
      <div className="mv-cta__glow" />
      <div className="mv-cta__inner fade-up">
        <p className="mv-cta__lead">还在终端窗口之间来回切换？</p>
        <h2 className="mv-cta__title">掌控全局。</h2>
        <div className="mv-cta__buttons">
          <a href={DOWNLOAD_URL} className="btn-amber btn-amber-lg">
            Download for macOS
          </a>
          <a
            href="https://github.com/muxvo/muxvo"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            View on GitHub
          </a>
        </div>
        <p className="mv-cta__note">免费开源 · macOS · MIT License</p>
      </div>
    </section>
  );
}
