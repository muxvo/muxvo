# 发布链路工具（M7 批1）

新 Swift 客户端「构建 → 签名 → 公证 → 打包 → appcast → 发布」全链的脚本 + 文档。
权威行为规格：`specs/behavior/distribution.md`（§3 打包 / §4 feed / §5 EdDSA / §6 workflow / §8 R-04）。

> ⚠️ **R-04 铁律**：任何本地工具**只产本地工件**，不上传、不触任何 feed、不发 release。
> 所有对外发布（正式 publish、feed 上架、凭据入 Secrets）= 用户逐件点头（D7'）。

## 组件一览

| 工具 | 职责 | 谁执行 |
|---|---|---|
| `scripts/app.sh dist` | bundle（Developer ID 由内而外签名）→ notarytool 公证 + staple → 打包 zip+DMG | CI / 本机（需证书+公证凭据） |
| `scripts/app.sh pack` | 对已有 bundle 只打包 zip+DMG（不重建/不公证），干跑用 | 任何人 |
| `tools/release/eddsa-keys.sh` | 生产 EdDSA 密钥生成 / 公钥查询 / 私钥离线冷备 | **用户（D7'）** |
| `tools/release/gen-appcast.sh` | 签名 zip + EdDSA 私钥 → appcast.xml（enclosure 指公开仓 release asset） | CI / 本机 |
| `.github/workflows/release.yml` | tag 触发全链 → **draft** release（零 feed 文件） | CI（tag+Secrets 配齐后） |

## 打包（§3）

```bash
# 全链（发布身份 env 见 app.sh 头「发布身份完整 env 配方」）：
MUXVO_APP_NAME=Muxvo MUXVO_EXECUTABLE_NAME=Muxvo MUXVO_BUNDLE_ID=com.muxvo.app \
MUXVO_DATA_ROOT_NAME=Muxvo2 MUXVO_APP_VERSION=2.0.0 \
MUXVO_NOTARY_APPLE_ID=… MUXVO_NOTARY_TEAM_ID=… MUXVO_NOTARY_PASSWORD=… \
  scripts/app.sh dist            # → bundle/dist/Muxvo-2.0.0-arm64.{zip,dmg}

# 只打包已有 bundle（干跑验证）：
MUXVO_APP_NAME=Muxvo scripts/app.sh pack
```

- **zip**（`ditto -c -k --keepParent`）：Sparkle enclosure + 老 electron-updater 均吃。
- **DMG**：官网下载 / Path C。图标布局照抄老 `electron-builder.yml`（app 130,220 + `/Applications` 410,220，窗口 540×380）。
  无 GUI 会话（CI）时 `MUXVO_DMG_NO_LAYOUT=1` 跳过 Finder 布局，DMG 功能不受损。
- **不产 blockmap**（§4.2 J7）：异构工件无老基线可差分，只发全量 zip。

## 生产 EdDSA 密钥（§5，R-09）

私钥签更新、公钥（`SUPublicEDKey`）验。**私钥丢 = 新客户端更新链永久断**，必须离线冷备。

```bash
# [用户执行 · D7'] 生成生产密钥对入登录钥匙串（幂等，已存在不覆盖）：
tools/release/eddsa-keys.sh generate

# 随时查现有公钥（注 Info.plist / 传 CI Variable 用）：
tools/release/eddsa-keys.sh pubkey

# [用户执行 · D7'] 导出私钥做离线冷备（明文！随后立刻加密+物理隔离，原文件 rm -P）：
tools/release/eddsa-keys.sh export-backup ~/muxvo-ed-priv.key
```

密钥去向：
- **私钥**：留登录钥匙串日常签名；导出加密件冷备物理隔离介质（非 git/云）；CI 经 Secret `SPARKLE_ED_PRIVATE_KEY` 注入。
- **公钥**：注 bundle `SUPublicEDKey`（`app.sh` env `MUXVO_SPARKLE_ED_KEY`）；CI 经 Variable `SPARKLE_ED_PUBLIC_KEY`。

## appcast 生成（§4.1）

```bash
# 本机（私钥取登录钥匙串）：
MUXVO_PUBLIC_REPO=<owner/repo> tools/release/gen-appcast.sh <装zip的目录> v2.0.0

# CI（私钥从 Secret 经 stdin）：
echo "$SPARKLE_ED_PRIVATE_KEY" | MUXVO_SPARKLE_ED_KEY_STDIN=1 \
  MUXVO_PUBLIC_REPO=<owner/repo> tools/release/gen-appcast.sh dist-out v2.0.0
```

产出 `appcast.xml`（含 `enclosure url`/`sparkle:edSignature`/`version`/`minimumSystemVersion`）。
`enclosure url` = `https://github.com/<PUBLIC_REPO>/releases/download/<tag>/<zip>`。

> **补签兜底**：实测本机 `generate_appcast` 用**外部私钥文件**时不写 `edSignature`（`sign_update` 用同一私钥可签；两工具 key 处理不同）。故 `gen-appcast.sh` 在 `generate_appcast` 后对缺签的 enclosure 用 `sign_update` 现算补入——保证 CI（Secret 私钥）产出必带有效签名。keychain 私钥路径下 `generate_appcast` 原生写签，补签为 no-op。

## ⚠️ 待用户拍板 / 配置（D7'，落位实跑前逐件）

| 项 | 落点 | 现状 |
|---|---|---|
| **公开仓名** `owner/repo` | `release.yml` env `PUBLIC_REPO`、`gen-appcast.sh` 的 `MUXVO_PUBLIC_REPO`、`SUFeedURL` | 占位 `__PUBLIC_REPO__`，待拍板一处替换 |
| **发布版本** D4 | tag `v<version>`（建议 `v2.0.0`，须 > 老 `v0.5.0`）、`MUXVO_APP_VERSION` | 建议值，待定 |
| **Apple 凭据** → Secrets | `APPLE_CERTIFICATE`(p12 base64) / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_APP_SPECIFIC_PASSWORD` | 实物见 memory `ref-apple-signing.md`，待入 Secrets |
| **EdDSA 私钥** → Secret | `SPARKLE_ED_PRIVATE_KEY` | 待生成（`eddsa-keys.sh generate`）+ 入 Secret |
| **EdDSA 公钥** → Variable | `SPARKLE_ED_PUBLIC_KEY` | 待生成后填 |
| **公开仓 PAT** → Secret | `PUBLIC_REPO_TOKEN`（对公开仓 contents:write） | 待建 |

`SUFeedURL`（新客户端 Info.plist 指向 appcast）落点亦待仓名拍板；R-04 硬闸禁 feed 字面量进 `app/Sources`，故经 `MuxvoUpdateFeedURL`/env 注入。
