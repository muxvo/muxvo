export function Privacy() {
  return (
    <div style={{ background: 'var(--bg-after)' }} className="min-h-screen px-6 py-20">
      <article className="max-w-[720px] mx-auto legal-article">
        <h1>Muxvo 隐私政策</h1>
        <p className="legal-date">生效日期：2026 年 2 月 28 日</p>
        <p>感谢您使用 Muxvo。我们非常重视您的隐私，承诺以透明、负责任的方式处理您的数据。本政策说明我们收集哪些信息、如何使用，以及您拥有哪些权利。</p>

        <h2>一、我们是谁</h2>
        <p>Muxvo 是一款开源（MIT 许可证）的 Electron 桌面应用，旨在为 AI 命令行工具（Claude Code、Codex、Gemini CLI 等）提供统一的工作台界面。Muxvo 完全免费使用。</p>

        <h2>二、我们收集哪些数据</h2>
        <h3>账号信息</h3>
        <p>如果您注册账号，我们会收集邮箱地址、来自 GitHub / Google 的公开资料（用户名、头像等）、账号创建时间和最后登录时间。如果您不登录，Muxvo 的核心功能仍可正常使用。</p>

        <h3>Showcase 发布内容</h3>
        <p>当您主动选择通过 Showcase 功能发布展示内容时，相关内容会上传并存储在我们的服务器上。发布是完全自愿的，您随时可以撤回。</p>

        <h3>Skill 市场</h3>
        <p>当您安装或发布 Skill 时，我们会记录安装行为用于使用统计，发布内容会存储在服务器上。</p>

        <h3>匿名使用分析</h3>
        <p>为改善产品体验，我们收集匿名化的使用数据：页面浏览记录、功能使用频率、设备类型。这些数据不包含任何可识别您身份的信息，也不与账号关联。</p>

        <h2>三、我们不收集什么</h2>
        <p>以下内容我们明确不收集、不上传：</p>
        <ul>
          <li>您的源代码、项目文件</li>
          <li>~/.claude/、~/.codex/ 下的聊天记录和配置文件（仅在本地读取展示）</li>
          <li>终端输入/输出内容</li>
          <li>您与 AI 的对话内容</li>
          <li>您的 API 密钥或任何凭据</li>
        </ul>

        <h2>四、数据用途</h2>
        <p>我们收集的数据仅用于：提供账号登录和身份验证服务、展示 Showcase 内容、运营 Skill 市场、分析产品使用情况以改进功能、发送邮箱验证码。</p>
        <p>我们不会将您的数据出售给任何第三方。</p>

        <h2>五、第三方服务</h2>
        <p>Muxvo 使用以下第三方服务：</p>
        <ul>
          <li><strong>GitHub OAuth</strong>（GitHub, Inc.）— 用于 GitHub 账号登录</li>
          <li><strong>Google OAuth</strong>（Google LLC）— 用于 Google 账号登录</li>
          <li><strong>Resend</strong>（Resend, Inc.）— 用于发送邮箱验证码</li>
        </ul>
        <p>我们仅与这些服务共享完成功能所必需的最少信息。</p>

        <h2>六、数据存储位置</h2>
        <p>账号信息存储在阿里云香港地区的服务器上（PostgreSQL 数据库）。临时会话数据存储在 Redis 中，会话结束后自动清除。您的本地文件始终保存在您自己的设备上，不会被上传。</p>

        <h2>七、数据安全</h2>
        <p>我们采取以下措施保护您的数据：服务器通信全程使用 HTTPS 加密、用户认证使用 RS256 签名的 JWT Token、数据库访问受严格权限控制。尽管如此，互联网传输没有绝对安全的保障。如发现安全问题，请及时联系我们。</p>

        <h2>八、您的数据权利</h2>
        <p>您拥有以下权利：</p>
        <ul>
          <li><strong>查看</strong> — 您可以随时要求查看我们存储的账号信息</li>
          <li><strong>删除</strong> — 您可以要求删除账号及所有相关数据</li>
          <li><strong>撤回 Showcase</strong> — 您可以随时撤回发布的内容</li>
          <li><strong>关闭分析</strong> — 您可在应用设置中关闭匿名使用分析</li>
        </ul>
        <p>如需行使上述权利，请发送邮件至 <a href="mailto:support@muxvo.com">support@muxvo.com</a>。</p>

        <h2>九、Cookie 与本地存储</h2>
        <p>Muxvo 是桌面应用，不使用浏览器 Cookie。我们使用操作系统本地存储保存应用设置和登录状态，这些数据仅存储在您的设备上。</p>

        <h2>十、儿童隐私</h2>
        <p>Muxvo 面向 13 岁及以上用户。我们不会主动收集 13 岁以下儿童的个人信息。如果您认为我们误收了儿童的数据，请联系 <a href="mailto:support@muxvo.com">support@muxvo.com</a>，我们将立即删除。</p>

        <h2>十一、政策更新</h2>
        <p>我们可能会不定期更新本隐私政策。如有重大变更，我们会在应用内或通过邮件提前通知您。您可以随时在本页面查看最新版本。</p>

        <h2>十二、联系我们</h2>
        <p>如您对本隐私政策有任何疑问，请通过 <a href="mailto:support@muxvo.com">support@muxvo.com</a> 联系我们。</p>
      </article>
    </div>
  );
}
