import { TERMINAL_FONT_FAMILY } from '@/shared/constants/fonts';

export function getDefaultConfig() {
  return {
    window: { width: 1400, height: 900 },
    font: { size: 14 },
    theme: 'dark' as const,
    tile: {
      columnRatios: [1, 1],
      rowRatios: [1, 1],
    },
    terminal: {
      themeName: 'dark' as const,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 14,
      cursorStyle: 'block' as const,
      cursorBlink: true,
    },
  };
}
