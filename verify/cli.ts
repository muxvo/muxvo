import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractAllSpecs } from './spec/extract-all.js';
import { runAllVerifiers } from './verifiers/runner.js';
import { generateReport, type ReportFormat } from './report/reporter.js';

// Import all verifier registrations
import './verifiers/static/directory-structure.verifier.js';
import './verifiers/static/ipc-channels.verifier.js';
import './verifiers/static/ipc-handlers.verifier.js';
import './verifiers/static/preload-bridge.verifier.js';
import './verifiers/static/state-machine-files.verifier.js';
import './verifiers/static/state-machine-states.verifier.js';
import './verifiers/static/store-files.verifier.js';
import './verifiers/static/type-definitions.verifier.js';
import './verifiers/static/analytics-events.verifier.js';
import './verifiers/static/error-codes.verifier.js';
import './verifiers/static/shortcuts.verifier.js';
import './verifiers/logic/ipc-types.verifier.js';
import './verifiers/logic/performance-params.verifier.js';
import './verifiers/logic/exception-handling.verifier.js';
import './verifiers/logic/empty-state-copy.verifier.js';
import './verifiers/test-coverage/unit-tests.verifier.js';
import './verifiers/test-coverage/integration-tests.verifier.js';
import './verifiers/test-coverage/e2e-tests.verifier.js';

interface CliArgs {
  root: string;
  phase: string;
  dimensions: string;
  format: ReportFormat;
  specOnly: boolean;
  useCache: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    root: path.resolve(process.cwd(), '..'),
    phase: 'V1',
    dimensions: 'all',
    format: 'console',
    specOnly: false,
    useCache: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root':
        result.root = path.resolve(args[++i]);
        break;
      case '--phase':
        result.phase = args[++i];
        break;
      case '--dimensions':
        result.dimensions = args[++i];
        break;
      case '--format':
        result.format = args[++i] as ReportFormat;
        break;
      case '--spec-only':
        result.specOnly = true;
        break;
      case '--use-cache':
        result.useCache = true;
        break;
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cacheFile = path.join(import.meta.dirname, 'spec', '__generated__', 'spec-registry.json');

  // Step 1: Extract or load specs
  let registry;
  if (args.useCache && fs.existsSync(cacheFile)) {
    console.log('Loading cached spec registry...');
    registry = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  } else {
    console.log('Extracting specs from documents...');
    const prdPath = path.join(args.root, 'PRD.md');
    const devPlanPath = path.join(args.root, 'DEV-PLAN.md');

    if (!fs.existsSync(prdPath)) {
      console.error(`PRD.md not found at ${prdPath}`);
      process.exit(1);
    }
    if (!fs.existsSync(devPlanPath)) {
      console.error(`DEV-PLAN.md not found at ${devPlanPath}`);
      process.exit(1);
    }

    registry = await extractAllSpecs(prdPath, devPlanPath);

    // Cache the result
    const genDir = path.dirname(cacheFile);
    fs.mkdirSync(genDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(registry, null, 2));
    console.log(`Spec registry cached at ${cacheFile}`);
  }

  // Spec summary
  console.log('');
  console.log('Spec Registry Summary:');
  console.log(`  IPC Channels:     ${registry.ipcChannels.length}`);
  console.log(`  Directory Entries: ${registry.directoryTree.length}`);
  console.log(`  State Machines:   ${registry.stateMachines.length}`);
  console.log(`  Data Structures:  ${registry.dataStructures.length}`);
  console.log(`  Shortcuts:        ${registry.shortcuts.length}`);
  console.log(`  Analytics Events: ${registry.analyticsEvents.length}`);
  console.log(`  Error Codes:      ${registry.errorCodes.length}`);
  console.log(`  Exceptions:       ${registry.exceptions.length}`);
  console.log(`  Perf Params:      ${registry.performanceParams.length}`);
  console.log(`  Empty States:     ${registry.emptyStates.length}`);
  console.log(`  Test Coverage:    ${registry.testCoverage.unit.length} unit + ${registry.testCoverage.integration.length} integration + ${registry.testCoverage.e2e.length} e2e`);
  console.log('');

  if (args.specOnly) {
    console.log('Spec extraction complete. Exiting (--spec-only).');
    return;
  }

  // Step 2: Run verifiers
  console.log(`Running verifiers (phase: ${args.phase}, dimensions: ${args.dimensions})...`);
  const report = await runAllVerifiers(registry, args.root, args.phase, args.dimensions);

  // Step 3: Generate report
  generateReport(report, args.format);

  // Exit code
  if (report.summary.failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(2);
});
