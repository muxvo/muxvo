import { useDownloadUrl } from '../../hooks/useDownloadUrl';

export function Hero() {
  const { url, arch, archLabel, altUrl, altLabel } = useDownloadUrl();

  return (
    <section className="mv-hero">
      {/* Ambient glow */}
      <div className="mv-hero__glow" />

      {/* Text block */}
      <div className="mv-hero__text">
        <p className="mv-hero__eyebrow">为 Claude Code 重度用户打造</p>
        <h1 className="mv-hero__title">
          驾驭你的 Agent 军团
        </h1>
        <p className="mv-hero__sub">
          Claude Code、Codex、Gemini CLI，开多少个都不乱。
        </p>
        <div className="mv-hero__actions">
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
