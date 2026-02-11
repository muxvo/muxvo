import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles } from '../../utils/file-helpers.js';
import { searchInContent } from '../../utils/pattern-matchers.js';

// Map param name/context keywords to search patterns and file globs
interface SearchMapping {
  fileGlobs: string[];
  codePatterns: RegExp[];
}

function getSearchMapping(name: string, context: string): SearchMapping {
  const lower = (name + ' ' + context).toLowerCase();

  if (lower.includes('去抖') || lower.includes('debounce')) {
    return {
      fileGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
      codePatterns: [/debounce/i],
    };
  }
  if (lower.includes('分页') || lower.includes('page')) {
    return {
      fileGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
      codePatterns: [/pageSize|PAGE_SIZE|limit/i],
    };
  }
  if (lower.includes('内存') || lower.includes('memory')) {
    return {
      fileGlobs: ['src/main/**/*.ts'],
      codePatterns: [/threshold|MEMORY/i],
    };
  }
  if (lower.includes('终端') || lower.includes('terminal') || lower.includes('最大')) {
    return {
      fileGlobs: ['src/main/**/*.ts', 'src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
      codePatterns: [/MAX_TERMINAL|maxTerminal/i],
    };
  }
  if (lower.includes('缓冲') || lower.includes('scrollback')) {
    return {
      fileGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
      codePatterns: [/scrollback/i],
    };
  }
  if (lower.includes('缓存') || lower.includes('cache')) {
    return {
      fileGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
      codePatterns: [/cache|CACHE/i],
    };
  }
  if (lower.includes('延迟') || lower.includes('delay')) {
    return {
      fileGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
      codePatterns: [/delay|DELAY|debounce/i],
    };
  }

  // Fallback: search all source files
  return {
    fileGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
    codePatterns: [],
  };
}

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const param of registry.performanceParams) {
    const mapping = getSearchMapping(param.name, param.context);

    // Collect all files matching the globs
    const allFiles: string[] = [];
    for (const g of mapping.fileGlobs) {
      const files = await globFiles(g, projectRoot);
      allFiles.push(...files);
    }

    // Deduplicate
    const uniqueFiles = [...new Set(allFiles)];

    if (uniqueFiles.length === 0) {
      results.push({
        id: `B2.perf.${param.name}`,
        dimension: 'B',
        description: `Performance param: ${param.name} = ${param.value}`,
        status: 'skip',
        expected: `${param.name} = ${param.numericValue} (${param.unit})`,
        actual: 'no source files found to search',
        sourceRef: param.sourceLocation,
      });
      continue;
    }

    let foundMatch = false;
    let foundMismatch = false;
    let foundFile = '';
    let foundValue = '';

    // Build numeric value search — also consider unit conversions
    const numericValues = [param.numericValue];
    // GB to MB conversion
    if (param.unit.toLowerCase().includes('gb')) {
      numericValues.push(param.numericValue * 1024);
    }
    // MB to bytes
    if (param.unit.toLowerCase().includes('mb')) {
      numericValues.push(param.numericValue * 1024 * 1024);
    }
    // seconds to ms
    if (param.unit === 's' || param.unit.toLowerCase() === 'seconds' || param.unit.toLowerCase() === '秒') {
      numericValues.push(param.numericValue * 1000);
    }

    for (const filePath of uniqueFiles) {
      if (foundMatch) break;

      const content = readFileContent(filePath);
      if (!content) continue;

      // Check if file contains relevant code patterns
      const hasRelevantCode = mapping.codePatterns.length === 0 ||
        mapping.codePatterns.some(p => p.test(content));

      if (!hasRelevantCode) continue;

      // Also use codePattern hint from spec if available
      if (param.codePattern) {
        const patternRegex = new RegExp(param.codePattern, 'i');
        if (patternRegex.test(content)) {
          // Check for numeric value near the pattern
          for (const numVal of numericValues) {
            const numStr = String(numVal);
            if (content.includes(numStr)) {
              foundMatch = true;
              foundFile = filePath.replace(projectRoot + '/', '');
              foundValue = numStr;
              break;
            }
          }
        }
      }

      if (foundMatch) break;

      // Search for numeric values in context of relevant patterns
      for (const pattern of mapping.codePatterns) {
        const matches = searchInContent(content, pattern);
        if (matches.length === 0) continue;

        for (const numVal of numericValues) {
          const numStr = String(numVal);
          if (content.includes(numStr)) {
            foundMatch = true;
            foundFile = filePath.replace(projectRoot + '/', '');
            foundValue = numStr;
            break;
          }
        }
        if (foundMatch) break;

        // If code pattern found but no matching numeric value, check for mismatched values
        foundMismatch = true;
        foundFile = filePath.replace(projectRoot + '/', '');
      }
    }

    if (foundMatch) {
      results.push({
        id: `B2.perf.${param.name}`,
        dimension: 'B',
        description: `Performance param: ${param.name} = ${param.value}`,
        status: 'pass',
        expected: `${param.name} = ${param.numericValue} (${param.unit})`,
        actual: `value ${foundValue} found in ${foundFile}`,
        sourceRef: param.sourceLocation,
      });
    } else if (foundMismatch) {
      results.push({
        id: `B2.perf.${param.name}`,
        dimension: 'B',
        description: `Performance param: ${param.name} = ${param.value}`,
        status: 'fail',
        expected: `${param.name} = ${param.numericValue} (${param.unit})`,
        actual: `code pattern found in ${foundFile} but numeric value ${param.numericValue} not matched`,
        sourceRef: param.sourceLocation,
      });
    } else {
      results.push({
        id: `B2.perf.${param.name}`,
        dimension: 'B',
        description: `Performance param: ${param.name} = ${param.value}`,
        status: 'skip',
        expected: `${param.name} = ${param.numericValue} (${param.unit})`,
        actual: 'no relevant code pattern found in source files',
        sourceRef: param.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'B2',
  dimension: 'B',
  dimensionName: 'B.代码逻辑',
  name: '性能参数',
  fn: verify,
});
