// CGhosttyVT 伞头：暴露 libghostty-vt C API + 探针自用的 PTY C 垫片。
// PTY 垫片放 C 侧的原因：
// 1) ioctl 是变参函数，Swift 不能直接调；
// 2) forkpty 之后的子进程分支只允许 async-signal-safe 操作 + exec，
//    在 Swift 运行时里写 fork 子分支不可靠，放 C 里最稳。
#ifndef CGHOSTTY_VT_UMBRELLA_H
#define CGHOSTTY_VT_UMBRELLA_H

#include <ghostty/vt.h>
#include <stdint.h>
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * forkpty 包装：建 pty + fork + 子进程 exec shell。
 *
 * command 非 NULL 时执行 `shell -f -c command`（跑完即退）；
 * command 为 NULL 时起交互 shell `shell -f -i`（-f 跳过 rc 文件，输出确定）。
 * 子进程 TERM=xterm-256color、LANG=en_US.UTF-8。
 *
 * 成功返回子进程 pid 并写 *out_master（pty master fd）；失败返回 -1。
 */
pid_t probe_spawn_pty(const char *shell, const char *command,
                      uint16_t cols, uint16_t rows, int *out_master);

/** ioctl(TIOCSWINSZ) 包装。成功返回 0。 */
int probe_set_winsize(int fd, uint16_t cols, uint16_t rows);

#ifdef __cplusplus
}
#endif

#endif /* CGHOSTTY_VT_UMBRELLA_H */
