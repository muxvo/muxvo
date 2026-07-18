# 行为规格：登录弹窗（LoginModal）

> 提炼自老 app 实际代码（components/auth/LoginModal.tsx 228 行 + LoginModal.css 494 行 +
> OAuthButton.tsx / PasswordLoginForm.tsx / AuthContext.tsx，2026-06-12 读取），**只记行为不抄结构**。
> 新实现是纯展示组件 + fixture props；OAuth/邮箱登录走桥（M5 账号系统），复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
login { mode: 'buttons' | 'login' }   // golden 两态；register/forgot-password 同骨架 dom-assert
```

## 1. 打开与 mode 状态机

- 挂载：AuthContext `state.loginModalOpen`（OPEN_LOGIN_MODAL / CLOSE_LOGIN_MODAL）；closed → null（:78）
- 4 mode（:14）：buttons（OAuth 入口，打开时重置回此态 :27-34）/ login / register / forgot-password
- mode 切换为组件内 state：buttons 的「账号密码登录」→ login；login 的 links → register / forgot；
  back 键：forgot → login，其余 → buttons（:93）
- **条款守卫**（:37-44）：未勾选同意时任何登录动作先弹二层 `__terms-confirm`（同意并继续 → 执行原动作）。
  golden 侧 lg-form 即经此真实路径（点邮箱按钮 → 点同意）抵达 login 态
- 错误条 `__error-bar`（state.error 非空，3s 自动清除 :72-76）/ loading 蒙层 + spinner（:220-224）
  / terms-confirm 层 / register/forgot 表单 → **dom-assert**

## 2. DOM 结构与样式（LoginModal.css）

`.login-modal__backdrop > .login-modal > [__header] [__error-bar?] [__body] [__terms-confirm-backdrop?] [__loading?]`

- `__backdrop`：fixed inset 0、z-index 500、bg rgba(0,0,0,.5)、blur(4px)、flex 居中
- `.login-modal`：position relative、**宽 380px**、max-width 90vw、bg `var(--bg-elevated)`、
  border 1px `var(--border)`、圆角 12px、`var(--shadow-dialog)`、overflow hidden
- `__header`：flex 两端、padding `16px 20px 0`；左槽 = buttons 态空 `<span/>`，
  其余态 `__back-btn`（28×28 透明底圆角 6px、‹ chevron svg 16×16）；
  `__title` 16px 700 `var(--font-sans)`；右 `__close-btn`（28×28、✕ svg 16×16）
- `__body`：padding 20px、flex column gap 10px
- 标题按 mode（:80-84）：buttons=`auth.modalTitle`「Muxvo 登录」/ login=「登录」/
  register=「创建账号」/ forgot=「重置密码」

### buttons 态（OAuth 按钮组）

- `__oauth-btn` ×3（github/google/email，OAuthButton.tsx）：满宽 flex 居中 gap 10px、
  padding `10px 16px`、圆角 8px、13px 600、border 1px `var(--border)`、bg `var(--bg-card)`、
  字 `var(--text-primary)`；icon 18×18（github currentColor 实心 / google 四色 / email 线框信封）
- 文案：使用 GitHub 登录 / 使用 Google 登录 / 账号密码登录

### login 态（PasswordLoginForm.tsx + links）

- `__email-form`：flex column gap 10px；`__field > __input`（flex 1、padding `8px 12px`、圆角 6px、
  border `var(--border)`、bg `var(--bg-input)`、13px；placeholder 色 `var(--text-muted)`）
  ×2：邮箱地址 / 密码（type=password）
- 登录按钮 `__login-btn`：bg `var(--accent)` 字 `var(--bg-deep)` 12px 600、padding `8px 14px` 圆角 6px、
  inline style `width:100%; margin-top:4px`；**email 空/密码空 → disabled（opacity .5）**（canSubmit :21）
- `__links`：flex 两端 mt 8px；`__link` 12px `var(--accent)` 无边框：创建账号 / 忘记密码？

## 3. golden 与 dom-assert

- `lg-buttons`：mode=buttons（三 OAuth 按钮 + 标题「Muxvo 登录」+ 右✕、左空槽）
- `lg-form`：mode=login（back 键 + 标题「登录」+ 空表单 + disabled 登录钮 + 双链接）
- dom-assert（后续批落 vitest，本批仅记录）：register/forgot-password 表单、terms-confirm 二层、
  error-bar、loading spinner

## 4. 文案

屏级文案表取 legacy locales/zh.ts auth.*（lg 两张 golden 均 zh）

## 5. live 接线（右上角批 B5，2026-07-13——登录回归 V1 全量实装）

> ⚠️ **2026-07-15 用户指示：登录入口隐藏（live-only，feature 保留可回开）**。开关
> `web/src/config/features.ts` `LOGIN_UI_ENABLED=false` → MenuBar auth 槽（小人 icon/头像
> 下拉）不渲染、LoginModalLive 挂载门死；golden 视觉件走 prop 默认值零动（lg-*/mb-* 全保）。
> 起因：dogfood 弹窗关不掉、按钮无响应——根因=LoginModalLive 根包裹 div 挂 data-hit-island
> 但自身 0 高度（fixed 全屏是内层 backdrop）→ 岛 0×0 → native 判不可见 → 点击穿透终端
> （onboarding-hit-fixes 欢迎卡 bug ① 同型，本批只藏不修）。e2e item54 调用点同步摘除
> （E2EScenarioAuth.swift 保留）。**重开清单**：翻 LOGIN_UI_ENABLED + 恢复 item54 调用
> + 修 LoginModalLive 根节点 hit-island 几何。以下 §5/§6.1 描述隐藏前的完整实装，仍为权威。

〔2026-07-13 用户拍板〕D5「移出 V1」仅指 Skill 市场，登录本体完整实现。桥挂法/后端/深链不做等
架构裁决见 bridge-v1.md §8 AUTH 段。分层：

- **golden 视觉件 `LoginModalScreen` 加性扩渲**：register / forgot-password 表单、`__terms-confirm`
  二层、`__error-bar`、`__loading`——全部由新 `fx.login` optional 字段门控（旧 fixture 缺席 →
  旧 DOM 逐字节不变，lg-* golden 冻结安全）；样式照 legacy LoginModal.css 逐值加性入 modals.css。
- **`LoginModalLive`** 持状态机（事件委托 + 非受控 input）：mode 机（back：forgot→login、其余→
  buttons）/ 条款守卫（agreed 内存态每开重置；链接经 openExternal 系统浏览器）/ 错误条稳定码→中文
  （auth-strings.ts）+3s 自清 / 验证码 6 位剥非数字 + 60s 冷却 / Enter 提交 / Esc·✕·backdrop 关闭 /
  登录成功（authStatusChanged → auth.loggedIn）自关。
- **native**：`MuxvoAuth` target（AuthManager @MainActor 单例 + AuthBackendClient
  api.muxvo.com/MUXVO_API_URL + AuthTokenStore 明文 0600 原子写落分身数据根 auth-token.json）+
  `AuthRequestRouter` 薄路由（AppDelegate onAppRequest 分流）；OAuth=init→NSWorkspace 开浏览器→
  轮询 /auth/poll 2s×60；12min 定时预刷新，失败→authSessionExpired；启动 tryRestoreSession 三段。
- **MenuBar/UserDropdown live**：auth 态经 AuthContext（挂载拉 authStatus + 订阅推送）；头像下拉
  开合/外点关/登出（尽力吊销+本地必登出）；聊天历史 chrome 同显（loginIntent 信箱开弹窗）。

### 6.1 案例池（spec-coverage 强制 1:1）

| 用例名 | 断言 |
| --- | --- |
| AUTH_password_login_flow | 密码登录 → /user/me 档案 → 推送 + token 0600 落盘 |
| AUTH_password_login_rejected | 401 → AUTH_INVALID_CREDENTIALS 稳定码，不入登录态 |
| AUTH_oauth_poll_flow | init 开浏览器（注入缝）→ 轮询 pending→tokens → adopt 推送 |
| AUTH_restore_three_stage | 启动恢复三段：access 直验/refresh 换对/双败清 token |
| AUTH_logout_local_always | 服务端吊销失败也本地登出（清 token+推送未登录） |
| AUTH_reset_no_autologin | 重置成功不自动登录（legacy 服务端吊销全部 token） |
| AUTH_error_code_map | 服务端文案 → 稳定码映射（凭据/验证码/占用/限频/兜底） |
| AUTH_token_store_corrupt | 损坏 token 文件 → load nil + 清文件强制重登 |
| AUTH_refresh_rotation | 12min 刷新档触发 → 新 token 对落盘（登录态保持） |
| AUTH_refresh_expiry | 刷新失败 → 清 token + sessionExpired 推送 |
| AUTH_UI_mode_machine | buttons⇄login/register/forgot mode 机 + legacy back 规则 |
| AUTH_UI_terms_guard | 未同意先弹二层；取消不执行；同意执行挂起动作 |
| AUTH_UI_error_autoclear | rejected → 中文错误条 → 3s 自清 |
| AUTH_UI_cooldown | 发送验证码 → 60s 冷却 disabled + 每秒递减 |
| AUTH_UI_locale_en | cfg.language=en → 标题/按钮全英文（MAJOR-1 回修，legacy en.ts 逐字） |
| AUTH_e2e_full_chain | e2e item54 真机：icon→表单+守卫→推送→头像→登出回环 |
