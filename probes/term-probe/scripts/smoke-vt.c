// libghostty-vt C API 冒烟测试：建终端 → feed 含 SGR/CJK/emoji 的字节流 → formatter dump 校验。
// 构建与运行：scripts/smoke-vt.sh
#include <ghostty/vt.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  GhosttyTerminal term = NULL;
  GhosttyTerminalOptions topts = {.cols = 80, .rows = 24, .max_scrollback = 1024 * 1024};
  if (ghostty_terminal_new(NULL, &term, topts) != GHOSTTY_SUCCESS) {
    fprintf(stderr, "FAIL: terminal_new\n");
    return 1;
  }

  const char *input = "hi\x1b[31m\xe7\xba\xa2\x1b[0m\xf0\x9f\x91\x8d end";
  ghostty_terminal_vt_write(term, (const uint8_t *)input, strlen(input));

  GhosttyFormatter fmt = NULL;
  GhosttyFormatterTerminalOptions fopts = {0}; // 默认 plain text、整屏
  if (ghostty_formatter_terminal_new(NULL, &fmt, term, fopts) != GHOSTTY_SUCCESS) {
    fprintf(stderr, "FAIL: formatter_new\n");
    return 1;
  }

  uint8_t buf[8192];
  size_t written = 0;
  if (ghostty_formatter_format_buf(fmt, buf, sizeof(buf) - 1, &written) != GHOSTTY_SUCCESS) {
    fprintf(stderr, "FAIL: format_buf\n");
    return 1;
  }
  buf[written] = 0;

  int ok = strstr((char *)buf, "hi") && strstr((char *)buf, "\xe7\xba\xa2") &&
           strstr((char *)buf, "\xf0\x9f\x91\x8d") && strstr((char *)buf, "end");
  printf("dump(%zu bytes): %.120s\n", written, (char *)buf);
  printf(ok ? "SMOKE PASS\n" : "SMOKE FAIL\n");

  ghostty_formatter_free(fmt);
  ghostty_terminal_free(term);
  return ok ? 0 : 1;
}
