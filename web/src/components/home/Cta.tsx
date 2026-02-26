const DOWNLOAD_URL = 'https://muxvo.com/download/Muxvo-arm64.dmg';

export function Cta() {
  return (
    <section className="mv-cta" id="download">
      <div className="mv-cta__glow" />
      <div className="mv-cta__inner fade-up">
        <h2 className="mv-cta__title">试试 Muxvo</h2>
        <div className="mv-cta__buttons">
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
        <p className="mv-cta__note">免费开源 · macOS · MIT License</p>
      </div>
    </section>
  );
}
