# Muxvo Deployment Secrets Checklist

All secrets required for production deployment. Generate fresh values for each environment.

## JWT Authentication Keys

- [ ] Generate RS256 key pair: `openssl genrsa -out jwt-private.pem 2048`
- [ ] Extract public key: `openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem`
- [ ] Place on server: `/opt/muxvo-server/jwt-private.pem` (mode 600, owned by app user)
- [ ] Place on server: `/opt/muxvo-server/jwt-public.pem` (mode 644)
- [ ] Set `JWT_PRIVATE_KEY_PATH` and `JWT_PUBLIC_KEY_PATH` in `.env`
- [ ] Set `JWT_KEY_ID` to a versioned identifier (e.g. `muxvo-auth-key-v2`)

## GitHub OAuth

Register a new OAuth App at https://github.com/settings/developers

- [ ] Set Authorization callback URL to `https://api.muxvo.com/auth/github/callback`
- [ ] Copy Client ID to `GITHUB_CLIENT_ID`
- [ ] Generate and copy Client Secret to `GITHUB_CLIENT_SECRET`
- [ ] Set `GITHUB_CALLBACK_URL` in `.env`

## Google OAuth

Register at https://console.cloud.google.com/apis/credentials

- [ ] Create OAuth 2.0 Client ID (type: Web application)
- [ ] Add authorized redirect URI: `https://api.muxvo.com/auth/google/callback`
- [ ] Copy Client ID to `GOOGLE_CLIENT_ID`
- [ ] Copy Client Secret to `GOOGLE_CLIENT_SECRET`
- [ ] Set `GOOGLE_CALLBACK_URL` in `.env`

## Database (PostgreSQL)

- [ ] Generate a strong random password (32+ chars): `openssl rand -base64 32`
- [ ] Create database user: `CREATE USER muxvo WITH PASSWORD '...'`
- [ ] Create database: `CREATE DATABASE muxvo_prod OWNER muxvo`
- [ ] Set `DATABASE_URL=postgresql://muxvo:<password>@localhost:5432/muxvo_prod`

## Redis

- [ ] If exposed beyond localhost, set a password: `requirepass` in redis.conf
- [ ] Set `REDIS_URL=redis://:<password>@localhost:6379` (password optional for localhost-only)

## GitHub Actions / CI Secrets

Set these in the GitHub repo Settings > Secrets and variables > Actions:

- [ ] `SERVER_SSH_KEY` -- Private SSH key for deployment target
- [ ] `SERVER_HOST` -- Deployment server IP or hostname
- [ ] `APPLE_ID` -- Apple Developer account email
- [ ] `APPLE_APP_SPECIFIC_PASSWORD` -- App-specific password for notarization
- [ ] `APPLE_TEAM_ID` -- Apple Developer Team ID
- [ ] `APPLE_CERTIFICATE_BASE64` -- Base64-encoded .p12 signing certificate
- [ ] `APPLE_CERTIFICATE_PASSWORD` -- Password for the .p12 certificate

## App Configuration

- [ ] `APP_SCHEME=muxvo` -- Custom URL scheme for OAuth redirects back to desktop app
- [ ] `NODE_ENV=production`
- [ ] `PORT=3000` (or as needed behind reverse proxy)
- [ ] `HOST=0.0.0.0`

---

Total secrets to provision: ~20. Never commit secrets to git.
