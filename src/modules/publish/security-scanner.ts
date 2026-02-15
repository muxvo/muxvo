/**
 * Security Scanner - scans for secrets, sensitive files, and hardcoded paths
 */

const API_KEY_PATTERNS = [
  /sk-[a-zA-Z0-9]+/,
  /ghp_[a-zA-Z0-9]+/,
  /token_[a-zA-Z0-9]+/,
];

const SENSITIVE_FILES = ['.env', 'credentials.json', '*.pem', '*.key'];

const HARDCODED_PATH_PATTERNS = [
  /\/Users\/[^/]+\//,
  /\/home\/[^/]+\//,
];

export interface SecretScanResult {
  blocked: boolean;
  reason?: string;
  matchedPattern?: string;
}

export function scanForSecrets(content: string): SecretScanResult {
  for (const pattern of API_KEY_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      return {
        blocked: true,
        reason: '检测到敏感信息',
        matchedPattern: match[0],
      };
    }
  }
  return { blocked: false };
}

export interface SensitiveFileScanResult {
  blocked: boolean;
  detectedFiles: string[];
}

export function scanForSensitiveFiles(fileList: string[]): SensitiveFileScanResult {
  const detected: string[] = [];
  for (const file of fileList) {
    for (const pattern of SENSITIVE_FILES) {
      if (pattern.startsWith('*')) {
        // Wildcard pattern like *.pem
        const ext = pattern.slice(1);
        if (file.endsWith(ext)) {
          detected.push(file);
        }
      } else if (file === pattern || file.endsWith('/' + pattern)) {
        detected.push(file);
      }
    }
  }
  return {
    blocked: detected.length > 0,
    detectedFiles: detected,
  };
}

export interface HardcodedPathScanResult {
  blocked: boolean;
  warning: boolean;
  userCanOverride: boolean;
}

export function scanForHardcodedPaths(content: string): HardcodedPathScanResult {
  for (const pattern of HARDCODED_PATH_PATTERNS) {
    if (pattern.test(content)) {
      return {
        blocked: false,
        warning: true,
        userCanOverride: true,
      };
    }
  }
  return { blocked: false, warning: false, userCanOverride: false };
}
