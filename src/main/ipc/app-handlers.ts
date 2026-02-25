import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { getPreferences, savePreferences } from '../services/app/preferences';
import { detectCliTools } from '../services/app/cli-detection';

export function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP.GET_PREFERENCES, async () => {
    return getPreferences();
  });

  ipcMain.handle(IPC_CHANNELS.APP.SAVE_PREFERENCES, async (_event, prefs) => {
    return savePreferences(prefs);
  });

  ipcMain.handle(IPC_CHANNELS.APP.DETECT_CLI_TOOLS, async () => {
    const result = await detectCliTools();
    // 格式转换: service 返回 { detectedTools: Array<{name, path, version?}> }
    // 前端期望 { claude: boolean; codex: boolean; gemini: boolean }
    const detected = result.detectedTools.map((t: { name: string }) => t.name);
    return {
      claude: detected.includes('claude'),
      codex: detected.includes('codex'),
      gemini: detected.includes('gemini'),
    };
  });
}
