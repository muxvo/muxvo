// extract-all.ts — 主入口，调用所有 parser 并组装 SpecRegistry
import * as fs from 'node:fs';
import type { SpecRegistry } from './registry.js';
import { extractIPCChannels } from './parsers/ipc-channels.parser.js';
import { extractDirectoryTree } from './parsers/directory-tree.parser.js';
import { extractStateMachines } from './parsers/state-machines.parser.js';
import { extractDataStructures } from './parsers/data-structures.parser.js';
import { extractShortcuts } from './parsers/shortcuts.parser.js';
import { extractAnalyticsEvents } from './parsers/analytics-events.parser.js';
import { extractErrorCodes } from './parsers/error-codes.parser.js';
import { extractExceptions } from './parsers/exceptions.parser.js';
import { extractPerformanceParams } from './parsers/performance.parser.js';
import { extractEmptyStates } from './parsers/empty-states.parser.js';
import { extractTestCoverage } from './parsers/test-coverage.parser.js';

export async function extractAllSpecs(prdPath: string, devPlanPath: string): Promise<SpecRegistry> {
  const prdContent = fs.readFileSync(prdPath, 'utf-8');
  const devPlanContent = fs.readFileSync(devPlanPath, 'utf-8');

  return {
    version: '1.0.0',
    extractedAt: new Date().toISOString(),
    sourceFiles: { prd: prdPath, devPlan: devPlanPath },
    ipcChannels: extractIPCChannels(devPlanContent),
    directoryTree: extractDirectoryTree(devPlanContent),
    stateMachines: extractStateMachines(prdContent),
    dataStructures: extractDataStructures(prdContent),
    shortcuts: extractShortcuts(devPlanContent),
    analyticsEvents: extractAnalyticsEvents(devPlanContent, prdContent),
    errorCodes: extractErrorCodes(devPlanContent),
    exceptions: extractExceptions(prdContent),
    performanceParams: extractPerformanceParams(prdContent, devPlanContent),
    emptyStates: extractEmptyStates(prdContent),
    testCoverage: extractTestCoverage(devPlanContent),
  };
}
