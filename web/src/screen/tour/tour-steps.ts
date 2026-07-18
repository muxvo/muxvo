/**
 * 引导步骤数据（specs/behavior/tour-overlay.md §1，数据驱动；dom-assert 数据源）。
 * side 全 'bottom'、interactive 全 true、showButtons 全 ['close']——推进依赖真实用户动作
 * （无 Next 钮），锚点为生产布局元素 class。步 3 选择器为逗号列表：未命名走 placeholder。
 */

export interface TourStepSpec {
  id: string;
  selector: string;
  title: string;
  desc: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  interactive: boolean;
  showButtons: ('next' | 'previous' | 'close')[];
}

export const TOUR_STEPS: TourStepSpec[] = [
  {
    id: 'create-terminal',
    selector: '.terminal-grid__fab',
    title: '新建终端',
    desc: '点击 + 按钮，创建你的第一个终端吧！',
    side: 'bottom',
    interactive: true,
    showButtons: ['close'],
  },
  {
    id: 'focus-terminal',
    selector: '.tile-max-btn',
    title: '聚焦终端',
    desc: '试试点击这个蓝色按钮，把终端最大化为聚焦模式！',
    side: 'bottom',
    interactive: true,
    showButtons: ['close'],
  },
  {
    // 高亮**实际可点元素** `.tile-name-clickable`（onClick→beginRename 在此层，TileHeader.tsx）——
    // 而非内层小 span `.tile-custom-name--placeholder`（发布阻断回修 fix/welcome-overlay-island）：driver
    // spotlight 按 selector 挖洞+stagePadding，若高亮内层小 span 则洞覆盖到 clickable 之外，用户点洞边缘落
    // 非可点区 → 不进编辑态、卡第三步（真机命中不稳定）。高亮可点层令洞≈命中区，点洞即触发重命名。
    // clickable 同时含未命名 placeholder 与已命名 custom-name 两态（原逗号列表两选择器合一）。
    id: 'rename-terminal',
    selector: '.tile-name-clickable',
    title: '重命名终端',
    desc: '点击这里为终端起个名字，方便在多个终端间快速识别。',
    side: 'bottom',
    interactive: true,
    showButtons: ['close'],
  },
  {
    id: 'open-files',
    selector: '.tile-file-btn',
    title: '打开文件',
    desc: '点击"文件"按钮，打开当前目录的文件浏览器！',
    side: 'bottom',
    interactive: true,
    showButtons: ['close'],
  },
];
