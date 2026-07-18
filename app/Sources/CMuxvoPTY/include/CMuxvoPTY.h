// CMuxvoPTY 伞头：PTY C 垫片（forkpty/execve/TIOCSWINSZ）。
//
// 为什么单独一个 C target、且不 include ghostty 头：
// 1) forkpty 后的子分支只允许 async-signal-safe 调用 + exec；Swift 运行时里
//    写 fork 子分支不可靠（分配器/ARC 可能持锁），故把「子分支代码」全部关进
//    C 里最稳。本垫片子分支只做 chdir/execve/_exit——三者皆 async-signal-safe。
// 2) PTY shim 与 ghostty vt 无关——拆开后「不依赖 vendor 的可测面」最大化
//    （状态机/Registry 策略/env 合同全部 vendor-free），并给 CI 留逃生舱。
//
// 约束（调用方须遵守）：
// - argv / envp 均为以 NULL 结尾的 C 字符串数组，由 Swift 侧完整组好（含 login
//   shell 的 argv[0] `-` 前缀、env 合同增删）后传入。子分支**不**做 setenv/
//   getenv 等非 async-signal-safe 的 env 改写——env 必须经 envp 一次性交付。
// - path 为要 exec 的可执行文件路径（通常是 shell 绝对路径）。用 execve 而非
//   execvp：execvp 会用进程当前 environ 做 PATH 搜索且忽略传入 envp，与「envp
//   组好传入」的合同冲突；execve 精确使用传入 envp、不做 PATH 搜索（shell 路径
//   已是绝对路径，无需搜索），也免去在子分支里改 environ。
#ifndef CMUXVO_PTY_H
#define CMUXVO_PTY_H

#include <stdint.h>
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * forkpty + execve 起一个挂在新 pty 上的子进程。
 *
 * 父进程返回子进程 pid，并把 pty master fd 写入 *out_master。
 * 子分支（返回 0 的那支）只做 async-signal-safe 调用：可选 chdir(cwd) →
 * execve(path, argv, envp)；exec 失败则 _exit(127)，永不返回 Swift。
 *
 * forkpty 内部已 setsid + TIOCSCTTY，子进程成为新会话/进程组组长（pgid == pid），
 * 故上层可用 kill(-pid, sig) 向整个前台进程组发信号（优雅关闭走 SIGHUP 到进程组）。
 * 注（当前 PTYHost 实际行为）：因「父发信号」与「子 setsid」存在竞态窗口——窗口内进程组尚
 * 未建立、kill(-pid) 会 ESRCH 丢信号（温顺子进程收不到 SIGHUP 被迫走 grace 超时强杀）——
 * 上层对进程组与 leader pid **并发各发一份**（kill(-pid,sig) + kill(pid,sig)，幂等），
 * 保证首领必达；这是对本函数「pgid==pid」保证的补强，不改本 shim 行为。
 *
 * fd 卫生：子分支 exec 前关闭 [3, maxfd) 的全部 fd（循环 close，async-signal-safe），
 * 防子进程继承父进程任意 fd（flock 实例锁 / socket / db 句柄等）——否则 PTY 子进程会替
 * 父进程持有这些 fd，例如让实例锁在父退出后仍被 shell 持有致「误判已在运行」。
 * fd 0/1/2 是 forkpty 装好的控制 tty，保留不动。maxfd 由调用方 fork 前用 getdtablesize()
 * 取好传入（sysconf/getdtablesize 非 async-signal-safe，不在子分支调用）。
 *
 * @param path       要 exec 的可执行文件路径（shell 绝对路径）
 * @param argv       argv 数组，NULL 结尾；argv[0] 由调用方按 login 约定组好
 * @param envp       环境数组（"KEY=VALUE"），NULL 结尾；子进程环境即此，不再改写
 * @param cwd        子进程工作目录；NULL 或空串表示不 chdir（继承父 cwd）
 * @param cols       初始列数（winsize.ws_col）
 * @param rows       初始行数（winsize.ws_row）
 * @param maxfd      fd 关闭上界（不含）；子分支关 [3, maxfd)。<=3 则跳过关闭
 * @param out_master 成功时写入 pty master fd
 * @return 子进程 pid（>0）；forkpty 失败返回 -1（*out_master 不被触碰）
 */
pid_t muxvo_pty_spawn(const char *path,
                      char *const argv[],
                      char *const envp[],
                      const char *cwd,
                      uint16_t cols,
                      uint16_t rows,
                      int maxfd,
                      int *out_master);

/**
 * 对 pty master fd 下发新 winsize（TIOCSWINSZ）。内核据此自动向前台进程组
 * 发 SIGWINCH——上层**不**手动发 SIGWINCH。
 *
 * @param fd   pty master fd
 * @param cols 新列数
 * @param rows 新行数
 * @return 0 成功；-1 失败（errno 置位）
 */
int muxvo_pty_set_winsize(int fd, uint16_t cols, uint16_t rows);

#ifdef __cplusplus
}
#endif

#endif /* CMUXVO_PTY_H */
