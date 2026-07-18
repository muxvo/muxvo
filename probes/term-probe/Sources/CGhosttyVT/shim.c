#include "include/CGhosttyVT.h"

#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <util.h> /* forkpty */

pid_t probe_spawn_pty(const char *shell, const char *command,
                      uint16_t cols, uint16_t rows, int *out_master) {
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
    /* 子进程：environ 设置 + exec，不返回。 */
    setenv("TERM", "xterm-256color", 1);
    setenv("LANG", "en_US.UTF-8", 1);
    if (command != NULL) {
      execl(shell, shell, "-f", "-c", command, (char *)NULL);
    } else {
      execl(shell, shell, "-f", "-i", (char *)NULL);
    }
    _exit(127);
  }
  *out_master = master;
  return pid;
}

int probe_set_winsize(int fd, uint16_t cols, uint16_t rows) {
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;
  return ioctl(fd, TIOCSWINSZ, &ws);
}
