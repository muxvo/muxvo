/**
 * live-only feature 开关（golden 视觉件不读本模块：golden 走组件 prop 默认值渲染，
 * 开关只由 live chrome 接线处消费，翻值不动任何 golden 字节）。
 */

/**
 * 登录 UI 入口（MenuBar 小人 icon / 头像下拉 / LoginModalLive 挂载）。
 *
 * 2026-07-15 用户指示隐藏：当前无登录必要（Skill 市场 D5 已裁不做），且弹窗存在
 * 点击穿透 bug 未修——LoginModalLive 根包裹 div 挂 data-hit-island 但自身 0 高度
 * （fixed 全屏的是内层 backdrop）→ 岛几何 0×0 → native 判不可见 → 点击穿透终端，
 * 弹窗关不掉、按钮无响应（与 onboarding-hit-fixes 欢迎卡 bug ① 同型）。
 *
 * 重开清单：翻此值为 true + 恢复 e2e item54（E2EScenario.swift 调用点）
 * + 修 LoginModalLive 根节点 hit-island 几何（挪到 backdrop 或包裹层自身 fixed 全屏）。
 */
export const LOGIN_UI_ENABLED = false;
