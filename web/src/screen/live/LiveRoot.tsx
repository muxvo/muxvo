/**
 * live 子树根（M6 批1）：ConfigProvider + LiveChrome 组合。**经 main.tsx 的 React.lazy 动态载入**——
 * 把 ConfigProvider / client.ts / 面板 live 组件全收进独立 chunk，令 main.tsx 静态图保持不含 bridge/client
 * 运行时引用（bridge-v1.md §3 截图契约隔离铁律：截图模式桥路径一行不执行）。
 * bridge≠null 才由 main.tsx 挂载，故这里 bridge 恒非空。
 */

import { ConfigProvider } from '../../config/ConfigContext';
import { AuthProvider } from '../../config/AuthContext';
import type { BridgeApi } from '../../bridge/client';
import type { Fixture } from '../../fixture/types';
import { LiveChrome } from './LiveChrome';

export function LiveRoot({ fx, bridge }: { fx: Fixture; bridge: BridgeApi }): JSX.Element {
  return (
    <ConfigProvider bridge={bridge}>
      <AuthProvider bridge={bridge}>
      <LiveChrome
        fx={fx}
        onAction={(action) => bridge.sendAction(action)}
        onTermCommand={(req) => {
          // 直接线缆（FAB create / close）不消费响应：fire-and-forget（与 main.tsx 既有语义一致）
          void bridge.sendTermCommand(req).catch(() => {});
        }}
        // M6 批A：fs.request（worktree/文件树/右键菜单）+ term.command 带响应版（worktree 行点击需
        // created 响应做 renameSubmit；拖拽 insertText）。
        onFsRequest={(req) => bridge.sendFsRequest(req)}
        onTermRequest={(req) => bridge.sendTermCommand(req)}
      />
      </AuthProvider>
    </ConfigProvider>
  );
}
