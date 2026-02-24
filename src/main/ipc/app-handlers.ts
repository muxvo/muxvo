import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { getPreferences, savePreferences } from '../services/app/preferences';
import { detectCliTools } from '../services/onboard/cli-detection';

export function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP.GET_PREFERENCES, async () => {
    return getPreferences();
  });

  ipcMain.handle(IPC_CHANNELS.APP.SAVE_PREFERENCES, async (_event, prefs) => {
    return savePreferences(prefs);
  });

  ipcMain.handle(IPC_CHANNELS.APP.DETECT_CLI_TOOLS, async () => {
    const result = await detectCliTools();
    // 格式转换: service 返回 { tools: Array<{name, installed, path?}> }
    // 前端期望 { claude: boolean; codex: boolean; gemini: boolean }
    return {
      claude: result.tools.some((t) => t.name === 'claude' && t.installed),
      codex: result.tools.some((t) => t.name === 'codex' && t.installed),
      gemini: result.tools.some((t) => t.name === 'gemini' && t.installed),
    };
  });
}
