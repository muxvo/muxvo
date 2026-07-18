/**
 * 内置演示 fixture（仅人工预览用；视觉回归一律走 visual-diff 的 fixtures.json）
 */

import type { Fixture } from './types';

export const demoFixture: Fixture = {
  id: 'demo',
  desc: '本地预览：N=4 五态',
  theme: 'dark',
  homePath: '/Users/rl',
  viewMode: 'Tiling',
  focusedId: null,
  selectedId: 't4',
  activeSidebarId: null,
  maxReached: false,
  dragging: null,
  dragOver: null,
  editing: null,
  waitingNotification: null,
  searchBar: null,
  quitConfirm: null,
  palette: { background: '#1e1e1e', foreground: '#cccccc' },
  terminals: [
    {
      id: 't1',
      state: 'Running',
      cwd: '/Users/rl/dev/muxvo',
      customName: 'api-server',
      isGitRepo: true,
      content: [
        [{ t: '⏺ ', hex: '#0dbc79' }, { t: 'Demo fixture — 预览模式' }],
        [{ t: '  访问 ?screenshot=1 进入截图契约模式', hex: '#666666' }],
      ],
    },
    {
      id: 't2',
      state: 'WaitingInput',
      cwd: '/Users/rl/work/clients/acme/web-app',
      isGitRepo: true,
      content: [[{ t: 'Allow Bash to run this command?', hex: '#ffffff' }]],
    },
    {
      id: 't3',
      state: 'Stopped',
      cwd: '/opt/services/gateway',
      isGitRepo: false,
      content: [[{ t: 'rl@mbp % ', hex: '#0dbc79' }]],
    },
    {
      id: 't4',
      state: 'Running',
      cwd: '/Users/rl/work/clients/acme/web-app',
      isGitRepo: true,
      content: [[{ t: ' ✓ 23 passed', hex: '#0dbc79' }]],
    },
  ],
};
