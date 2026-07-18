/**
 * settings 面板 live 注册（M6 批1，A2）：副作用模块——被 registerLivePanels.ts import 触发。
 * gear（PanelId 'settings'）→ SettingsModalLive。
 */
import { registerLivePanel } from './panelRegistry';
import { SettingsModalLive } from '../modal/SettingsModalLive';

registerLivePanel('settings', SettingsModalLive);
