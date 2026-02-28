# Workflow & Build Config Audit Report

Date: 2026-02-25

## Files Reviewed

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-server.yml`
- `.github/workflows/deploy-web.yml`
- `.github/workflows/release.yml`
- `electron-builder.yml`

---

## 1. ci.yml

### Issues

- **Line 14: `runs-on: macos-14`** -- CI runs on macOS ARM64 runners. These are more expensive and slower to provision than `ubuntu-latest`. Since the test suite does not require macOS-specific APIs (no native compilation, no Electron runtime needed for unit tests), this wastes CI minutes. The only reason to keep macOS would be if `node-pty` native compilation is tested, but `npm test` uses vitest with mocks.
- **Lines 28-33: Redundant test step** -- `npm run verify:coverage` is called explicitly (line 29), then `npm test` is called (line 33). But `verify:coverage` already runs as a `pretest` hook (per CLAUDE.md / package.json). This means spec verification runs twice per CI run.
- **No server/ tests** -- The workflow only runs root-level `npm test`. If `server/` has its own test suite, it is not covered by CI.

### Recommendations

- Switch `runs-on` to `ubuntu-latest` for CI. Keep `macos-14` only in `release.yml` where native builds are required.
- Remove the explicit `verify:coverage` step since `npm test` already triggers it via `pretest`.
- Add a separate job or step for `cd server && npm ci && npm test` if the server has tests.

---

## 2. deploy-server.yml

### Issues

- **Line 25-30: Uploads entire repo** -- `rsync ./ root@...:/opt/muxvo-server/` uploads the full monorepo (Electron app source, web/, admin/, tests/, docs/) to the server. Only `server/` and `docker/` are needed for the server deployment.
- **Line 26: Incomplete exclusions** -- Only `node_modules`, `.env`, and `.git` are excluded. Sensitive files like `*.p12`, `*.pem`, private keys, or `.github/` secrets references are not excluded. The `--delete` flag means anything manually placed on the server outside the repo will be removed.
- **Line 44-46: Fragile health check** -- A single `curl -f` after a fixed 5-second `sleep` is fragile. If the container takes longer to start (e.g., during migrations), the health check will fail and the workflow will report failure even though the deployment will eventually succeed. No retry logic.
- **Line 34-35: Build on production server** -- `docker compose build` runs on the production machine. If the build fails mid-way, the previous containers have already been stopped by `docker compose up -d`. This can cause downtime. Better to build first, then bring up.

### Recommendations

- Scope rsync to `server/` and `docker/` only, or switch to a `--include/--exclude` pattern.
- Add exclusions for `*.p12`, `*.pem`, `.github/`, `docs/`, `tests/`, `web/`, `admin/`, `src/`.
- Replace the single health check with a retry loop (e.g., 5 attempts with 3-second intervals).
- Separate `docker compose build` from `docker compose up -d` and only bring up after a successful build.
- **Post-repo-split**: This workflow should be moved to the server repo entirely. It will no longer need to live in the Electron app repo.

---

## 3. deploy-web.yml

### Issues

- **Lines 27-30: No error isolation** -- `cd web && npm ci && npm run build` chains three commands. If `npm ci` fails (e.g., registry timeout), the step fails but there is no distinction between install failure and build failure. Same for admin (line 30). This is minor but makes debugging harder.
- **No build artifact caching** -- Each deploy re-runs `npm ci` for both web/ and admin/ without caching node_modules. The `cache: npm` on line 24 only caches the npm download cache, not the installed `node_modules`.
- **Lines 8-10: Path filter may miss shared deps** -- The `paths` filter triggers on `web/**`, `admin/**`, and `docker/nginx/**`. If there are shared dependencies or configs at the root level that affect web/admin builds, those changes would not trigger a deploy.

### Recommendations

- Consider splitting web and admin builds into separate steps with clearer error messages.
- Add `package-lock.json` to the paths trigger list if web/admin share root-level dependencies.
- **Post-repo-split**: If web/ and admin/ stay in the server repo, update paths accordingly.

---

## 4. release.yml

### Issues

- **Lines 69-81 vs electron-builder.yml line 23: Notarization inconsistency** -- The workflow has an explicit notarization step using `xcrun notarytool` (lines 74-81), but `electron-builder.yml` sets `notarize: false` (line 23). This means electron-builder will NOT notarize during the build step, and the workflow's separate notarization step submits the DMG to Apple afterward. This actually works correctly as a two-phase approach (build without notarize, then notarize the DMG manually). However, the intent is unclear and could confuse future maintainers.
- **Line 26: `dmg.sign: false`** in electron-builder.yml -- The DMG itself is not signed. The app inside is signed (via `hardenedRuntime` + `identity`), but the DMG container is unsigned. Apple notarization requires the submitted artifact to contain signed code, but the DMG wrapper itself does not need to be signed for notarization to succeed. This is acceptable but worth documenting.
- **Line 65: No `--publish never` flag** -- `npx electron-builder --mac --arm64` without `--publish never` will attempt to publish to GitHub releases if `GH_TOKEN` is set (line 67) AND the `publish` config in `electron-builder.yml` is present. This could cause a race with the `softprops/action-gh-release` step on line 84. The builder might auto-upload artifacts before the explicit upload step runs.
- **Lines 9-10: `publish.owner` and `publish.repo`** in electron-builder.yml -- Set to `muxvo/muxvo`. After the repo is made public under the `muxvo` GitHub org, this is correct. But if the public repo name changes, this must be updated.

### Recommendations

- Add `--publish never` to the electron-builder command on line 65 to prevent auto-publishing. Let `softprops/action-gh-release` handle the upload exclusively.
- Add a comment in `electron-builder.yml` near `notarize: false` explaining that notarization is handled by the release workflow, not by electron-builder.
- Verify that `publish.owner: muxvo` and `publish.repo: muxvo` match the planned GitHub org/repo name.

---

## 5. electron-builder.yml

### Issues

- **Line 23: `notarize: false`** -- See release.yml section above. Intentional but undocumented.
- **Line 26: `dmg.sign: false`** -- DMG is unsigned. Acceptable for notarization but could trigger macOS warnings in some scenarios.
- **Line 20: Hardcoded identity** -- `identity: "<DEVELOPER_NAME> (<TEAM_ID>)"` is hardcoded. This is the developer's personal signing identity. For an open-source project, contributors cannot sign with this identity. Consider documenting that only maintainers with the certificate can produce signed builds.
- **Lines 36-39: File inclusion** -- Only `out/**/*` and two specific node_modules are included. This is correct and minimal. No issues found.

### Recommendations

- Add a comment explaining why `notarize: false` and `dmg.sign: false` are set.
- Document that code signing requires the maintainer's Apple Developer certificate.

---

## Summary of Critical Issues

| Priority | File | Issue |
|----------|------|-------|
| High | deploy-server.yml:25 | Uploads entire monorepo to server instead of server/ only |
| High | release.yml:65 | Missing `--publish never` may cause duplicate artifact upload |
| Medium | ci.yml:14 | macOS runner wastes CI minutes; use ubuntu-latest |
| Medium | deploy-server.yml:44 | Health check has no retry logic |
| Medium | ci.yml:29 | verify:coverage runs twice (explicit + pretest) |
| Low | electron-builder.yml:23 | `notarize: false` is intentional but undocumented |
| Low | electron-builder.yml:20 | Hardcoded signing identity needs documentation |

## Post-Repo-Split Notes

- `deploy-server.yml` must move to the server repo (`muxvo/server`). It will no longer need monorepo exclusions.
- `deploy-web.yml` should also move to the server repo if web/ and admin/ live there.
- `ci.yml` and `release.yml` stay in the Electron app repo (`muxvo/muxvo`).
- `electron-builder.yml` stays in the Electron app repo.
