#include "include/CMuxvoPTY.h"

#include <signal.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <util.h> /* forkpty */

pid_t muxvo_pty_spawn(const char *path,
                      char *const argv[],
                      char *const envp[],
                      const char *cwd,
                      uint16_t cols,
                      uint16_t rows,
                      int maxfd,
                      int *out_master) {
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;

  int master = -1;
  pid_t pid = forkpty(&master, NULL, NULL, &ws);
  if (pid < 0) {
    return -1;
  }
  if (pid == 0) {
    /* 子分支：只做 async-signal-safe 调用，直到 exec。 */
    /* fd 卫生：关闭 [3, maxfd) 的全部继承 fd（含 forkpty 未在子进程关掉的 master），
       只留 forkpty 装好的控制 tty(0/1/2)。close 是 async-signal-safe。 */
    for (int fd = 3; fd < maxfd; fd++) {
      (void)close(fd);
    }
    /* 信号卫生：重置处置为默认 + 解除屏蔽。exec 保留被「忽略(SIG_IGN)」的处置，若宿主
       GUI app / 测试宿主忽略了 SIGHUP（Swift 运行时默认忽略 SIGPIPE 等亦同理），子 shell 会
       继承 SIG_IGN 而永不响应挂断——优雅关闭的 SIGHUP 便形同虚设。sigaction/sigprocmask
       均 async-signal-safe。SIGKILL/SIGSTOP 不可改，sigaction 返回错误忽略即可。 */
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = SIG_DFL;
    sigemptyset(&sa.sa_mask);
    for (int s = 1; s < NSIG; s++) {
      (void)sigaction(s, &sa, NULL);
    }
    sigset_t empty;
    sigemptyset(&empty);
    (void)sigprocmask(SIG_SETMASK, &empty, NULL);
    if (cwd != NULL && cwd[0] != '\0') {
      /* chdir 失败非致命：落回继承的 cwd 继续 exec（shell 仍可用）。 */
      (void)chdir(cwd);
    }
    execve(path, argv, envp);
    _exit(127); /* exec 失败：父进程会经退出码 127 观察到 spawn 失败 */
  }
  *out_master = master;
  return pid;
}

int muxvo_pty_set_winsize(int fd, uint16_t cols, uint16_t rows) {
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;
  return ioctl(fd, TIOCSWINSZ, &ws);
}
