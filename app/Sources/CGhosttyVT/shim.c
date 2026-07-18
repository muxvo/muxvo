#include "include/CGhosttyVT.h"

// 伞模块占位 TU：仅为满足 SwiftPM「普通 target 需至少一个源文件」的约束，
// 让 CGhosttyVT 成为可被 Swift `import` 的 clang module。
// 本文件不定义任何 vt 符号——vt 的实现全部来自 vendor 静态库 libghostty-vt.a，
// 由最终链接产物挂链接 flag 引入。
int cghosttyvt_umbrella_anchor(void) { return 0; }
