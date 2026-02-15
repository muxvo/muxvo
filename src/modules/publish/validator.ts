/**
 * Publish Validator - validates publish rules (screenshots, file size, etc.)
 */

export interface ValidatePublishResult {
  blocked: boolean;
  warning?: boolean;
  reason?: string;
}

export function validatePublish(
  rule: string,
  input: Record<string, unknown>,
): ValidatePublishResult {
  switch (rule) {
    case 'max-screenshots': {
      const count = input.screenshotCount as number;
      if (count > 5) {
        return { blocked: true, reason: '截图/GIF 最多 5 张' };
      }
      return { blocked: false };
    }

    case 'file-size-check': {
      const fileType = input.fileType as string;
      const size = input.fileSizeBytes as number;
      if (fileType === 'skill' && size > 1 * 1024 * 1024) {
        return { blocked: false, warning: true, reason: 'Skill 文件超过 1MB，建议精简' };
      }
      if (fileType === 'plugin' && size > 10 * 1024 * 1024) {
        return { blocked: false, warning: true, reason: 'Plugin 文件超过 10MB，建议精简' };
      }
      return { blocked: false };
    }

    default:
      return { blocked: false };
  }
}
