/**
 * 协议响应 → 既有屏组件 fixture props 形状（纯函数，vitest 直测；四 live 面板消费）。
 * 屏组件（McpPanelScreen/PluginsPanelScreen/SkillsPanelScreen）纯 props 复用，一行不改——
 * 差异（KeyValue[]↔Record、扁平 contents↔嵌套 manifest/contents）全在本层吸收。
 */

import type {
  KeyValue,
  McpServerView,
  PluginView,
  ResourceItem,
} from '../../../bridge/gen/protocol';

// ── 屏组件 fixture 形状（与各 *PanelScreen.tsx 内联接口结构对齐；屏取 fx:any 故此处为唯一类型锚） ──

export interface FixtureMcpServer {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  scope: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  configPath?: string;
}

export interface FixturePluginItem {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  scope: string;
  installPath: string;
  enabled: boolean;
  installedAt: string;
  lastUpdated: string;
  manifest?: { description?: string; author?: { name: string } };
  contents: { commands: string[]; skills: string[]; hooks: string[]; agents: string[] };
}

export interface FixtureSkillItem {
  name: string;
  path: string;
  source?: string;
  level?: 'system' | 'project';
  desc?: string;
}

/** KeyValue[]（协议线格式）→ Record（屏 fixture 形状）；undefined 保持 undefined（不产空对象，detail 才不误渲 headers/env 行）。 */
export function keyValuesToRecord(kvs?: KeyValue[]): Record<string, string> | undefined {
  if (!kvs || kvs.length === 0) return undefined;
  const rec: Record<string, string> = {};
  for (const { key, value } of kvs) rec[key] = value;
  return rec;
}

export function mcpServerToFixture(v: McpServerView): FixtureMcpServer {
  return {
    name: v.name,
    type: v.type,
    scope: v.scope,
    command: v.command,
    args: v.args,
    url: v.url,
    headers: keyValuesToRecord(v.headers),
    env: keyValuesToRecord(v.env),
    configPath: v.configPath,
  };
}

export function pluginViewToFixture(v: PluginView): FixturePluginItem {
  const manifest =
    v.description || v.authorName
      ? {
          ...(v.description ? { description: v.description } : {}),
          ...(v.authorName ? { author: { name: v.authorName } } : {}),
        }
      : undefined;
  return {
    id: v.id,
    name: v.name,
    marketplace: v.marketplace,
    version: v.version,
    scope: v.scope,
    installPath: v.installPath,
    enabled: v.enabled,
    installedAt: v.installedAt,
    lastUpdated: v.lastUpdated,
    manifest,
    contents: {
      commands: v.commands ?? [],
      skills: v.skills ?? [],
      hooks: v.hooks ?? [],
      agents: v.agents ?? [],
    },
  };
}

/**
 * listResources{types:['skills']} 的 ResourceItem[] → 屏 SkillItem[]。
 * ResourceItem 仅 name/path/type：source/desc 无线上来源（desc 需 readResource frontmatter，按需懒取），
 * level 缺省 undefined（全并入「系统 Skills」组）——grouping 非 golden 断言面，live 展示足够。
 */
export function resourceItemsToSkills(items: ResourceItem[]): FixtureSkillItem[] {
  return items.map((it) => ({ name: it.name, path: it.path }));
}
