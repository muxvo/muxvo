# Muxvo 发布流程配置指南

## 1. 导出 Apple 签名证书

### 步骤
1. 打开 **钥匙串访问** (Keychain Access)
2. 在"我的证书"中找到 `Apple Development: <DEVELOPER_NAME> (<TEAM_ID>)` 或 `Developer ID Application: <DEVELOPER_NAME> (<TEAM_ID>)`
3. 右键 → 导出 → 保存为 `.p12` 文件，设置一个强密码
4. 转换为 base64：
   ```bash
   base64 -i certificate.p12 | tr -d '\n' > cert-base64.txt
   ```
5. `cert-base64.txt` 的内容即为 `APPLE_CERTIFICATE` secret 的值

## 2. 生成 App 专用密码

1. 访问 [appleid.apple.com](https://appleid.apple.com)
2. 登录 → 安全 → App 专用密码 → 生成
3. 命名为 "Muxvo GitHub Actions"
4. 保存生成的密码

## 3. 配置 GitHub Actions Secrets

在 [github.com/muxvo/muxvo/settings/secrets/actions](https://github.com/muxvo/muxvo/settings/secrets/actions) 添加：

| Secret 名称 | 值 | 来源 |
|-------------|---|------|
| `APPLE_CERTIFICATE` | .p12 证书的 base64 编码 | 步骤 1 导出 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时设置的密码 | 步骤 1 设置 |
| `APPLE_ID` | Apple Developer 账号邮箱 | developer.apple.com |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 | 步骤 2 生成 |
| `APPLE_TEAM_ID` | 你的 Team ID | developer.apple.com → 成员资格 |
| `SERVER_SSH_KEY` | Phase 1 已配置 | — |
| `SERVER_HOST` | Phase 1 已配置 | — |

## 4. 发布流程

### 首次发布
```bash
# 确保代码已推送到 main
git tag v0.1.0
git push origin v0.1.0
```

### 后续发布
```bash
# 更新 package.json version
npm version patch   # 0.1.0 → 0.1.1
git push && git push --tags
```

### 工作流程
1. 推送 `v*` tag 触发 `.github/workflows/release.yml`
2. CI 运行测试 (macos-14)
3. 构建 + 签名 + 公证 DMG (macos-14)
4. 上传到 GitHub Releases (DMG + blockmap + latest-mac.yml)

### 自动更新
- 已安装的 Muxvo 客户端在启动时自动检查 GitHub Releases
- 发现新版本 → 自动下载 → 退出时安装
- 用户也可在 UI 中手动触发安装

## 5. 验证清单

- [ ] 5 个 Apple Secrets 已配置到 muxvo/muxvo 仓库
- [ ] `git tag v0.1.0 && git push origin v0.1.0` 触发 workflow
- [ ] GitHub Actions 构建成功（约 10-15 分钟）
- [ ] GitHub Releases 页面出现 DMG 文件
- [ ] 下载的 DMG 双击安装无 Gatekeeper 警告
- [ ] 应用启动后自动检查更新

## 6. 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 签名失败 | 证书 base64 不正确 | 重新导出，确保 `tr -d '\n'` 去除换行 |
| 公证失败 | App 专用密码过期 | 重新生成 App 专用密码 |
| 自动更新不工作 | `publish` 配置错误 | 检查 electron-builder.yml 中 owner/repo |
| DMG 被 Gatekeeper 拦截 | 公证未完成或 staple 失败 | 检查 Actions 日志中 notarytool 输出 |
