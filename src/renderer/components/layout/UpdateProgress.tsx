/**
 * UpdateProgress — Circular progress indicator in MenuBar during update download.
 * Shows a ring + arrow icon while downloading, checkmark when done, then fades out.
 * Hover reveals a tooltip with size and speed details.
 */

import { useState, useEffect } from 'react';
import './UpdateProgress.css';

type UpdateState = 'idle' | 'downloading' | 'done' | 'error';

interface DownloadInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateProgress(): JSX.Element | null {
  const [state, setState] = useState<UpdateState>('idle');
  const [info, setInfo] = useState<DownloadInfo>({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
  const [version, setVersion] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsubDownloading = window.api.app.onUpdateDownloading((data) => {
      setState('downloading');
      setInfo(data);
      setVisible(true);
    });

    const unsubDownloaded = window.api.app.onUpdateDownloaded((data) => {
      setState('done');
      setVersion(data.version);
      setVisible(true); // Ensure visible even if download-progress never fired
      setTimeout(() => setVisible(false), 3000);
    });

    const unsubError = window.api.app.onUpdateError(() => {
      setState('error');
      setVisible(true); // Show error even if download-progress never fired
      setTimeout(() => setVisible(false), 3000);
    });

    return () => {
      unsubDownloading();
      unsubDownloaded();
      unsubError();
    };
  }, []);

  if (!visible) return null;

  // Ring circumference = 2 * PI * r (r=9)
  const circumference = 56.55;
  const offset = state === 'downloading'
    ? circumference * (1 - info.percent / 100)
    : state === 'done' ? 0 : circumference;

  const stateClass = state === 'done' ? ' update-progress--done' :
    state === 'error' ? ' update-progress--error' :
    '';
  const fadeClass = state === 'done' || state === 'error' ? ' update-progress--fade-out' : '';

  return (
    <div className={`update-progress${stateClass}${fadeClass}`}>
      <svg className="update-progress__ring" viewBox="0 0 24 24">
        <circle className="update-progress__ring-track" cx="12" cy="12" r="9" />
        <circle
          className="update-progress__ring-fill"
          cx="12" cy="12" r="9"
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <span className="update-progress__icon">
        {state === 'done' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : state === 'error' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" /><path d="M19 12l-7 7-7-7" />
          </svg>
        )}
      </span>

      <div className="update-progress__tooltip">
        <div className="update-progress__tooltip-title">
          {state === 'downloading' && '正在下载更新...'}
          {state === 'done' && `v${version} 下载完成`}
          {state === 'error' && '下载失败'}
        </div>
        {state === 'downloading' && (
          <>
            <div className="update-progress__tooltip-bar">
              <div className="update-progress__tooltip-bar-fill" style={{ width: `${info.percent}%` }} />
            </div>
            <div className="update-progress__tooltip-info">
              <span>{formatBytes(info.transferred)} / {formatBytes(info.total)}</span>
              <span className="update-progress__tooltip-speed">{formatBytes(info.bytesPerSecond)}/s</span>
            </div>
          </>
        )}
        {state === 'done' && (
          <div className="update-progress__tooltip-info">
            <span>下次启动时自动更新</span>
          </div>
        )}
      </div>
    </div>
  );
}
