/**
 * Esc key priority chain
 * Lower priority number = higher priority (closed first)
 */

export function createEscPriorityChain() {
  const _layers: Array<{ priority: number; name: string }> = [];

  return {
    register(priority: number, name: string) {
      _layers.push({ priority, name });
      _layers.sort((a, b) => a.priority - b.priority);
    },
    handleEsc(): string | null {
      if (_layers.length === 0) return null;
      const closed = _layers.shift()!;
      return closed.name;
    },
    get layerCount() {
      return _layers.length;
    },
  };
}
