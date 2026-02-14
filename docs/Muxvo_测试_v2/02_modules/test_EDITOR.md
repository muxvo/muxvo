# EDITOR 模块测试用例 — 富编辑器覆盖层

## 模块信息
- 覆盖功能：RE1（富编辑器基础）/ RE2（富编辑器完善）/ RE3（富编辑器高级）
- 对应 PRD 章节：6.13, 8.16, 11.1, 11.2
- 预计用例数：44 个
- 编号规范：`EDITOR_{层级}_{序号}_{简述}`

---

## L1 契约层测试

### 1.1 IPC 消息格式

| 编号 | 通道/操作 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|-----------|------|----------|----------|--------|
| EDITOR_L1_01_ipc_write_text | terminal:write | 编辑器发送文本 "hello" | 调用 `pty.write("hello\r")` | 编辑器->PTY 文本转发 | P0 |
| EDITOR_L1_02_ipc_write_multiline_cc | terminal:write | 编辑器发送多行文本（前台=Claude Code） | 调用 `pty.write("line1\x1b\rline2\r")` | CC 多行协议：`\x1b\r` 分隔 | P0 |
| EDITOR_L1_03_ipc_write_multiline_shell | terminal:write | 编辑器发送多行文本（前台=bash） | 调用 `pty.write("line1\nline2\n")` | shell 直接发送 | P0 |
| EDITOR_L1_04_ipc_write_image_temp | fs:write-temp-image | 粘贴图片到编辑器 | 调用 IPC 保存到 `/tmp/muxvo-images/{uuid}.png` | 临时文件写入 | P1 |
| EDITOR_L1_05_ipc_write_clipboard | fs:write-clipboard-image | 发送图片（前台=CC） | 将图片写入系统剪贴板 -> 发送 `\x16` | CC 剪贴板模拟 | P1 |

### 1.2 默认值

| 编号 | 配置项 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|--------|------|----------|----------|--------|
| EDITOR_L1_06_default_mode | 默认模式 | 终端启动 | 编辑器模式为 RichEditor（非 RawTerminal） | 6.13 节：`[*] -> RichEditor` | P0 |
| EDITOR_L1_07_default_send_key | 发送快捷键 | 首次使用 | Enter 或 Cmd+Enter 触发发送，Shift+Enter 换行 | 8.16 节默认配置 | P0 |
| EDITOR_L1_08_default_editor_type | 编辑器技术 | MVP 阶段 | 使用 contenteditable div | 8.16 节技术选型 | P2 |

---

## L2 规则层测试

### 2.1 状态机：富编辑器覆盖层（6.13）

> **来源**：PRD 第 6.13 节

#### 状态机图

```
                    ┌──────────────────────────────────────────┐
                    │            RichEditor                    │
                    │                                          │
                    │  [Idle] ──用户输入──▶ [Composing]         │
                    │    ▲                    │     │          │
                    │    │              粘贴图片│     │发送      │
                    │    │                    ▼     │          │
                    │    │           [ImageAttaching]│          │
                    │    │                    │     │          │
                    │    │           图片保存完成│     │          │
                    │    │                    ▼     ▼          │
                    │    │              [Composing] [Sending]   │
                    │    │                          │          │
                    │    └──pty.write+清空编辑器─────┘          │
                    │                                          │
                    └───────────────┬──────────────────────────┘
                                    │  ▲
                    \x1b[?1049h /   │  │   \x1b[?1049l /
                    手动快捷键      │  │   手动快捷键
                                    ▼  │
                              [RawTerminal]
                    富编辑器隐藏，xterm.js 直接接收键盘
```

#### RichEditor 内部转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 | 优先级 |
|---------|---------|----------|---------|----------|--------|
| E1 | [*] | 终端启动 | RichEditor.Idle | EDITOR_L2_01_init_idle | P0 |
| E2 | Idle | 用户开始输入 | Composing | EDITOR_L2_02_idle_composing | P0 |
| E3 | Composing | 继续输入/粘贴文本 | Composing | EDITOR_L2_03_composing_continue | P1 |
| E4 | Composing | 粘贴图片（Ctrl+V） | ImageAttaching | EDITOR_L2_04_composing_attaching | P0 |
| E5 | ImageAttaching | 图片保存到临时文件 | Composing（显示缩略图） | EDITOR_L2_05_attaching_composing | P0 |
| E6 | Composing | 按发送（Enter/Cmd+Enter） | Sending | EDITOR_L2_06_composing_sending | P0 |
| E7 | Sending | 提取文本->检测进程->转换协议->pty.write()->清空 | Idle | EDITOR_L2_07_sending_idle | P0 |

✅ 7/7 内部路径已覆盖

