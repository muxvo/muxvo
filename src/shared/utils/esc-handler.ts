interface EscContext {
  securityDialogOpen?: boolean;
  folderSelectorOpen?: boolean;
  skillBrowserOpen?: boolean;
  tempViewOpen?: boolean;
  filePanelOpen?: boolean;
  viewMode?: string;
  terminalFocused?: boolean;
}

export function handleEscPress(context: EscContext): {
  action: string;
  priority: number;
  intercepted?: boolean;
} {
  // Special: terminal focused => passthrough regardless
  if (context.terminalFocused) {
    return { action: 'passthrough', priority: 0, intercepted: false };
  }

  if (context.securityDialogOpen) {
    return { action: 'closeSecurityDialog', priority: 1 };
  }
  if (context.folderSelectorOpen) {
    return { action: 'closeFolderSelector', priority: 2 };
  }
  if (context.skillBrowserOpen) {
    return { action: 'closeSkillBrowser', priority: 3 };
  }
  if (context.tempViewOpen) {
    return { action: 'closeTempView', priority: 4 };
  }
  if (context.filePanelOpen) {
    return { action: 'closeFilePanel', priority: 5 };
  }
  if (context.viewMode === 'Focused') {
    return { action: 'exitFocusMode', priority: 6 };
  }

  return { action: 'noop', priority: 7 };
}
