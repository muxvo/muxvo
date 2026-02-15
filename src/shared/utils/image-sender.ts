/**
 * Image sender - builds image payload strategy and validates images
 */

interface ImagePayloadOpts {
  foreground: string;
  imagePath: string;
  clipboardAvailable?: boolean;
}

interface ImagePayloadResult {
  strategy: string;
  clipboardWrite?: boolean;
  ptyPayload?: string;
  textPayload?: string;
}

interface ValidateImageOpts {
  format: string;
  size: number;
}

interface ValidateImageResult {
  valid: boolean;
  error?: string;
  errorType?: string;
  supportedFormats?: string[];
}

const SUPPORTED_FORMATS = ['PNG', 'JPG', 'GIF'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function isClaudeCode(foreground: string): boolean {
  const fg = foreground.toLowerCase();
  return fg === 'claude-code' || fg === 'claude code';
}

export async function buildImagePayload(opts: ImagePayloadOpts): Promise<ImagePayloadResult> {
  const { foreground, imagePath, clipboardAvailable } = opts;

  if (isClaudeCode(foreground) && clipboardAvailable) {
    return {
      strategy: 'clipboard',
      clipboardWrite: true,
      ptyPayload: '\x16', // Ctrl+V
    };
  }

  // Fallback: filepath strategy
  return {
    strategy: 'filepath',
    textPayload: imagePath,
  };
}

export function validateImage(opts: ValidateImageOpts): ValidateImageResult {
  const { format, size } = opts;

  // Check size limit
  if (size > MAX_SIZE) {
    return {
      valid: false,
      error: 'Image exceeds 5MB size limit',
      errorType: 'oversize',
    };
  }

  // Check format
  const upperFormat = format.toUpperCase();
  if (!SUPPORTED_FORMATS.includes(upperFormat)) {
    return {
      valid: false,
      error: `Unsupported format: ${format}`,
      errorType: 'invalid_format',
      supportedFormats: SUPPORTED_FORMATS,
    };
  }

  return { valid: true };
}
