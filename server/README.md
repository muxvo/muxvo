# Muxvo Auth Server

Backend API for Muxvo desktop app authentication and user management.

## Tech Stack

- **Runtime:** Node.js 22
- **Framework:** Fastify v5 (TypeScript)
- **Database:** PostgreSQL 16
- **Cache:** Redis 7
- **Auth:** JWT RS256 (access + refresh token rotation), OAuth 2.0 PKCE

## Prerequisites

- Node.js 22+
- Docker (for PostgreSQL and Redis)

## Setup

```bash
cp .env.example .env  # fill in values
docker compose -f ../docker/docker-compose.dev.yml up -d  # start PG + Redis
npm install
npm run migrate:up
npm run dev
```

Generate JWT keys before first run (see `.env.example` for key paths):

```bash
openssl genpkey -algorithm RSA -out jwt-private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in jwt-private.pem -out jwt-public.pem
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server (production) |
| `npm run migrate:up` | Apply pending database migrations |
| `npm run migrate:down` | Roll back last migration |
| `npm test` | Run tests |

## API Routes

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (uptime, timestamp) |

### Auth (`/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/github/init` | Start GitHub OAuth flow |
| GET | `/auth/github/callback` | GitHub OAuth callback |
| POST | `/auth/google/init` | Start Google OAuth flow |
| GET | `/auth/google/callback` | Google OAuth callback |
| POST | `/auth/email/send` | Send email verification code |
| POST | `/auth/email/verify` | Verify email code, issue tokens |
| POST | `/auth/refresh` | Refresh access token (rotation) |
| POST | `/auth/logout` | Revoke refresh token |

### User (`/user`)

All routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/user/me` | Get current user profile |
| PATCH | `/user/me` | Update display name / avatar |
| DELETE | `/user/me` | Soft-delete account |

## Project Structure

```
server/
  src/
    app.ts              # Fastify app builder
    server.ts           # Entry point (listen)
    routes/
      health.ts         # GET /health
      auth.ts           # OAuth + email auth routes
      user.ts           # User profile routes
    middleware/
      auth.ts           # JWT Bearer authentication hook
    services/
      user.ts           # User find-or-create logic
      token.ts          # Token pair issuance and revocation
    lib/
      jwt.ts            # RS256 key loading, sign, verify
      errors.ts         # AppError hierarchy
    db/
      index.ts          # PostgreSQL connection pool
      redis.ts          # Redis client (ioredis)
      migrate.ts        # SQL migration runner
    plugins/
      db.ts             # Fastify plugin: migrations, pool, redis
  migrations/           # SQL migration files (001-006)
  Dockerfile            # Multi-stage production build
```

## Deployment

Production deployment uses Docker Compose. See `../docker/docker-compose.yml` for the full stack (api + postgres + redis).

```bash
# From the docker/ directory
docker compose up -d
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

- `DATABASE_URL` -- PostgreSQL connection string
- `REDIS_URL` -- Redis connection string
- `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` -- RSA key pair paths
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` -- GitHub OAuth app credentials
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` -- Google OAuth app credentials
