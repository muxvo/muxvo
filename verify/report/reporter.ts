import type { VerificationReport } from '../spec/registry.js';
import { renderConsoleReport } from './templates/console.js';
import { renderHtmlReport } from './templates/html.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ReportFormat = 'console' | 'json' | 'html';

export function generateReport(
  report: VerificationReport,
  format: ReportFormat,
  outputDir?: string,
): void {
  switch (format) {
    case 'console':
      renderConsoleReport(report);
      break;

    case 'json': {
      const json = JSON.stringify(report, null, 2);
      if (outputDir) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'report.json'), json);
      } else {
        console.log(json);
      }
      break;
    }

    case 'html': {
      const dir = outputDir || path.join(process.cwd(), 'report', 'output');
      fs.mkdirSync(dir, { recursive: true });
      const html = renderHtmlReport(report);
      const outPath = path.join(dir, 'index.html');
      fs.writeFileSync(outPath, html);
      console.log(`HTML report: ${outPath}`);
      break;
    }
  }
}
