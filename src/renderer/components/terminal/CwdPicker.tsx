/**
 * CwdPicker — QuickAccess 弹窗
 *
 * 功能:
 * - 快捷路径列表 (Home, Desktop, Documents)
 * - 浏览按钮 → 调用 selectDirectory
 * - 选择后判断进程类型:
 *   a. Shell → write cd 命令 + updateCwd
 *   b. 非 Shell → 回调 onConfirmExit
 * - Esc 键 / 点击外部 → 关闭
 */

import { useEffect, useRef } from 'react';
import { isShellProcess } from '@/shared/utils/shell-detect';
import './CwdPicker.css';

interface Props {
  terminalId: string;
  currentCwd: string;
  open: boolean;
  onClose: () => void;
  onCwdChange: (newCwd: string) => void;
  onConfirmExit?: (processName: string, targetCwd: string) => void;
}

// Helper: Escape shell path with backslash before spaces and special chars
function escapeShellPath(path: string): string {
  return path.replace(/([ ()&|;<>$`"'\\])/g, '\\$1');
}

export function CwdPicker({
  terminalId,
  currentCwd,
  open,
  onClose,
  onCwdChange,
  onConfirmExit,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const homePath = window.api.app.getHomePath();

  const quickPaths = [
    { label: '~ (Home)', path: homePath },
    { label: '~/Desktop', path: `${homePath}/Desktop` },
    { label: '~/Documents', path: `${homePath}/Documents` },
  ];

  // Handle Esc key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Handle click outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose]);

  const handleSelectPath = async (path: string) => {
    // Get foreground process
    const processResp = await window.api.terminal.getForegroundProcess(terminalId);
    if (!processResp.success || !processResp.data) {
      console.error('Failed to get foreground process');
      return;
    }

    const processName = processResp.data.name;

    // Check if it's a shell
    if (isShellProcess(processName)) {
      // Shell → write cd command + update cwd
      const cdCmd = `cd ${escapeShellPath(path)}\n`;
      window.api.terminal.write(terminalId, cdCmd);
      await window.api.terminal.updateCwd(terminalId, path);
      onCwdChange(path);
      onClose();
    } else {
      // Non-shell → call onConfirmExit callback
      if (onConfirmExit) {
        onConfirmExit(processName, path);
      }
      onClose();
    }
  };

  const handleBrowse = async () => {
    const result = await window.api.fs.selectDirectory();
    if (result.success && result.data) {
      await handleSelectPath(result.data as string);
    }
  };

  if (!open) return null;

  return (
    <div className="cwd-picker-overlay">
      <div className="cwd-picker" ref={popupRef}>
        <div className="cwd-picker-header">切换工作目录</div>
        <div className="cwd-picker-current">
          当前: <span className="cwd-picker-current-path">{currentCwd}</span>
        </div>
        <div className="cwd-picker-quick">
          <div className="cwd-picker-section-title">快捷路径</div>
          {quickPaths.map((item) => (
            <button
              key={item.path}
              className="cwd-picker-item"
              onClick={() => handleSelectPath(item.path)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="cwd-picker-browse">
          <button className="cwd-picker-browse-btn" onClick={handleBrowse}>
            浏览...
          </button>
        </div>
      </div>
    </div>
  );
}
