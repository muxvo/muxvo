/**
 * 剪贴板写入（W11 代码块复制 / 整段复制为 Markdown 共用）。
 *
 * WKWebView 兼容注记：`navigator.clipboard.writeText` 在 WKWebView 非用户手势上下文/无 https origin 时可能
 * 抛异常或悬挂——优先走它，失败退回 `document.execCommand('copy')`（隐藏 textarea + select + execCommand）。
 * execCommand 已废弃但在 WKWebView 内仍是最可靠的降级路径（自定义 scheme 服务下无系统剪贴板权限弹窗）。
 *
 * 返回 true=写入成功、false=两条路径均失败（调用方据此决定是否给「已复制」反馈）。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到 execCommand 降级 */
  }
  return legacyCopy(text);
}

/** document.execCommand('copy') 降级：隐藏 textarea 选中后执行，用后即拆。 */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // 移出视口、只读不聚焦滚动，避免污染布局/滚动位置。
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
