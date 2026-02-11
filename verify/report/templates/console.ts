import chalk from 'chalk';
import type { VerificationReport, DimensionReport, CheckResult } from '../../spec/registry.js';

export function renderConsoleReport(report: VerificationReport): void {
  const { summary, dimensions, phase, duration } = report;

  console.log('');
  console.log(chalk.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.bold('  Muxvo Spec Verification Report'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════'));
  console.log(`  Phase: ${chalk.cyan(phase)}  |  Duration: ${chalk.cyan(duration + 'ms')}`);
  console.log('');

  // Summary bar
  const passRate = (summary.coverage * 100).toFixed(1);
  const passColor = summary.coverage >= 0.9 ? chalk.green : summary.coverage >= 0.7 ? chalk.yellow : chalk.red;
  console.log(`  ${passColor('■')} Pass: ${chalk.green(summary.passed)}  ${chalk.red('■')} Fail: ${chalk.red(summary.failed)}  ${chalk.gray('■')} Skip: ${chalk.gray(summary.skipped)}  |  Total: ${summary.total}  |  Coverage: ${passColor(passRate + '%')}`);
  console.log('');

  // Per-dimension details
  for (const [dimName, dim] of Object.entries(dimensions)) {
    renderDimension(dimName, dim);
  }

  console.log(chalk.bold('═══════════════════════════════════════════════════════'));
  if (summary.failed > 0) {
    console.log(chalk.red(`  ${summary.failed} check(s) failed. See details above.`));
  } else {
    console.log(chalk.green('  All checks passed!'));
  }
  console.log('');
}

function renderDimension(name: string, dim: DimensionReport): void {
  const dimPassRate = dim.total > 0 ? ((dim.passed / dim.total) * 100).toFixed(0) : '0';
  const color = dim.failed === 0 ? chalk.green : chalk.red;

  console.log(chalk.bold(`  ── ${name} ──`));
  console.log(`     ${color(dimPassRate + '%')}  (${dim.passed}/${dim.total} passed, ${dim.failed} failed, ${dim.skipped} skipped)`);

  // Show failed checks
  const failed = dim.checks.filter(c => c.status === 'fail');
  if (failed.length > 0) {
    console.log('');
    for (const check of failed) {
      renderFailedCheck(check);
    }
  }
  console.log('');
}

function renderFailedCheck(check: CheckResult): void {
  console.log(`     ${chalk.red('✗')} ${chalk.red(check.id)}: ${check.description}`);
  console.log(`       Expected: ${chalk.green(check.expected)}`);
  console.log(`       Actual:   ${chalk.red(check.actual)}`);
  if (check.details) {
    console.log(`       Details:  ${chalk.gray(check.details)}`);
  }
  const loc = check.sourceRef;
  console.log(`       Ref:      ${chalk.gray(loc.file + ':' + loc.line)}`);
}
