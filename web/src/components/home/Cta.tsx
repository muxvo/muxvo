import { useDownloadUrl } from '../../hooks/useDownloadUrl';

export function Cta() {
  const { url } = useDownloadUrl();

  return (
    <section className="mv-cta" id="download">
      <div className="mv-cta__glow" />
      <div className="mv-cta__inner fade-up">
        <h2 className="mv-cta__title">试试 Muxvo</h2>
        <div className="mv-cta__buttons">
          <a href={url} className="btn-amber btn-amber-lg">
            下载 macOS 版
          </a>
        </div>
        <p className="mv-cta__note">免费开源 · macOS · MIT License</p>
      </div>
    </section>
  );
}
