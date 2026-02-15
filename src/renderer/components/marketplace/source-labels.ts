/**
 * Source Labels - mapping of source types to display labels
 */

const SOURCE_LABELS = [
  'Anthropic 官方',
  'SkillsMP',
  'GitHub',
  'npm',
  '社区',
  '本地',
];

export function getSourceLabels(): string[] {
  return [...SOURCE_LABELS];
}
