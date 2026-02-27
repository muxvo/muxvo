import { useState, useEffect } from 'react';

type UpdateState = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

const styles = {
  container: {
    position: 'fixed' as const,
    bottom: 16,
    right: 16,
    zIndex: 200,
    maxWidth: 280,
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-elevated)',
    padding: 12,
    fontSize: 13,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  rowBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dot: (color: string) => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: color,
    flexShrink: 0,
  }),
  progressTrack: {
    height: 4,
    width: '100%' as const,
    borderRadius: 2,
    backgroundColor: 'var(--bg-hover)',
    marginTop: 6,
  },
  progressBar: (pct: number) => ({
    height: 4,
    borderRadius: 2,
    backgroundColor: 'var(--info)',
    transition: 'width 0.3s ease',
    width: `${pct}%`,
  }),
  button: {
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    backgroundColor: 'var(--info)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  errorText: {
    color: 'var(--error)',
  },
};

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const cleanups = [
      window.api.app.onUpdateAvailable((data) => {
        setVersion(data.version);
        setState('available');
      }),
      window.api.app.onUpdateDownloading((data) => {
        setPercent(Math.round(data.percent));
        setState('downloading');
      }),
      window.api.app.onUpdateDownloaded((data) => {
        setVersion(data.version);
        setState('downloaded');
      }),
      window.api.app.onUpdateError((data) => {
        setErrorMsg(data.message);
        setState('error');
      }),
    ];
    return () => cleanups.forEach(fn => fn());
  }, []);

  // >>> TEMP DEMO: 模拟更新流程，演示完删除 (replay) <<<
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => { setVersion('0.3.0'); setState('available'); }, 3000));
    timers.push(setTimeout(() => { setPercent(15); setState('downloading'); }, 5000));
    timers.push(setTimeout(() => { setPercent(45); }, 6000));
    timers.push(setTimeout(() => { setPercent(78); }, 7000));
    timers.push(setTimeout(() => { setPercent(100); }, 8000));
    timers.push(setTimeout(() => { setVersion('0.3.0'); setState('downloaded'); }, 9000));
    return () => timers.forEach(clearTimeout);
  }, []);
  // >>> END TEMP DEMO <<<

  // Auto-dismiss error after 5s
  useEffect(() => {
    if (state === 'error') {
      const timer = setTimeout(() => setState('idle'), 5000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  if (state === 'idle') return null;

  return (
    <div style={styles.container}>
      {state === 'available' && (
        <div style={styles.row}>
          <span style={styles.dot('var(--info)')} />
          <span>新版本 {version} 正在下载...</span>
        </div>
      )}
      {state === 'downloading' && (
        <div>
          <div style={styles.row}>
            <span style={styles.dot('var(--info)')} />
            <span>下载更新中 {percent}%</span>
          </div>
          <div style={styles.progressTrack}>
            <div style={styles.progressBar(percent)} />
          </div>
        </div>
      )}
      {state === 'downloaded' && (
        <div style={styles.rowBetween}>
          <div style={styles.row}>
            <span style={styles.dot('var(--success)')} />
            <span>v{version} 已就绪</span>
          </div>
          <button
            onClick={() => window.api.app.installUpdate()}
            style={styles.button}
          >
            重启更新
          </button>
        </div>
      )}
      {state === 'error' && (
        <div style={styles.row}>
          <span style={styles.dot('var(--error)')} />
          <span style={styles.errorText}>更新失败: {errorMsg}</span>
        </div>
      )}
    </div>
  );
}
