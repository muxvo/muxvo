# Muxvo 云端部署 — 全阶段实施计划

## Context

Muxvo Electron 客户端功能基本完成（534 测试，0 TS 错误）。后端 Fastify 服务器代码已写好（auth 路由、DB 迁移、JWT、Docker 配置全部就绪），但**从未实际部署到服务器**。需要按序完成：清理 Git → 部署后端 → 构建前端页面 → App 发布流水线。

**服务器**: 47.86.240.83（阿里云香港 ECS，建议升配 2核4GB）
**域名**: muxvo.com（已有）

---

## 当前完成度总览

| 组件 | 完成度 | 说明 |
|------|--------|------|
| Electron 客户端 | 97% | 功能完整，534 测试通过 |
| 后端 auth 路由 | 100% | GitHub/Google/Email 登录全部实现 |
| 后端 user 路由 | 100% | GET/PATCH/DELETE /me |
| DB 迁移 (6 张表) | 100% | users, identities, refresh_tokens, email_verifications, showcases, analytics |
| JWT (RS256) | 100% | 密钥已生成，签发/验证完整 |
| Docker Compose | 100% | 生产 + 开发环境配置完整 |
| Nginx 配置 | 100% | 三域名 + SSL + Rate Limit |
| CI/CD Workflows | 100% | ci.yml + deploy-server.yml + deploy-web.yml + release.yml |
| 邮件发送服务 | 100% | Resend API 已实现 |
| web/ 官网 | 90% | Home + Discover 页已上线 |
| admin/ 管理后台 | 5% | 空壳 Dashboard + Users 页 |
| Git 仓库整洁度 | 差 | 3.2GB，node_modules 在历史中，无 remote |

---

## Phase 0: Git 清理与开源准备

### 为什么先做这步
当前 git 仓库 3.2GB（node_modules 被追踪），且无 remote。不清理就无法 push 到 GitHub，CI/CD 也跑不起来。

### 任务清单

| # | 任务 | 操作 |
|---|------|------|
| 0.1 | 创建 GitHub Organization | 浏览器创建 `muxvo` org |
| 0.2 | 创建两个仓库 | `muxvo/muxvo` (Public) + `muxvo/server` (Private) |
| 0.3 | 新建干净的 git 仓库 | 在新目录 `git init`，只复制源文件（排除 node_modules/dist/.git） |
| 0.4 | 配置 .gitignore | 复用现有 .gitignore（已完善） |
| 0.5 | 添加开源文件 | LICENSE (MIT) + README.md + CONTRIBUTING.md + CHANGELOG.md |
| 0.6 | 分离 server 代码 | server/ 目录单独初始化为 `muxvo/server` 仓库 |
| 0.7 | 轮换密钥 | 重新生成 JWT RS256 密钥对 + GitHub OAuth Secret（旧的在 git 历史中暴露） |
| 0.8 | 首次推送 | `git push -u origin main` 两个仓库 |

### 验证
- `muxvo/muxvo` 仓库大小 < 50MB
- `muxvo/server` 仓库大小 < 5MB
- `git log` 历史中无 node_modules 或 .env
- CI workflow 在 push 后自动触发

---

## Phase 1: 服务器初始化与后端部署

### 为什么这步在前
后端 API 是官网和客户端的基础。先让 `api.muxvo.com/health` 跑通。

### 任务清单

| # | 任务 | 操作 |
|---|------|------|
| 1.1 | 升配服务器 | 阿里云控制台：2核2GB → 2核4GB |
| 1.2 | 系统初始化 | SSH 登录，安装 Docker + Docker Compose + Nginx + git + certbot |
| 1.3 | 安全加固 | 防火墙仅 22/80/443，SSH Key 登录，禁密码 |
| 1.4 | 创建 swap | 2GB swap 作为内存安全网 |
| 1.5 | DNS 解析 | 阿里云 DNS：muxvo.com / api.muxvo.com / admin.muxvo.com → 47.86.240.83 |
| 1.6 | SSL 证书 | `certbot --nginx -d muxvo.com -d www.muxvo.com -d api.muxvo.com -d admin.muxvo.com` |
| 1.7 | 部署 Nginx 配置 | 复制 `docker/nginx/conf.d/muxvo.conf` 到服务器 |
| 1.8 | 部署后端 | 在服务器 `/opt/muxvo-server/` 执行 `docker compose up -d` |
| 1.9 | 运行 DB 迁移 | `docker compose exec api npm run migrate:up` |
| 1.10 | 配置 .env | 在服务器手动创建 `/opt/muxvo-server/.env`，填入生产环境变量 |
| 1.11 | 补充邮件发送 | 实现 `server/src/routes/auth.ts:435` 的 TODO：接入阿里云 DirectMail 或 Resend |
| 1.12 | 配置 GitHub Actions Secrets | SERVER_SSH_KEY, SERVER_HOST, SERVER_USER |

### 验证
- `curl https://api.muxvo.com/health` → `{"status":"ok"}`
- `curl -X POST https://api.muxvo.com/auth/github/init` → 返回 authUrl
- GitHub Actions `deploy-server.yml` 手动触发成功
- PostgreSQL 6 张表已创建

### 关键文件
- `server/src/routes/auth.ts` — 第 435 行需实现邮件发送
- `server/.env.example` — 参考配置模板
- `docker-compose.yml` — 生产环境编排
- `docker/nginx/conf.d/muxvo.conf` — Nginx 配置
- `.github/workflows/deploy-server.yml` — 部署流水线

---

## Phase 2: 官网 (muxvo.com)

### 为什么在 admin 之前
官网是面向用户的第一接触点，也是下载入口。

### 任务清单

