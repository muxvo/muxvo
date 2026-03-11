import { ipcMain, app } from 'electron';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { getPreferences, savePreferences } from '../services/app/preferences';
import { detectCliTools } from '../services/app/cli-detection';
import { parseChangelog, type ReleaseEntry } from '@/shared/utils/changelog-parser';

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

  ipcMain.handle(IPC_CHANNELS.APP.GET_RELEASE_NOTES, async (_event, params?: { locale?: string }): Promise<ReleaseEntry[]> => {
    try {
      const lang = params?.locale === 'en' ? 'en' : 'zh';
      const filename = `CHANGELOG.${lang}.md`;
      const changelogPath = is.dev
        ? join(app.getAppPath(), filename)
        : join(process.resourcesPath, filename);
      const content = await readFile(changelogPath, 'utf-8');
      return parseChangelog(content);
    } catch {
      return [];
    }
  });
}
