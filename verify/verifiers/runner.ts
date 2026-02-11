import type {
  SpecRegistry,
  VerificationReport,
  DimensionReport,
  CheckResult,
} from '../spec/registry.js';

export type VerifierFn = (
  registry: SpecRegistry,
  projectRoot: string,
  activePhase: string,
) => Promise<CheckResult[]>;

export interface VerifierRegistration {
  id: string;
  dimension: string;           // "A" | "B" | "C"
  dimensionName: string;       // "A.静态结构" | "B.代码逻辑" | "C.测试覆盖"
  name: string;
  fn: VerifierFn;
}

const verifiers: VerifierRegistration[] = [];

export function registerVerifier(reg: VerifierRegistration): void {
  verifiers.push(reg);
}

export async function runAllVerifiers(
  registry: SpecRegistry,
  projectRoot: string,
  activePhase: string,
  dimensionFilter: string,
): Promise<VerificationReport> {
  const startTime = Date.now();
  const dimensions: Record<string, DimensionReport> = {};

  const filteredVerifiers = dimensionFilter === 'all'
    ? verifiers
    : verifiers.filter(v => dimensionFilter.includes(v.dimension));

  for (const verifier of filteredVerifiers) {
    const results = await verifier.fn(registry, projectRoot, activePhase);

    if (!dimensions[verifier.dimensionName]) {
      dimensions[verifier.dimensionName] = {
        name: verifier.dimensionName,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        checks: [],
      };
    }

    const dim = dimensions[verifier.dimensionName];
    for (const r of results) {
      dim.checks.push(r);
      dim.total++;
      if (r.status === 'pass') dim.passed++;
      else if (r.status === 'fail') dim.failed++;
      else dim.skipped++;
    }
  }

  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    coverage: 0,
  };

  for (const dim of Object.values(dimensions)) {
    summary.total += dim.total;
    summary.passed += dim.passed;
    summary.failed += dim.failed;
    summary.skipped += dim.skipped;
  }
  summary.coverage = summary.total > 0 ? summary.passed / summary.total : 0;

  return {
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    phase: activePhase,
    summary,
    dimensions,
  };
}

export function getRegisteredVerifiers(): VerifierRegistration[] {
  return [...verifiers];
}
