/**
 * Drag manager for terminal reordering.
 */

interface DragManagerOpts {
  order: string[];
}

interface DragManager {
  order: string[];
  startDrag(terminalId: string): void;
  dropBefore(targetId: string): void;
  cancel(): void;
}

export function createDragManager(opts: DragManagerOpts): DragManager {
  const originalOrder = [...opts.order];
  let draggingId: string | null = null;

  const manager: DragManager = {
    order: [...opts.order],

    startDrag(terminalId: string) {
      draggingId = terminalId;
    },

    dropBefore(targetId: string) {
      if (!draggingId) return;
      // Remove dragged item
      const filtered = manager.order.filter((id) => id !== draggingId);
      // Find target position
      const targetIndex = filtered.indexOf(targetId);
      if (targetIndex === -1) {
        filtered.push(draggingId);
      } else {
        filtered.splice(targetIndex, 0, draggingId);
      }
      manager.order = filtered;
      draggingId = null;
    },

    cancel() {
      manager.order = [...originalOrder];
      draggingId = null;
    },
  };

  return manager;
}
