# Deploy Step 2: Phase 4 — Electron 发布流水线

> 审查日期: 2026-02-26

## 审查结果总结

Phase 4 发布流水线代码层面已完备，无需修改。以下是各组件的审查状态。

---

## 1. electron-builder.yml 审查

**状态: 通过**

| 配置项 | 值 | 说明 |
|--------|---|------|
| `appId` | `com.muxvo.app` | 标准 reverse-domain |
| `publish.provider` | `github` | autoUpdater 通过 GitHub Releases 分发 |
| `publish.owner/repo` | `muxvo/muxvo` | 与仓库一致 |
| `mac.hardenedRuntime` | `true` | 公证必须 |
| `mac.identity` | 自动检测（可通过 CSC_NAME 覆盖） | 从钥匙串自动选择 |
| `mac.notarize` | `true` | 从 APPLE_TEAM_ID 环境变量读取 |
| `mac.entitlements` | `build/entitlements.mac.plist` | JIT + unsigned memory + disable lib validation |
| `mac.target` | `dmg` (arm64) | 需要 x64 时取消注释即可 |

electron-builder v25 内置 `@electron/notarize`，`notarize.teamId` 配合环境变量 `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` 即可自动公证。

---

## 2. release.yml 工作流审查

**状态: 通过**

工作流文件: `.github/workflows/release.yml`

### 触发条件
- `push.tags: 'v*'` — 推送 `v0.1.0` 等 tag 时触发

### Jobs 流程
1. **test** (macos-14): `npm ci` → `npm test`
2. **build-mac** (macos-14, depends on test):
   - 导入 Apple 签名证书到临时 Keychain
   - `npx electron-vite build && npx electron-builder --mac --arm64 --publish never`
   - 使用 `softprops/action-gh-release@v2` 上传产物到 GitHub Releases

### GitHub Secrets 引用清单 (5 个)

| Secret | 用途 | 使用位置 |
|--------|------|---------|
| `APPLE_CERTIFICATE` | .p12 证书 base64 编码 | 证书导入步骤 |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 导出密码 | 证书导入步骤 |
| `APPLE_ID` | Apple Developer 邮箱 | 公证步骤 (env) |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple App 专用密码 | 公证步骤 (env) |
| `APPLE_TEAM_ID` | 你的 Team ID | 公证步骤 (env) |

另外 `GITHUB_TOKEN` 由 GitHub Actions 自动提供，无需手动配置。

---

## 3. autoUpdater 实现审查

**状态: 通过**

文件: `src/main/index.ts` (行 354-392)

### 配置
- `autoUpdater.autoDownload = true` — 发现更新自动下载
- `autoUpdater.autoInstallOnAppQuit = true` — 退出时自动安装
- 仅在生产环境运行 (`!is.dev`)

### 事件监听 (6/6 完整)

| 事件 | IPC Channel | 推送数据 |
|------|-------------|---------|
| `checking-for-update` | `app:update-checking` | `{}` |
| `update-available` | `app:update-available` | `{ version, releaseDate }` |
| `update-not-available` | `app:update-not-available` | `{}` |
| `download-progress` | `app:update-downloading` | `{ percent, bytesPerSecond, transferred, total }` |
| `update-downloaded` | `app:update-downloaded` | `{ version }` |
| `error` | `app:update-error` | `{ message }` |

### 手动安装
- `IPC_CHANNELS.APP.INSTALL_UPDATE` handler (行 345-347) 调用 `autoUpdater.quitAndInstall()`

---

## 4. 首次发布操作手册

### 前置条件

1. **Apple Developer Program 已加入**
2. **GitHub 仓库 muxvo/muxvo** 有 admin 权限

### Step 1: 导出 Apple 签名证书

```bash
# 1. 打开 Keychain Access
# 2. 找到 "Developer ID Application: <DEVELOPER_NAME> (<TEAM_ID>)"
# 3. 右键 → 导出 → 保存为 certificate.p12，设置强密码

# 4. 转换为 base64
base64 -i certificate.p12 | tr -d '\n' > cert-base64.txt

# cert-base64.txt 的内容 → APPLE_CERTIFICATE secret
# 导出时设置的密码 → APPLE_CERTIFICATE_PASSWORD secret
```

### Step 2: 生成 App 专用密码

1. 访问 [appleid.apple.com](https://appleid.apple.com) → 登录
2. 安全 → App 专用密码 → 生成
3. 命名为 "Muxvo GitHub Actions"
4. 保存密码 → `APPLE_APP_SPECIFIC_PASSWORD` secret

### Step 3: 配置 GitHub Secrets

在 `github.com/muxvo/muxvo/settings/secrets/actions` 添加 5 个 Secret:

| Secret 名称 | 值的来源 |
|-------------|---------|
| `APPLE_CERTIFICATE` | Step 1 的 cert-base64.txt 内容 |
| `APPLE_CERTIFICATE_PASSWORD` | Step 1 导出 .p12 时设置的密码 |
| `APPLE_ID` | Apple Developer 账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Step 2 生成的 App 专用密码 |
| `APPLE_TEAM_ID` | 你的 Team ID |

### Step 4: 触发首次发布

```bash
# 确保在 main 分支，代码已推送
git checkout main
git pull

# 确认 package.json version 为 0.1.0
grep '"version"' package.json

# 创建并推送 tag
git tag v0.1.0
git push origin v0.1.0
```

### Step 5: 监控构建

1. 打开 `github.com/muxvo/muxvo/actions` 查看 Release workflow
2. 预期耗时 10-15 分钟
3. 构建成功后检查 `github.com/muxvo/muxvo/releases`
4. 确认产物包含:
   - `Muxvo-0.1.0-arm64.dmg`
   - `Muxvo-0.1.0-arm64.dmg.blockmap`
   - `latest-mac.yml`

### Step 6: 验证自动更新

1. 安装 v0.1.0 DMG
2. 修改 `package.json` version 为 `0.1.1`
3. `git tag v0.1.1 && git push origin v0.1.1`
4. 等待 v0.1.1 构建完成
5. 重启已安装的 v0.1.0 应用
6. 预期行为:
   - 应用启动后自动检查更新
   - 显示 "发现新版本 0.1.1" 提示
   - 自动下载完成后提示安装
   - 退出应用时自动安装新版本

---

## 5. 本地构建验证

本地构建命令:

```bash
npx electron-vite build && npx electron-builder --mac --arm64
```

> 注: 本地构建需要 Keychain 中有有效的 Developer ID Application 证书。
> 如果只需验证编译，可加 `--publish never` 跳过上传。

---

## 6. 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 签名失败: "no identity found" | 证书未导入 CI Keychain | 检查 `APPLE_CERTIFICATE` base64 编码是否正确 |
| 公证失败: "invalid credentials" | App 专用密码过期或错误 | 重新生成 App 专用密码并更新 Secret |
| 公证失败: "invalid signature" | entitlements 缺失 | 确认 `build/entitlements.mac.plist` 存在 |
| 自动更新不工作 | `publish` 配置不匹配 | 确认 `electron-builder.yml` 中 owner/repo 正确 |
| DMG 被 Gatekeeper 拦截 | 公证未完成 | 检查 Actions 日志中 notarytool 输出 |
| `latest-mac.yml` 缺失 | `--publish never` + 手动上传遗漏 | 确保上传步骤包含 `dist/latest-mac.yml` |