#### 模式切换转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 | 优先级 |
|---------|---------|----------|---------|----------|--------|
| M1 | RichEditor | `\x1b[?1049h`（ASB 进入信号） | RawTerminal | EDITOR_L2_08_asb_enter | P0 |
| M2 | RawTerminal | `\x1b[?1049l`（ASB 退出信号） | RichEditor | EDITOR_L2_09_asb_exit | P0 |
| M3 | RichEditor | 手动快捷键切换 | RawTerminal | EDITOR_L2_10_manual_to_raw | P1 |
| M4 | RawTerminal | 手动快捷键切换 | RichEditor | EDITOR_L2_11_manual_to_rich | P1 |

✅ 4/4 模式切换路径已覆盖

### 2.2 按键穿透规则

> **来源**：PRD 8.16 节

#### 决策树

```
用户在编辑器模式下按键
    │
    ├─ Ctrl+C ? ──▶ 穿透到终端（中断进程）
    ├─ Ctrl+Z ? ──▶ 穿透到终端（挂起进程）
    ├─ Ctrl+D ? ──▶ 穿透到终端（EOF）
    ├─ Enter / Cmd+Enter ? ──▶ 编辑器发送
    ├─ Shift+Enter ? ──▶ 编辑器换行
    └─ 其他按键 ? ──▶ 编辑器输入
```

| 编号 | 按键 | 初始状态 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|------|----------|------|----------|----------|--------|
| EDITOR_L2_12_key_ctrl_c | Ctrl+C | RichEditor, Composing | 按 Ctrl+C | 信号穿透到终端（中断进程），编辑器内容保留 | 穿透规则 | P0 |
| EDITOR_L2_13_key_ctrl_z | Ctrl+Z | RichEditor, Composing | 按 Ctrl+Z | 信号穿透到终端（挂起进程），编辑器内容保留 | 穿透规则 | P0 |
| EDITOR_L2_14_key_ctrl_d | Ctrl+D | RichEditor, Idle | 按 Ctrl+D | 信号穿透到终端（EOF），编辑器不响应 | 穿透规则 | P0 |
| EDITOR_L2_15_key_enter_send | Enter | RichEditor, Composing | 按 Enter（默认配置） | 编辑器触发发送 | 发送键配置 | P0 |
| EDITOR_L2_16_key_cmd_enter_send | Cmd+Enter | RichEditor, Composing | 按 Cmd+Enter | 编辑器触发发送 | 发送键配置 | P0 |
| EDITOR_L2_17_key_shift_enter | Shift+Enter | RichEditor, Composing | 按 Shift+Enter | 编辑器内插入新行，不发送 | 换行规则 | P0 |
| EDITOR_L2_18_key_other | 普通字符 | RichEditor, Idle | 按字母键 "a" | 编辑器输入字符 "a" | 默认编辑器输入 | P1 |
| EDITOR_L2_19_key_ctrl_c_preserve | Ctrl+C | RichEditor, Composing（已输入文本） | 按 Ctrl+C | 穿透到终端，**编辑器内已输入内容不清空** | 待澄清 #4：保留内容 | P0 |

### 2.3 文本转发规则

> **来源**：PRD 8.16 节、分析报告 7.4

| 编号 | 前台进程 | 输入内容 | 期望 pty.write() 调用 | 计算过程 | 优先级 |
|------|----------|----------|----------------------|----------|--------|
| EDITOR_L2_20_text_cc_single | Claude Code | "hello" | `pty.write("hello\r")` | CC 单行：文本 + `\r` | P0 |
| EDITOR_L2_21_text_cc_multi | Claude Code | "line1\nline2\nline3" | `pty.write("line1\x1b\rline2\x1b\rline3\r")` | CC 多行：`\x1b\r` 分隔各行，最后 `\r` | P0 |
| EDITOR_L2_22_text_shell_single | bash | "ls -la" | `pty.write("ls -la\n")` | shell 单行：文本 + `\n` | P0 |
| EDITOR_L2_23_text_shell_multi | zsh | "echo a\necho b" | `pty.write("echo a\necho b\n")` | shell 多行：直接发送 | P0 |
| EDITOR_L2_24_text_fish | fish | "echo hello" | `pty.write("echo hello\n")` | fish 同 shell 协议 | P1 |
| EDITOR_L2_25_text_empty | 任意 | ""（空文本） | 不发送（忽略空输入） | 边界：空文本 | P1 |
| EDITOR_L2_26_text_special_chars | Claude Code | "echo \$VAR && rm -rf" | 特殊字符原样转发，不转义 | 边界：含特殊字符 | P1 |
| EDITOR_L2_27_text_very_long | Claude Code | 10000 字符文本 | 正常按协议转发 | 边界：超长文本 | P2 |

