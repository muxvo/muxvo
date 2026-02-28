import { useDownloadUrl } from '../../hooks/useDownloadUrl';

export function Cta() {
  const { url, arch, archLabel, altUrl, altLabel } = useDownloadUrl();

  return (
    <section className="mv-cta" id="download">
      <div className="mv-cta__glow" />
      <div className="mv-cta__inner fade-up">
        <h2 className="mv-cta__title">试试 Muxvo</h2>
        <div className="mv-cta__buttons">
          <a href={url} className="btn-amber btn-amber-lg">
            下载 macOS 版{arch !== 'unknown' && <span style={{ fontSize: '0.75em', opacity: 0.7, marginLeft: '0.4em' }}>({archLabel})</span>}
          </a>
          <a
            href={altUrl}
            className="text-xs transition-colors duration-150 hover:underline"
            style={{ color: 'var(--text-after-sec)' }}
          >
            {altLabel} 版下载
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
