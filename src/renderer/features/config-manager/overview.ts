/**
 * Config Manager Overview
 *
 * Provides the 8 resource type cards for the config overview screen.
 */

export interface ConfigCard {
  name: string;
  count: number;
}

export interface ConfigOverview {
  cards: ConfigCard[];
}

const RESOURCE_CARDS: string[] = [
  'Skills',
  'Hooks',
  'Plans',
  'Tasks',
  'Settings',
  'CLAUDE.md',
  'Memory',
  'MCP',
];

export function getConfigOverview(): ConfigOverview {
  return {
    cards: RESOURCE_CARDS.map((name) => ({ name, count: 0 })),
  };
}
