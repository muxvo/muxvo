# Deploy Step 1: Phase 1 收尾 — 服务器安全补齐

## 1. PostgreSQL 每日备份

### 脚本

`scripts/backup-db.sh` — 通过 `docker exec muxvo-postgres pg_dump` 导出并 gzip 压缩，保留最近 7 天。

### 部署步骤

```bash
# 1. 在服务器上创建备份目录
sudo mkdir -p /opt/muxvo-backups
sudo chown $(whoami) /opt/muxvo-backups

# 2. 复制脚本到服务器（如果通过 CI/CD 部署则已包含）
# 确认脚本有执行权限
chmod +x /opt/muxvo-server/scripts/backup-db.sh

# 3. 手动测试一次
/opt/muxvo-server/scripts/backup-db.sh

# 4. 添加 crontab（每天凌晨 3 点执行）
crontab -e
# 添加以下行：
# 0 3 * * * /opt/muxvo-server/scripts/backup-db.sh >> /var/log/muxvo-backup.log 2>&1

# 5. 验证 crontab 已生效
crontab -l | grep muxvo-backup
```

### 备份恢复

```bash
# 解压并恢复
gunzip -c /opt/muxvo-backups/muxvo_20260226_030000.sql.gz | \
  docker exec -i muxvo-postgres psql -U muxvo -d muxvo
```

---

## 2. Secrets 状态清单

基于 `docs/secrets-checklist.md` 和 `deployment-plan.md` Phase 0.7 的要求，逐项核查：

### JWT Authentication Keys

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | RS256 私钥 `jwt-private.pem` | **已完成** | Phase 0.7 已重新生成，docker-compose.yml 挂载为 readonly |
| 2 | RS256 公钥 `jwt-public.pem` | **已完成** | 同上 |
| 3 | 私钥权限 mode 600 | **待确认** | 登录服务器执行 `stat -c '%a' /opt/muxvo-server/jwt-private.pem` 确认 |
| 4 | `JWT_KEY_ID` | **已完成** | `.env.example` 中为 `muxvo-auth-key-v1`，生产中应已设置 |

### GitHub OAuth

| # | Item | Status | Notes |
|---|------|--------|-------|
| 5 | OAuth App 创建 | **已完成** | callback URL 指向 `api.muxvo.com` |
| 6 | `GITHUB_CLIENT_ID` | **已完成** | 已填入服务器 `.env` |
| 7 | `GITHUB_CLIENT_SECRET` | **需要轮换** | Phase 0.7 提到旧 secret 在 git 历史中暴露过，需确认是否已在 Phase 0 中轮换。若未轮换，必须立即操作（见下方操作指南） |
| 8 | `GITHUB_CALLBACK_URL` | **已完成** | `https://api.muxvo.com/auth/github/callback` |

### Google OAuth

| # | Item | Status | Notes |
|---|------|--------|-------|
| 9 | OAuth 2.0 Client 创建 | **已完成** | Google Cloud Console |
| 10 | `GOOGLE_CLIENT_ID` | **已完成** | 已填入服务器 `.env` |
| 11 | `GOOGLE_CLIENT_SECRET` | **已完成** | 新仓库无历史泄露风险 |
| 12 | `GOOGLE_CALLBACK_URL` | **已完成** | `https://api.muxvo.com/auth/google/callback` |

### Database (PostgreSQL)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 13 | DB 密码强度 | **待确认** | 确认 `DB_PASSWORD` 为 32+ 字符随机字符串 |
| 14 | `DATABASE_URL` | **已完成** | docker-compose.yml 通过 `${DB_PASSWORD}` 注入 |
| 15 | DB 仅 localhost | **已完成** | docker-compose.yml 端口绑定 `127.0.0.1:5432` |

### Redis

| # | Item | Status | Notes |
|---|------|--------|-------|
| 16 | Redis 仅 localhost | **已完成** | docker-compose.yml 端口绑定 `127.0.0.1:6379` |
| 17 | Redis 无密码（localhost-only） | **可接受** | 仅本机访问，无需密码 |

### GitHub Actions / CI Secrets

