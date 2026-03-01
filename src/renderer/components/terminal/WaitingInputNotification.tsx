/**
 * WaitingInputNotification — Global floating notification when terminals
 * are in WaitingInput state and the user is on a non-terminal overlay.
 *
 * Follows the same position:fixed pattern as UpdateNotification.
 */

import { useState, useEffect } from 'react';
import { useI18n } from '@/renderer/i18n';

interface Props {
  waitingCount: number;
  overlayActive: boolean;
  onSwitchToTerminals: () => void;
}

const styles = {
  container: {
    position: 'fixed' as const,
    bottom: 16,
    right: 16,
    zIndex: 200,
    maxWidth: 280,
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    boxShadow: '0 4px 16px rgba(239, 68, 68, 0.15), var(--shadow-elevated)',
    padding: 12,
    fontSize: 13,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: '#ef4444',
    flexShrink: 0,
    animation: 'waitingDotPulse 1.5s ease-in-out infinite',
  },
  label: {
    flex: 1,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '0 2px',
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
  },
};

export function WaitingInputNotification({ waitingCount, overlayActive, onSwitchToTerminals }: Props) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed when waitingCount changes (new terminal needs attention)
  useEffect(() => {
    setDismissed(false);
  }, [waitingCount]);

  // Only show when terminals are waiting AND user can't see terminal tiles AND not dismissed
  if (waitingCount === 0 || !overlayActive || dismissed) return null;

  return (
    <div style={styles.container} onClick={onSwitchToTerminals}>
      <div style={styles.row}>
        <span style={styles.dot} />
        <span style={styles.label}>
          {waitingCount === 1
            ? `1 ${t('terminal.waitingInput')}`
            : `${waitingCount} ${t('terminal.waitingInput')}`}
        </span>
        <button
          style={styles.closeBtn}
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <style>{`
        @keyframes waitingDotPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px #ef4444; }
          50% { opacity: 0.5; box-shadow: 0 0 8px #ef4444; }
        }
      `}</style>
    </div>
  );
}
