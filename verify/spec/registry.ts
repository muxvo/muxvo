// SpecRegistry — 从 PRD.md / DEV-PLAN.md 自动提取的规约注册表

export interface SpecRegistry {
  version: string;
  extractedAt: string;
  sourceFiles: {
    prd: string;
    devPlan: string;
  };

  ipcChannels: IPCChannelSpec[];
  directoryTree: DirectoryEntrySpec[];
  stateMachines: StateMachineSpec[];
  dataStructures: DataStructureSpec[];
  shortcuts: ShortcutSpec[];
  analyticsEvents: AnalyticsEventSpec[];
  errorCodes: ErrorCodeSpec[];
  exceptions: ExceptionSpec[];
  performanceParams: PerformanceParamSpec[];
  emptyStates: EmptyStateSpec[];
  testCoverage: TestCoverageSpec;
}

export interface IPCChannelSpec {
  name: string;               // e.g., "terminal:create"
  domain: string;             // e.g., "terminal"
  direction: string;          // "R→M" | "M→R"
  paramType: string;          // e.g., "{ cwd: string }"
  returnType: string;         // e.g., "{ id: string, pid: number }"
  description: string;
  phase: string;              // "V1" | "V2-P0" | "V2-P1" | "V2-P2"
  sourceLocation: SourceLocation;
}

export interface DirectoryEntrySpec {
  path: string;               // e.g., "src/main/ipc/terminal.ipc.ts"
  type: 'file' | 'directory';
  phase: string;
  sourceLocation: SourceLocation;
}

export interface StateMachineSpec {
  name: string;               // e.g., "terminal-process"
  fileName: string;           // e.g., "terminal-process.machine.ts"
  prdSection: string;         // e.g., "6.2"
  states: string[];
  transitions: TransitionSpec[];
  sourceLocation: SourceLocation;
}

export interface TransitionSpec {
  from: string;
  to: string;
  event: string;
}

export interface DataStructureSpec {
  name: string;               // e.g., "MuxvoConfig"
  fields: FieldSpec[];
  sourceFile: string;         // e.g., "config.types.ts"
  sourceLocation: SourceLocation;
}

export interface FieldSpec {
  name: string;
  type: string;
  required: boolean;
}

export interface ShortcutSpec {
  action: string;
  macOS: string;
  windowsLinux: string;
  scope: string;
  sourceLocation: SourceLocation;
}

export interface AnalyticsEventSpec {
  name: string;               // e.g., "terminal.create"
  category: string;
  params: Record<string, string>;
  phase: string;
  sourceLocation: SourceLocation;
}

export interface ErrorCodeSpec {
  code: string;               // e.g., "terminal.spawn_failed"
  domain: string;
  description: string;
  sourceLocation: SourceLocation;
}

export interface ExceptionSpec {
  id: number;
  scenario: string;
  handling: string;
  copyText: string;
  responsibleTask: string;
  sourceLocation: SourceLocation;
}

export interface PerformanceParamSpec {
  name: string;
  value: string;
  numericValue: number;
  unit: string;
  context: string;
  codePattern?: string;       // 代码中查找的模式提示
  sourceLocation: SourceLocation;
}

export interface EmptyStateSpec {
  area: string;
  scenario: string;
  copyText: string;
  icon: string;
  actionButton: string;
  sourceLocation: SourceLocation;
}

export interface TestCoverageSpec {
  unit: UnitTestSpec[];
  integration: IntegrationTestSpec[];
  e2e: E2ETestSpec[];
}

export interface UnitTestSpec {
  module: string;
  description: string;
  expectedCount: number;
}

export interface IntegrationTestSpec {
  scenario: string;
  description: string;
}

export interface E2ETestSpec {
  flow: string;
  description: string;
}

export interface SourceLocation {
  file: string;
  line: number;
}

// Verification report types

export interface VerificationReport {
  timestamp: string;
  duration: number;
  phase: string;
  summary: ReportSummary;
  dimensions: Record<string, DimensionReport>;
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage: number;
}

export interface DimensionReport {
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  checks: CheckResult[];
}

export interface CheckResult {
  id: string;
  dimension: string;
  description: string;
  status: 'pass' | 'fail' | 'skip';
  expected: string;
  actual: string;
  sourceRef: SourceLocation;
  codeRef?: SourceLocation;
  details?: string;
}

// Phase ordering utility
const PHASE_ORDER: Record<string, number> = {
  'V1': 1,
  'V2-P0': 2,
  'V2-P1': 3,
  'V2-P2': 4,
};

export function phaseOrder(phase: string): number {
  return PHASE_ORDER[phase] ?? 1;
}

export function isPhaseIncluded(specPhase: string, activePhase: string): boolean {
  return phaseOrder(specPhase) <= phaseOrder(activePhase);
}
