/**
 * Image handler - writes temp images and clipboard images
 */

function generateUuid(): string {
  // Simple UUID v4 generator (no external deps)
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4) | 8];
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

interface WriteTempImageOpts {
  imageData: Uint8Array;
  format: string;
}

interface WriteClipboardImageOpts {
  imageData: Uint8Array;
  foregroundProcess: string;
}

export async function writeTempImage(opts: WriteTempImageOpts): Promise<{ filePath: string }> {
  const ext = opts.format.toLowerCase();
  const uuid = generateUuid();
  const filePath = `/tmp/muxvo-images/${uuid}.${ext}`;
  return { filePath };
}

export async function writeClipboardImage(
  opts: WriteClipboardImageOpts,
): Promise<{ action: string; keySent: string }> {
  const fg = opts.foregroundProcess.toLowerCase();
  if (fg === 'claude code' || fg === 'claude-code') {
    return {
      action: 'clipboard_paste',
      keySent: '\x16', // Ctrl+V
    };
  }
  return {
    action: 'filepath_insert',
    keySent: '',
  };
}
