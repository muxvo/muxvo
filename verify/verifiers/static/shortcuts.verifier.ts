import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles } from '../../utils/file-helpers.js';
import { contentContains, escapeRegex } from '../../utils/pattern-matchers.js';

/**
 * Convert macOS shortcut notation to Electron accelerator format.
 * e.g. ⌘T → CommandOrControl+T, ⇧⌘P → CommandOrControl+Shift+P
 */
function toElectronAccelerator(macShortcut: string): string {
  let result = macShortcut;

  // Order matters: process multi-char modifiers first
  const replacements: [string, string][] = [
    ['⇧', 'Shift+'],
    ['⌃', 'Control+'],
    ['⌥', 'Alt+'],
    ['⌘', 'CommandOrControl+'],
  ];

  for (const [symbol, accel] of replacements) {
    result = result.replace(symbol, accel);
  }

  return result;
}

/**
 * Generate alternative key representations for searching.
 */
function getKeyVariants(shortcut: string): string[] {
  const accelerator = toElectronAccelerator(shortcut);
  const variants: string[] = [accelerator];

  // Also try with just 'Cmd+' or 'Meta+' variants
  if (accelerator.includes('CommandOrControl+')) {
    variants.push(accelerator.replace('CommandOrControl+', 'Cmd+'));
    variants.push(accelerator.replace('CommandOrControl+', 'Meta+'));
    variants.push(accelerator.replace('CommandOrControl+', 'mod+'));
  }

  // Extract the final key for keydown event listener matching
  const parts = accelerator.split('+');
  if (parts.length > 0) {
    const key = parts[parts.length - 1];
    variants.push(key);
  }

  return variants;
}

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Search all .ts and .tsx files under src/
  const srcDir = resolveProjectPath(projectRoot, 'src');
  const tsFiles = await globFiles('**/*.ts', srcDir);
  const tsxFiles = await globFiles('**/*.tsx', srcDir);
  const allFiles = [...tsFiles, ...tsxFiles];

  // Read all file contents
  const allContents: string[] = [];
  for (const file of allFiles) {
    const content = readFileContent(file);
    if (content) allContents.push(content);
  }
  const combinedContent = allContents.join('\n');

  for (const shortcut of registry.shortcuts) {
    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (allFiles.length === 0) {
      status = 'skip';
      actual = 'src/ 下未找到 .ts/.tsx 文件';
    } else {
      // Check Electron accelerator format
      const accelerator = toElectronAccelerator(shortcut.macOS);
      const variants = getKeyVariants(shortcut.macOS);

      let found = false;
      for (const variant of variants) {
        if (contentContains(combinedContent, `'${variant}'`) ||
            contentContains(combinedContent, `"${variant}"`) ||
            contentContains(combinedContent, variant, true)) {
          found = true;
          break;
        }
      }

      // Also check for addEventListener keydown pattern with key match
      if (!found) {
        const keydownPattern = /addEventListener\s*\(\s*['"]keydown['"]/;
        if (keydownPattern.test(combinedContent)) {
          // Check if the key is referenced nearby
          const escapedAccel = escapeRegex(accelerator);
          const accelPattern = new RegExp(escapedAccel, 'i');
          if (accelPattern.test(combinedContent)) {
            found = true;
          }
        }
      }

      status = found ? 'pass' : 'fail';
      actual = found
        ? `快捷键 '${accelerator}' 已注册`
        : `未找到快捷键注册: ${accelerator}`;
    }

    results.push({
      id: `A11.shortcut.${shortcut.action}`,
      dimension: 'A',
      description: `快捷键注册: ${shortcut.action} (${shortcut.macOS})`,
      status,
      expected: `快捷键 '${toElectronAccelerator(shortcut.macOS)}' 在代码中已注册`,
      actual,
      sourceRef: shortcut.sourceLocation,
    });
  }

  return results;
}

registerVerifier({
  id: 'A11',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: '快捷键',
  fn: verify,
});
