/**
 * Chat Layout Manager
 *
 * Manages three-column layout with min-width constraints and collapse behavior.
 */

interface LayoutOpts {
  windowWidth?: number;
}

const LEFT_MIN = 180;
const CENTER_MIN = 280;
const RIGHT_MIN = 400;
const LEFT_COLLAPSED = 60;
const TOTAL_MIN = LEFT_MIN + CENTER_MIN + RIGHT_MIN; // 860

export function createChatLayoutManager(opts?: LayoutOpts) {
  const windowWidth = opts?.windowWidth ?? 1200;
  const needsCollapse = windowWidth < TOTAL_MIN;

  let leftWidth = needsCollapse ? LEFT_COLLAPSED : 220;
  let leftMode: 'expanded' | 'collapsed' = needsCollapse ? 'collapsed' : 'expanded';
  let centerWidth = 340;
  let currentWindowWidth = windowWidth;

  const computeRightWidth = () => {
    return Math.max(RIGHT_MIN, currentWindowWidth - leftWidth - centerWidth);
  };

  return {
    get leftWidth() { return leftWidth; },
    get centerWidth() { return centerWidth; },
    get rightWidth() { return computeRightWidth(); },
    get leftMode() { return leftMode; },

    resizeLeft(width: number) {
      leftWidth = Math.max(LEFT_MIN, width);
    },

    resizeCenter(width: number) {
      centerWidth = Math.max(CENTER_MIN, width);
    },

    setWindowWidth(width: number) {
      currentWindowWidth = width;
      if (width >= TOTAL_MIN) {
        if (leftMode === 'collapsed') {
          leftWidth = LEFT_MIN;
          leftMode = 'expanded';
        }
      } else {
        leftWidth = LEFT_COLLAPSED;
        leftMode = 'collapsed';
      }
    },
  };
}
