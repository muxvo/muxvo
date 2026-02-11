import type { VerificationReport, DimensionReport, CheckResult } from '../../spec/registry.js';

export function renderHtmlReport(report: VerificationReport): string {
  const { summary, dimensions, phase, duration, timestamp } = report;
  const passRate = (summary.coverage * 100).toFixed(1);
  const statusColor = summary.coverage >= 0.9 ? '#22c55e' : summary.coverage >= 0.7 ? '#eab308' : '#ef4444';

  const dimensionSections = Object.entries(dimensions)
    .map(([name, dim]) => renderDimensionHtml(name, dim))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Muxvo Spec Verification Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  .meta { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
  .summary { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .stat { background: #1e293b; border-radius: 8px; padding: 1rem 1.5rem; min-width: 140px; }
  .stat-value { font-size: 1.5rem; font-weight: bold; }
  .stat-label { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; margin-top: 0.25rem; }
  .pass { color: #22c55e; }
  .fail { color: #ef4444; }
  .skip { color: #6b7280; }
  .dimension { background: #1e293b; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
  .dim-header { padding: 1rem 1.5rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .dim-header:hover { background: #334155; }
  .dim-title { font-weight: 600; }
  .dim-stats { font-size: 0.875rem; color: #94a3b8; }
  .dim-body { display: none; border-top: 1px solid #334155; }
  .dim-body.open { display: block; }
  .check { padding: 0.5rem 1.5rem; border-bottom: 1px solid #1e293b; font-size: 0.875rem; display: flex; gap: 0.75rem; align-items: baseline; }
  .check:last-child { border-bottom: none; }
  .check-icon { flex-shrink: 0; width: 1.25rem; text-align: center; }
  .check-id { color: #94a3b8; min-width: 200px; font-family: monospace; font-size: 0.8rem; }
  .check-desc { flex: 1; }
  .check-detail { background: #0f172a; padding: 0.5rem 1.5rem 0.5rem 3.5rem; font-size: 0.8rem; color: #94a3b8; }
  .progress-bar { height: 4px; background: #334155; border-radius: 2px; overflow: hidden; width: 120px; }
  .progress-fill { height: 100%; border-radius: 2px; }
  .toggle { font-size: 0.75rem; color: #64748b; }
</style>
</head>
<body>
<div class="container">
  <h1>Muxvo Spec Verification Report</h1>
  <div class="meta">Phase: ${phase} | Generated: ${timestamp} | Duration: ${duration}ms</div>

  <div class="summary">
    <div class="stat">
      <div class="stat-value" style="color: ${statusColor}">${passRate}%</div>
      <div class="stat-label">Coverage</div>
    </div>
    <div class="stat">
      <div class="stat-value">${summary.total}</div>
      <div class="stat-label">Total Checks</div>
    </div>
    <div class="stat">
      <div class="stat-value pass">${summary.passed}</div>
      <div class="stat-label">Passed</div>
    </div>
    <div class="stat">
      <div class="stat-value fail">${summary.failed}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat">
      <div class="stat-value skip">${summary.skipped}</div>
      <div class="stat-label">Skipped</div>
    </div>
  </div>

  ${dimensionSections}
</div>

<script>
document.querySelectorAll('.dim-header').forEach(header => {
  header.addEventListener('click', () => {
    const body = header.nextElementSibling;
    body.classList.toggle('open');
    header.querySelector('.toggle').textContent = body.classList.contains('open') ? '▼' : '▶';
  });
});
</script>
</body>
</html>`;
}

function renderDimensionHtml(name: string, dim: DimensionReport): string {
  const rate = dim.total > 0 ? ((dim.passed / dim.total) * 100).toFixed(0) : '0';
  const color = dim.failed === 0 ? '#22c55e' : dim.failed <= 3 ? '#eab308' : '#ef4444';

  const checks = dim.checks.map(c => {
    const icon = c.status === 'pass' ? '<span class="pass">✓</span>'
      : c.status === 'fail' ? '<span class="fail">✗</span>'
      : '<span class="skip">○</span>';
    const detail = c.status === 'fail'
      ? `<div class="check-detail">Expected: ${esc(c.expected)} | Actual: ${esc(c.actual)}${c.details ? ' | ' + esc(c.details) : ''}</div>`
      : '';
    return `<div class="check"><span class="check-icon">${icon}</span><span class="check-id">${esc(c.id)}</span><span class="check-desc">${esc(c.description)}</span></div>${detail}`;
  }).join('\n');

  return `
  <div class="dimension">
    <div class="dim-header">
      <span class="dim-title">${esc(name)}</span>
      <span class="dim-stats">
        <span class="toggle">▶</span>
        <span style="color:${color}">${rate}%</span> (${dim.passed}/${dim.total})
        <div class="progress-bar"><div class="progress-fill" style="width:${rate}%; background:${color}"></div></div>
      </span>
    </div>
    <div class="dim-body">${checks}</div>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
