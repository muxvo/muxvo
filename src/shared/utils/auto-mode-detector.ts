/**
 * Auto mode detector - detects ASB signals and TUI processes for editor mode switching
 */

const ASB_ENTER = '\x1b[?1049h';
const ASB_EXIT = '\x1b[?1049l';

const TUI_PROGRAMS = [
  'htop', 'top', 'vim', 'nvim', 'nano', 'less', 'more', 'man',
  'tmux', 'screen', 'mc', 'ranger', 'tig', 'lazygit',
];

interface DetectionResult {
  modeSwitch: boolean;
  targetMode?: string;
  trigger?: string;
}

export function createAutoModeDetector() {
  return {
    onTerminalOutput(data: string): DetectionResult {
      if (data.includes(ASB_ENTER)) {
        return {
          modeSwitch: true,
          targetMode: 'RawTerminal',
          trigger: 'asb_enter',
        };
      }
      if (data.includes(ASB_EXIT)) {
        return {
          modeSwitch: true,
          targetMode: 'RichEditor',
          trigger: 'asb_exit',
        };
      }
      return { modeSwitch: false };
    },

    onForegroundProcessChange(processName: string): DetectionResult {
      const name = processName.toLowerCase();
      if (TUI_PROGRAMS.includes(name)) {
        return {
          modeSwitch: true,
          targetMode: 'RawTerminal',
          trigger: 'process_name',
        };
      }
      return { modeSwitch: false };
    },
  };
}
