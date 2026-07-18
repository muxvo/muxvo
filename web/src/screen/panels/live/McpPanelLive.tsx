/**
 * MCP 面板 live 包装（mcp-panel.md）：golden McpPanelScreen 纯 props 复用（列表 + detail 只读），
 * 编辑走 live 表单覆盖层（McpFormLive，复用 .mcp-panel__form-* 类）。
 *
 * 权限矩阵（CONFIG_L1_10 + m6-batch0 裁决订正）：仅 global scope 可编辑/删除（golden ServerDetail
 * 据 scope 已渲编辑/删除钮 vs 只读提示）；detail→编辑→保存→回 detail 两级（detailReducer）。
 * Esc 两级（LiveChrome 路由归 A2）。订阅 configResourcesChanged 重拉。
 */
import { useCallback, useEffect, useReducer, useState } from 'react';
import type { MouseEvent } from 'react';
import { useConfigApi } from '../../../config/ConfigContext';
import { registerLivePanel, type LivePanelProps } from '../../live/panelRegistry';
import { McpPanelScreen } from '../McpPanelScreen';
import { mcpServerToFixture, type FixtureMcpServer } from './mappers';
import { DETAIL_INITIAL, detailReducer } from './panelState';
import { useConfigData } from './shared';
import type { KeyValue, McpServerEdit, McpType } from '../../../bridge/gen/protocol';
import './panels-live.css';

function recordToKeyValues(text: string): KeyValue[] | undefined {
  const t = text.trim();
  if (!t) return undefined;
  try {
    const obj = JSON.parse(t) as Record<string, string>;
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
  } catch {
    return undefined;
  }
}

function McpFormLive({
  server,
  onSave,
  onCancel,
}: {
  server: FixtureMcpServer;
  onSave: (edit: McpServerEdit) => void;
  onCancel: () => void;
}): JSX.Element {
  const [type, setType] = useState<McpType>(server.type);
  const [command, setCommand] = useState(server.command ?? '');
  const [args, setArgs] = useState((server.args ?? []).join(' '));
  const [url, setUrl] = useState(server.url ?? '');
  const [headers, setHeaders] = useState(server.headers ? JSON.stringify(server.headers, null, 2) : '');
  const [env, setEnv] = useState(server.env ? JSON.stringify(server.env, null, 2) : '');

  const submit = (): void => {
    const edit: McpServerEdit = { name: server.name, type };
    if (type === 'stdio') {
      edit.command = command;
      edit.args = args.trim() ? args.trim().split(/\s+/) : [];
    } else {
      edit.url = url;
      const h = recordToKeyValues(headers);
      if (h) edit.headers = h;
    }
    const e = recordToKeyValues(env);
    if (e) edit.env = e;
    onSave(edit);
  };

  return (
    <div className="panel-form-live-cover">
      <div className="mcp-panel__form">
        <div className="mcp-panel__form-header">编辑服务器</div>
        <div className="mcp-panel__form-body">
          <label className="mcp-panel__form-label">
            名称
            <input className="mcp-panel__form-input" value={server.name} readOnly />
          </label>
          <label className="mcp-panel__form-label">
            类型
            <select className="mcp-panel__form-select" value={type} onChange={(e) => setType(e.target.value as McpType)}>
              <option value="stdio">STDIO</option>
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </label>
          {type === 'stdio' ? (
            <>
              <label className="mcp-panel__form-label">
                命令
                <input className="mcp-panel__form-input" value={command} onChange={(e) => setCommand(e.target.value)} />
              </label>
              <label className="mcp-panel__form-label">
                参数
                <input className="mcp-panel__form-input" value={args} placeholder="空格分隔" onChange={(e) => setArgs(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="mcp-panel__form-label">
                URL
                <input className="mcp-panel__form-input" value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
              <label className="mcp-panel__form-label">
                Headers
                <textarea className="mcp-panel__form-textarea" value={headers} rows={3} onChange={(e) => setHeaders(e.target.value)} />
              </label>
            </>
          )}
          <label className="mcp-panel__form-label">
            环境变量
            <textarea className="mcp-panel__form-textarea" value={env} rows={3} onChange={(e) => setEnv(e.target.value)} />
          </label>
        </div>
        <div className="mcp-panel__form-actions">
          <button className="mcp-panel__btn mcp-panel__btn--primary" onClick={submit}>
            保存
          </button>
          <button className="mcp-panel__btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// 两级 Esc（CONFIG_L1_15）：form 时 Esc→cancel 回 detail（capture 拦截）；detail 时 Esc 冒泡→LiveChrome 关面板。
export function McpPanelLive({}: LivePanelProps): JSX.Element {
  const api = useConfigApi();
  const [{ servers }] = useConfigData<{ servers: FixtureMcpServer[] }>(
    api,
    async (a) => {
      const r = await a.request({ kind: 'mcpServers' });
      return { servers: r.kind === 'mcpServers' ? r.servers.map(mcpServerToFixture) : [] };
    },
    { servers: [] },
  );

  const [detail, dispatch] = useReducer(detailReducer, DETAIL_INITIAL);
  const selected = servers.find((s) => s.name === detail.selectedId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && detail.form) {
        e.preventDefault();
        e.stopPropagation();
        dispatch({ type: 'cancel' });
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [detail.form]);

  const onClick = useCallback(
    (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      // form 覆盖层内的点击由 McpFormLive 自身 handler 处理（其 保存/取消 亦 __btn--primary），委托跳过。
      if (target.closest('.panel-form-live-cover')) return;
      const item = target.closest('.mcp-panel__item');
      if (item) {
        const name = item.querySelector('.mcp-panel__item-name')?.textContent ?? '';
        const s = servers.find((x) => x.name === name);
        if (s) dispatch({ type: 'select', id: s.name });
        return;
      }
      if (target.closest('.mcp-panel__btn--danger')) {
        if (selected && api) void api.request({ kind: 'mcpDelete', name: selected.name }).catch(() => {});
        dispatch({ type: 'close' });
        return;
      }
      if (target.closest('.mcp-panel__btn--primary')) {
        dispatch({ type: 'edit' });
      }
    },
    [api, servers, selected],
  );

  const onSave = useCallback(
    (edit: McpServerEdit): void => {
      if (api) void api.request({ kind: 'mcpSave', server: edit }).catch(() => {});
      dispatch({ type: 'save' });
    },
    [api],
  );

  return (
    <div className="mcp-panel-live" onClick={onClick}>
      <McpPanelScreen fx={{ screen: 'mcp-panel', theme: 'dark', mcp: { servers, selected: detail.selectedId, form: false } }} />
      {selected && detail.form && <McpFormLive server={selected} onSave={onSave} onCancel={() => dispatch({ type: 'cancel' })} />}
    </div>
  );
}

registerLivePanel('mcp', McpPanelLive);
