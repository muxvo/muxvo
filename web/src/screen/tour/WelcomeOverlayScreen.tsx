/**
 * 首启欢迎全屏卡片屏（specs/behavior/welcome-overlay.md）。
 * 单组件挂载（screens.json 裁决#4）：overlay 直接盖 body 底色；零 payload 纯静态直渲
 * （文案/布局全静态，desc 的 \n 经 white-space: pre-line 换行）。
 */

import './welcome.css';

/** MAJOR-1 回修：双语表（legacy welcome.* en 键逐字）；locale 缺省 zh → golden（无 props）零变。 */
const WELCOME_STR = {
  zh: {
    title: '欢迎使用 Muxvo',
    desc: 'Muxvo 是为 AI CLI 工具打造的桌面工作台。\n接下来的快速导览将帮助你了解核心功能。',
    startTour: '开始导览',
    skip: '跳过，稍后再看',
  },
  en: {
    title: 'Welcome to Muxvo',
    desc: 'Muxvo is a desktop workbench for AI CLI tools.\nA quick tour will show you the core features.',
    startTour: 'Start Tour',
    skip: 'Skip for now',
  },
} as const;

// registry 以 {fx} 挂载（golden 路径 fx 无 locale → zh 零变）；live 直传 locale prop。
export function WelcomeOverlayScreen(
  { locale, fx }: { locale?: 'zh' | 'en'; fx?: { locale?: string } } = {},
): JSX.Element {
  const resolved: 'zh' | 'en' = locale ?? (fx?.locale === 'en' ? 'en' : 'zh');
  const t = WELCOME_STR[resolved];
  return (
    <div className="welcome-overlay">
      <div className="welcome-overlay__card">
        <h1 className="welcome-overlay__title">{t.title}</h1>
        <p className="welcome-overlay__desc">{t.desc}</p>
        <div className="welcome-overlay__actions">
          <button className="welcome-overlay__start-btn">{t.startTour}</button>
          <button className="welcome-overlay__skip-btn">{t.skip}</button>
        </div>
      </div>
    </div>
  );
}
