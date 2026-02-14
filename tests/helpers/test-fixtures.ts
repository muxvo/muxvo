/**
 * 测试数据 Fixtures
 *
 * 来源：docs/Muxvo_测试_v2/02_appendix/coverage.md 附录 C
 */

// --- 终端相关 ---

export const terminalFixtures = {
  validCwd: '/Users/test/project',
  invalidCwd: '/nonexistent/path',
  cwdNoPermission: '/root/restricted',
  shellList: ['bash', 'zsh', 'fish'] as const,
  aiToolList: ['claude', 'codex', 'gemini'] as const,
};

export const gridFixtures = [
  { count: 1, expectedCols: 1, expectedRows: 1, layout: '1x1 全屏' },
  { count: 2, expectedCols: 2, expectedRows: 1, layout: '2x1 对半' },
  { count: 3, expectedCols: 3, expectedRows: 1, layout: '3x1 三等分' },
  { count: 4, expectedCols: 2, expectedRows: 2, layout: '2x2 四宫格' },
  { count: 5, expectedCols: 3, expectedRows: 2, layout: '上3下2' },
  { count: 6, expectedCols: 3, expectedRows: 2, layout: '3x2 六宫格' },
  { count: 7, expectedCols: 3, expectedRows: 3, layout: 'ceil(sqrt7)=3 列' },
  { count: 20, expectedCols: 5, expectedRows: 4, layout: 'ceil(sqrt20)=5 列' },
] as const;

// --- 富编辑器相关 ---

export const asbSignals = {
  enterRaw: '\x1b[?1049h',
  exitRaw: '\x1b[?1049l',
};

export const textForwardFixtures = {
  claudeCode: {
    separator: '\x1b\r', // ESC+CR
    submit: '\r',
    multiline: 'line1\x1b\rline2\x1b\rline3\r',
  },
  shell: {
    separator: null,
    submit: '\n',
    multiline: 'line1\nline2\nline3\n',
  },
};

export const imageFixtures = {
  validPng: { format: 'PNG' as const, size: 1024 * 1024 },
  validJpg: { format: 'JPG' as const, size: 2 * 1024 * 1024 },
  tooLarge: { format: 'PNG' as const, size: 6 * 1024 * 1024 },
  invalidFormat: { format: 'BMP' as const, size: 1024 },
};

// --- 聊天历史相关 ---

export const jsonlFixtures = {
  validLine: '{"type":"human","content":"hello"}\n',
  invalidLine: '{invalid json}\n',
  incompleteLine: '{"type":"human","content":"hello"',
  emptyLine: '\n',
  multiLine: [
    '{"type":"human","content":"Q1"}\n',
    '{"type":"assistant","content":"A1"}\n',
    '{"type":"human","content":"Q2"}\n',
  ].join(''),
};

export const searchFixtures = {
  debounceMs: 300,
  largeFileThreshold: 100 * 1024 * 1024,
  indexTimeoutSingle: 30000,
  indexTimeoutTotal: 300000,
};

export const chatLayoutFixtures = {
  leftMin: 180,
  centerMin: 280,
  rightMin: 400,
  leftCollapsed: 60,
};

// --- AI 评分相关 ---

export const scoreDimensions = [
  { name: '实用性', weight: 0.25 },
  { name: '工程质量', weight: 0.25 },
  { name: '意图清晰度', weight: 0.10 },
  { name: '设计巧妙度', weight: 0.10 },
  { name: '文档完善度', weight: 0.15 },
  { name: '可复用性', weight: 0.15 },
] as const;

export const gradeMap = [
  { range: [0, 39] as const, grade: 'Promising' },
  { range: [40, 59] as const, grade: 'Solid' },
  { range: [60, 79] as const, grade: 'Advanced' },
  { range: [80, 94] as const, grade: 'Expert' },
  { range: [95, 100] as const, grade: 'Masterwork' },
] as const;

export const scoreTolerance = 2;

// --- 安全检查相关 ---

export const securityPatterns = {
  apiKeyBlock: [/sk-[a-zA-Z0-9]+/, /ghp_[a-zA-Z0-9]+/, /token_[a-zA-Z0-9]+/],
  hardcodedPathWarn: [/\/Users\/[^/]+\//, /\/home\/[^/]+\//],
  sensitiveFileBlock: ['.env', 'credentials.json', '*.pem', '*.key'],
  fileSizeWarn: {
    skill: 1 * 1024 * 1024,
    plugin: 10 * 1024 * 1024,
  },
};

// --- 时间常量 ---

export const timeConstants = {
  jsonlReadDelay: 200,
  searchDebounce: 300,
  filePanelTransition: 300,
  watchRetryInterval: 3000,
  watchRetryMax: 3,
  processStopTimeout: 5000,
  memoryCheckInterval: 60000,
  updateCheckInterval: 6 * 60 * 60 * 1000,
  tempFileCleanup: 24 * 60 * 60 * 1000,
  analyticsRetention: 90,
  analyticsSummaryRetention: 365,
  memoryWarningThreshold: 2 * 1024 * 1024 * 1024,
};

// --- 默认值 ---

export const defaultConfig = {
  window: { width: 1400, height: 900 },
  font: { size: 14 },
  theme: 'dark' as const,
  tile: {
    border: 'var(--border)',
    opacity: 1,
    columnRatios: [1, 1],
    rowRatios: [1, 1],
  },
};
