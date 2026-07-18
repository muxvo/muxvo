// CGhosttyVT 伞头：暴露 vendor libghostty-vt 的 C API 给 Swift。
//
// 与探针 CGhosttyVT 的区别：正式包把 PTY 垫片拆到独立的 CMuxvoPTY target，
// 本伞头**只**转发 ghostty vt 头，保持「vendor 依赖面」单一收口。
//
// 头文件搜索路径由 Package.swift 的 cSettings `-I <vendor>/include` 提供
// （vendor/artifacts 是指向 ~/Library/Caches/muxvo-build/artifacts 的符号链接）。
// 真实符号来自静态库 libghostty-vt.a，由最终链接产物（MuxvoApp 等）挂
// `-Xlinker <vendor>/lib/libghostty-vt.a` + `-lc++` 链入。
#ifndef CGHOSTTY_VT_UMBRELLA_H
#define CGHOSTTY_VT_UMBRELLA_H

#include <ghostty/vt.h>

#endif /* CGHOSTTY_VT_UMBRELLA_H */
