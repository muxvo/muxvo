/**
 * 公开仓 overlay stub（编排物理剥离）：export-public.sh 覆盖同路径；taskcenter/ 其余文件由 exclude.txt 剔除。
 * registry.ts 保留 `'task-center': TaskCenterScreen` 登记项（核心屏注册表不改）→ 本 stub 令其解析。
 * 编排面板永不渲染（native 编排门控关死 panelMode==='taskCenter' 入口 + orchChannel overlay 亦返 null），
 * 且 tc-* golden / task-center fixture 已剔除、screens.json 的 task-center 屏条目已剥离 → visual-diff 不截此屏。
 * 本 stub 零编排 import（不引 logic/types/DetailRegion 等被剔除文件）。
 */
export function TaskCenterScreen(_props: { fx: unknown }): null {
  return null;
}
