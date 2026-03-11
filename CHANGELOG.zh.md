# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-03-09

### Added

- Git Worktree 管理功能（检测仓库、列表、创建、删除、重命名）
- 工作区管理弹窗（保存当前终端布局、恢复工作区、重命名工作区）
- PDF 文件预览（修复打开 PDF 时应用卡死的问题）
- Excel / 电子表格文件预览与编辑
- Dock 角标通知（终端等待输入时显示数字角标，支持实时/定时两种模式）
- 终端快捷键支持（⌘T 新建终端、⌘← / ⌘→ 跳转行首行尾）
- 项目级别自定义标题功能

### Fixed

- 聊天历史详情页无内容的问题
- 用户中断消息类型判断错误
- 终端自定义命名未同步到聊天记录
- 终端初始化时 Home/End 键绑定时机不正确
- Dock 角标权限对话框重复弹出
- 终端进程路径中非 ASCII 字符显示异常

## [0.3.0] - 2026-03-02

### Added

- 终端自定义命名功能（点击标题栏即可重命名）
- 应用关闭确认对话框（有活跃终端时提示确认）
- 首次启动欢迎引导页 + 功能导览教程
- 界面缩放设置（Settings 中可调节）
- 文件/文件夹右键菜单（在 Finder 中打开等）
- 聚焦模式侧边栏（聚焦终端时可同时查看其他终端）
- 双击聚焦设置开关
- 性能监控日志（异常时写入 ~/.muxvo/logs/perf.log）
- 字形诊断日志（用于排查 CJK 文字渲染异常）
- 文件临时视图面板宽度记忆

### Changed

- 终端网格布局重构，优化多终端排列算法
- 聚焦模式交互优化（返回平铺按钮、侧边栏滚动）
- 统一多面板字体大小

### Fixed

- 终端布局切换时的闪烁问题
- 开发模式下的白屏问题（端口释放时序）
- 终端滚动位置恢复逻辑不稳定

## [0.2.0] - 2026-02-27

### Added

- 应用自动更新功能（下载进度显示、智能提醒机制、版本跳过）
- 用户认证系统（GitHub OAuth、Google OAuth、邮箱验证码、邮箱密码登录/注册）
- 服务条款与隐私政策确认流程
- MCP 面板可折叠分组功能
- 聊天历史搜索增强（标题匹配 / 内容匹配分区显示、精确计数）
- 全局缩放功能
- 终端等待输入通知组件
- 终端铃声和 OSC 通知检测
- Codex 会话恢复支持
- 终端滚动位置保持与自动恢复

### Changed

- 统一字体配置系统（全局 CSS 变量）
- 搜索高亮实现方式优化
- 更新提醒机制改进（最多提醒 2 次 / 版本，支持 3 天后再次提醒）

### Fixed

- macOS 自动更新 ZIP 打包缺失导致更新失败
- 更新重启时 SIGABRT 崩溃（用 app.quit 替代 quitAndInstall）
- 搜索结果切换时滚动定位不准确
- 瓦片边框闪烁问题

## [0.1.0] - 2026-02-25

### Added

- 终端网格管理，支持多个 AI CLI 会话并行（Claude Code、Codex、Gemini CLI）
- 聊天历史浏览器，多来源聚合（Claude Code 和 Codex）
- 配置编辑器，支持 settings 和 CLAUDE.md 文件的原子写入保护
- 富文本编辑器，集成 TipTap 和 Markdown 支持
- 用户认证系统（GitHub OAuth、Google OAuth）
- 文件浏览器，支持目录监听和剪贴板图片粘贴
