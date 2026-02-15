/**
 * Config browser module - ~/.claude/ visual browser
 */

const RESOURCE_TYPES = [
  'skills',
  'hooks',
  'plugins',
  'settings',
  'projects',
  'sessions',
  'templates',
  'commands',
];

export async function openConfigBrowser() {
  return {
    resourceTypes: RESOURCE_TYPES,
    browse(category: string) {
      return {
        category,
        items: [],
      };
    },
  };
}