| # | Item | Status | Notes |
|---|------|--------|-------|
| 18 | `SERVER_SSH_KEY` | **已完成** | Phase 1.12 已配置 |
| 19 | `SERVER_HOST` | **已完成** | Phase 1.12 已配置 |
| 20 | `APPLE_ID` | **待配置** | Apple 发布流水线（Phase 4）时配置 |
| 21 | `APPLE_APP_SPECIFIC_PASSWORD` | **待配置** | 同上 |
| 22 | `APPLE_TEAM_ID` | **待配置** | 同上 |
| 23 | `APPLE_CERTIFICATE_BASE64` | **待配置** | 同上 |
| 24 | `APPLE_CERTIFICATE_PASSWORD` | **待配置** | 同上 |

### App Configuration

| # | Item | Status | Notes |
|---|------|--------|-------|
| 25 | `NODE_ENV=production` | **已完成** | docker-compose.yml environment 中设置 |
| 26 | `PORT=3000` | **已完成** | `.env.example` 默认值 |
| 27 | `APP_SCHEME=muxvo` | **已完成** | `.env.example` 已有 |

### Email (Resend)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 28 | `RESEND_API_KEY` | **待确认** | `.env.example` 中为空，确认生产环境已填入 |
| 29 | `EMAIL_FROM` | **已完成** | `noreply@muxvo.com` |

---

## 3. 需要立即操作的项目

### 3.1 确认 GitHub OAuth Secret 轮换状态

`deployment-plan.md` Phase 0.7 明确要求"重新生成 GitHub OAuth Secret（旧的在 git 历史中暴露）"。

**操作指南**（如未轮换）：

```bash
# 1. 访问 https://github.com/settings/developers
# 2. 找到 Muxvo OAuth App
# 3. 点击 "Generate a new client secret"
# 4. 复制新 secret
# 5. 更新服务器 .env
ssh muxvo-server
vim /opt/muxvo-server/server/.env
# 修改 GITHUB_CLIENT_SECRET=<new_secret>

# 6. 重启 API 容器
cd /opt/muxvo-server/docker
docker compose restart api

# 7. 验证 GitHub 登录仍然正常
curl https://api.muxvo.com/health
# 在 Muxvo App 中测试 GitHub 登录流程
```

### 3.2 确认私钥文件权限

```bash
ssh muxvo-server
stat -c '%a %U' /opt/muxvo-server/jwt-private.pem
# 期望输出: 600 <app-user>
# 如果不对:
chmod 600 /opt/muxvo-server/jwt-private.pem
```

### 3.3 确认 DB 密码强度

```bash
ssh muxvo-server
# 检查密码长度（不输出密码本身）
grep DB_PASSWORD /opt/muxvo-server/server/.env | awk -F= '{print length($2)}'
# 期望: >= 32
```

### 3.4 确认 Resend API Key

```bash
ssh muxvo-server
grep RESEND_API_KEY /opt/muxvo-server/server/.env | awk -F= '{print length($2)}'
# 期望: > 0 (有值)
# 测试邮件发送:
curl -X POST https://api.muxvo.com/auth/email/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

---

## 4. 总结

| 分类 | 已完成 | 待确认 | 待配置 |
|------|--------|--------|--------|
| JWT | 2 | 2 | 0 |
| GitHub OAuth | 3 | 1 (secret 轮换) | 0 |
| Google OAuth | 4 | 0 | 0 |
| Database | 2 | 1 (密码强度) | 0 |
| Redis | 2 | 0 | 0 |
| CI/CD | 2 | 0 | 5 (Apple 相关，Phase 4) |
| App Config | 3 | 0 | 0 |
| Email | 1 | 1 (Resend key) | 0 |
| DB 备份 | 0 | 0 | 1 (本次新增) |
| **合计** | **19** | **5** | **6** |

Phase 1 安全基线中，核心 secrets 基本就位。**需要人工登录服务器确认 4 项**（JWT 私钥权限、GitHub Secret 轮换状态、DB 密码强度、Resend Key）。Apple 相关的 5 项 CI secrets 属于 Phase 4 范畴，不阻塞当前。
