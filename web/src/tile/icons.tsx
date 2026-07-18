/**
 * Header 线性图标（视觉资产，与老 app 像素一致的 SVG 形状）
 */

export function FolderIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" fillOpacity="0.2" />
      <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" fill="none" strokeWidth="1.5" />
    </svg>
  );
}

export function MaximizeIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

export function CollapseIcon(): JSX.Element {
  // 折叠边栏（双左向 chevron «）：语义 = 把展开的收起边栏收回细条（MinimizedRail 展开态顶部钮）。
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 6 7 12 13 18" />
      <polyline points="19 6 13 12 19 18" />
    </svg>
  );
}

export function ExpandIcon(): JSX.Element {
  // 展开边栏（双右向 chevron »，CollapseIcon 镜像）：语义 = 把折叠细条展开为卡片列表
  //（MinimizedRail 折叠态顶部钮；dogfood 反馈 2026-07-13：圆点=直接恢复，展开唯一入口=本钮）。
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="11 6 17 12 11 18" />
      <polyline points="5 6 11 12 5 18" />
    </svg>
  );
}

export function MinimizeIcon(): JSX.Element {
  // 收起（靠下横杠 ▁，macOS 最小化语义；2026-07-12 用户二次改版定因：原对角收拢 ⤡ 两收缩箭头与
  // 聚焦 ⤢ 两放大箭头太易混淆被否，改九选一稿方案 2「底线 ▁」）。尺寸/描边照旧（12×12 viewBox24
  // strokeWidth2），线性图标族；横线 y=19 贴下方不居中。
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="19" x2="19" y2="19" />
    </svg>
  );
}

export function BranchIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export function SmallBranchIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export function GridIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function ListIcon(): JSX.Element {
  // 列表 ☰（视图切换幽灵钮，列表模式 dogfood 追加 2026-07-12）：左侧选中条 + 三行文本，
  // 与 GridIcon ▦ 成 Tiling↔List 对偶。12×12 viewBox24 strokeWidth2，线性图标族。
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <line x1="13" y1="6" x2="21" y2="6" />
      <line x1="13" y1="12" x2="21" y2="12" />
      <line x1="13" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
