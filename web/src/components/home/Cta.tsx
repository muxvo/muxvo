const DOWNLOAD_URL = 'https://github.com/muxvo/muxvo/releases/latest/download/Muxvo-arm64.dmg';
const GITHUB_URL = 'https://github.com/muxvo/muxvo';

export function Cta() {
  return (
    <section className="cta" id="download">
      <div className="cta-glow" />
      <p className="cta-lead fade-up">还在终端和配置文件之间来回切换？</p>
      <h2 className="cta-headline fade-up">掌控全局。</h2>
      <div className="cta-buttons fade-up">
        <a href={DOWNLOAD_URL} className="btn-amber btn-amber-lg">
          Download for macOS
        </a>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost">
          View on GitHub
        </a>
      </div>
      <p className="cta-note fade-up">免费开源 / macOS / MIT License</p>
    </section>
  );
}