| # | 任务 | 操作 |
|---|------|------|
| 2.1 | 选定设计 | 基于 `landing-designs-v2/11-split-persona-final.html` |
| 2.2 | 搭建 web/ 项目 | React 19 + Vite + Tailwind CSS + React Router |
| 2.3 | 首页 (/) | Hero + 功能亮点 + 截图 + Download 按钮（→ GitHub Releases） |
| 2.4 | 发现页 (/discover) | 技能展示列表（初期可用静态数据，后续接 API） |
| 2.5 | 响应式适配 | 桌面 + 平板 + 手机 |
| 2.6 | 部署 | `npm run build` → rsync 到 `/var/www/muxvo-web/` |

### 验证
- `https://muxvo.com` 加载首页，无 404
- `https://muxvo.com/discover` 发现页正常
- Download 按钮正确跳转 GitHub Releases
- 手机端 Safari 布局正常

### 关键文件
- `web/src/pages/Home.tsx` — 当前空壳，需重写
- `web/src/pages/Discover.tsx` — 当前空壳，需重写
- `landing-designs-v2/11-split-persona-final.html` — 设计原型
- `.github/workflows/deploy-web.yml` — 自动部署

---

## Phase 3: 管理后台 (admin.muxvo.com)

### 任务清单

| # | 任务 | 操作 |
|---|------|------|
| 3.1 | 搭建 admin/ 项目 | React 19 + Vite + Tailwind + React Router |
| 3.2 | 登录页 | 管理员身份验证（复用后端 auth API） |
| 3.3 | Dashboard 页 | 用户统计、注册趋势图、活跃用户数 |
| 3.4 | 用户管理页 | 用户列表 + 搜索 + 禁用/删除操作 |
| 3.5 | 后端 admin 路由 | 实现 `server/src/app.ts` 中注释的 admin 路由插件 |
| 3.6 | 部署 | `npm run build` → rsync 到 `/var/www/muxvo-admin/` |

### 验证
- `https://admin.muxvo.com` 加载登录页
- 管理员登录后看到 Dashboard 数据
- 用户列表分页正常

### 关键文件
- `admin/src/pages/Dashboard.tsx` — 当前空壳
- `admin/src/pages/Users.tsx` — 当前空壳
- `server/src/app.ts` — 第 29-31 行注释的路由需解注释并实现

---

## Phase 4: Electron App 发布流水线

### 任务清单

| # | 任务 | 操作 |
|---|------|------|
| 4.1 | 安装 electron-updater | `npm i electron-updater` |
| 4.2 | 实现自动更新逻辑 | `src/main/index.ts` 添加 autoUpdater 初始化 |
| 4.3 | 开启公证 | `electron-builder.yml` 中 `notarize: true` |
| 4.4 | 配置 GitHub Secrets | APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID |
| 4.5 | 测试发布 | 打 `v0.1.0` tag → 触发 release.yml → GitHub Releases 出现 DMG |
| 4.6 | 测试自动更新 | 安装 v0.1.0 → 发 v0.1.1 → 客户端弹出更新提示 |

### 验证
- GitHub Releases 有 DMG + blockmap + latest-mac.yml
- DMG 可正常安装（已签名 + 公证）
- 旧版本客户端检测到新版本并提示更新

### 关键文件
- `electron-builder.yml` — 第 23 行 `notarize: false` 需改 true
- `src/main/index.ts` — 添加 autoUpdater
- `.github/workflows/release.yml` — 已配置，需 Secrets 就绪

---

## Phase 5: Electron 客户端联调真实后端

### 任务清单

| # | 任务 | 操作 |
|---|------|------|
| 5.1 | 配置后端 URL | `src/main/services/auth/backend-client.ts` 中 baseUrl 指向 `https://api.muxvo.com` |
| 5.2 | Deep Link 注册 | `muxvo://` 协议注册（electron-builder + macOS info.plist） |
| 5.3 | OAuth 回调处理 | `src/main/index.ts` 添加 deep link 事件监听 |
| 5.4 | 端到端测试 | GitHub 登录 → 回调 → token 存储 → 刷新 → 退出 |
| 5.5 | Google OAuth 测试 | 同上流程 |
| 5.6 | Email 登录测试 | 发送验证码 → 输入 → 登录成功 |

### 验证
- 三种登录方式全部走通
- Token 自动刷新正常（等待 12 分钟验证）
- 退出后 token 清除
- 断网后重连能恢复会话

### 关键文件
- `src/main/services/auth/backend-client.ts` — baseUrl 配置
- `src/main/services/auth/auth-manager.ts` — 协调逻辑
- `docs/auth-frontend-design.md` — 前端改造详细设计

---

## 推荐执行顺序

```
Phase 0 (Git 清理)  ← 必须最先，否则无法 push
   ↓
Phase 1 (服务器部署)  ← 后端是一切基础
   ↓
Phase 2 (官网)  ← 面向用户的入口
   ↓
Phase 4 (App 发布)  ← 官网需要下载链接
   ↓
Phase 3 (管理后台)  ← 内部工具，优先级最低
   ↓
Phase 5 (客户端联调)  ← 需要后端在线
```

Phase 2 和 Phase 4 可并行。Phase 3 可延后到有实际运营需求时再做。

---

## 安全检查清单

- [ ] JWT 密钥对已轮换（旧的在 git 历史中暴露）
- [ ] GitHub OAuth Secret 已轮换
- [ ] 服务器 SSH Key 登录，密码已禁用
- [ ] 防火墙仅 22/80/443
- [ ] Docker 端口仅绑定 127.0.0.1
- [ ] .env 不入 Git
- [ ] PG 每日备份（crontab + pg_dump）
