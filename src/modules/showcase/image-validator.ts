/**
 * Showcase Image Validator - validates image format and size
 */

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const VALID_FORMATS = ['PNG', 'JPG', 'JPEG', 'GIF'];

export interface ImageValidationInput {
  format: string;
  sizeBytes: number;
}

export interface ImageValidationResult {
  accepted: boolean;
  reason?: string;
}

export function validateShowcaseImage(input: ImageValidationInput): ImageValidationResult {
  if (!VALID_FORMATS.includes(input.format.toUpperCase())) {
    return {
      accepted: false,
      reason: `不支持的格式: ${input.format}，仅支持 PNG/JPG/GIF`,
    };
  }
  if (input.sizeBytes > MAX_SIZE_BYTES) {
    return {
      accepted: false,
      reason: `图片大小超过 5MB 限制`,
    };
  }
  return { accepted: true };
}