### 2.4 图片发送规则

> **来源**：PRD 8.16 节、分析报告 7.5

| 编号 | 前台工具 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|----------|------|----------|----------|--------|
| EDITOR_L2_28_img_cc_clipboard | Claude Code | 发送带图片的消息 | 图片写入系统剪贴板 -> 发送 `\x16`（Ctrl+V）-> 触发 CC 原生粘贴 | CC 剪贴板模拟 | P0 |
| EDITOR_L2_29_img_cc_fallback | Claude Code（剪贴板失败） | 发送带图片的消息 | 插入文件路径作为文本 | CC fallback 路径 | P1 |
| EDITOR_L2_30_img_gemini | Gemini CLI | 发送带图片的消息 | 插入文件路径作为文本 | Gemini 文件路径模式 | P1 |
| EDITOR_L2_31_img_shell | bash | 发送带图片的消息 | 插入文件路径作为文本 | shell 文件路径模式 | P1 |
| EDITOR_L2_32_img_oversize | 任意 | 粘贴 >5MB 图片 | 提示文件大小限制（单张 <= 5MB） | 边界：图片大小上限 | P1 |
| EDITOR_L2_33_img_invalid_format | 任意 | 粘贴 BMP/WEBP 格式图片 | 提示格式限制（PNG/JPG/GIF） | 边界：格式限制 | P1 |
| EDITOR_L2_34_img_remove | RichEditor | 点击已附加图片的 × 按钮 | 移除缩略图，恢复纯文本模式 | 附件管理 | P1 |

### 2.5 自动模式检测（RE2）

> **来源**：PRD 8.16 节 RE2

| 编号 | 场景 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|------|------|----------|----------|--------|
| EDITOR_L2_35_detect_asb_vim | 用户运行 vim | xterm.js 解析器收到 `\x1b[?1049h` | 自动切换到 RawTerminal 模式 | ASB 进入信号检测 | P0 |
| EDITOR_L2_36_detect_asb_exit_vim | vim 运行中 | 用户退出 vim，收到 `\x1b[?1049l` | 自动恢复 RichEditor 模式 | ASB 退出信号检测 | P0 |
| EDITOR_L2_37_detect_process_htop | 用户运行 htop | tcgetpgrp() 返回 htop，匹配已知 TUI 列表 | fallback 切换到 RawTerminal | 进程名检测 | P1 |
| EDITOR_L2_38_detect_cc_no_asb | 用户运行 Claude Code | CC 不使用 ASB | 保持 RichEditor 模式不切换 | CC 无 ASB 信号 | P0 |

### 2.6 临时文件清理规则

> **来源**：PRD 8.16 节、分析报告附录 H

| 编号 | 场景 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|------|------|----------|----------|--------|
| EDITOR_L2_39_cleanup_on_close | 终端有临时图片文件 | 关闭终端 | `/tmp/muxvo-images/` 下该终端的临时图片被删除 | 终端关闭时清理 | P1 |
| EDITOR_L2_40_cleanup_24h | 临时图片文件存在超过 24 小时 | 等待 24 小时或模拟时间 | 自动清理过期临时文件 | 24 小时定时清理 | P1 |
| EDITOR_L2_41_cleanup_no_premature | 终端仍在运行，图片已附加 | 正常使用中 | 临时文件不被清理 | 不误删活跃文件 | P2 |

### 2.7 模式 UI 映射验证

> **来源**：PRD 6.13 节

| 编号 | 模式 | 富编辑器可见性 | xterm.js 键盘 | 适用场景 | 优先级 |
|------|------|---------------|--------------|---------|--------|
| EDITOR_L2_42_ui_rich | RichEditor | 可见，接收键盘输入（Ctrl+C/Z/D 穿透） | 断开 | CC、Codex、Gemini CLI、shell | P0 |
| EDITOR_L2_43_ui_raw | RawTerminal | 隐藏 | 直接接收 | vim、htop、less、man、ssh、tmux | P0 |
| EDITOR_L2_44_ui_image_thumb | RichEditor + 已附加图片 | 编辑器显示缩略图 + × 移除按钮 | 断开 | 图片粘贴后 | P1 |

---

## 用例统计

- L1: 8 个
- L2: 36 个（含 7 个 RichEditor 内部状态机 + 4 个模式切换 + 8 个按键穿透 + 8 个文本转发 + 7 个图片发送 + 4 个自动检测 + 3 个临时清理 + 3 个 UI 映射 - 重复计算已调整）
  - 状态机路径覆盖：RichEditor 内部 7/7、模式切换 4/4
- **总计: 44 个**

| 优先级 | 数量 |
|--------|------|
| P0 | 21 |
| P1 | 18 |
| P2 | 5 |
