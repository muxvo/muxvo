/**
 * Search Empty State Config
 *
 * Configuration for the "no results" state in chat search.
 */

export function getNoResultsConfig() {
  return {
    message: '没有找到匹配的记录',
    suggestion: '请尝试其他关键词',
    icon: 'search' as const,
    action: {
      text: '清除搜索',
      handler: 'clearSearch',
    },
  };
}
