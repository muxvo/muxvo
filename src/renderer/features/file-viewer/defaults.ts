/**
 * File Viewer Defaults
 *
 * Provides default configuration for the file viewer component.
 */

export interface TempViewLayout {
  left: string;
  middle: string;
  right: string;
}

export interface FileViewerDefaults {
  mdDefaultMode: string;
  tempViewLayout: TempViewLayout;
}

export function getFileViewerDefaults(): FileViewerDefaults {
  return {
    mdDefaultMode: 'preview',
    tempViewLayout: {
      left: '250px',
      middle: 'flex:1',
      right: '280px',
    },
  };
}
