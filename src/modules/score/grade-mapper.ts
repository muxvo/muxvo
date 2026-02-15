/**
 * Grade Mapper - maps numeric scores to grade labels
 */

const GRADE_MAP: Array<{ min: number; max: number; grade: string }> = [
  { min: 0, max: 39, grade: 'Promising' },
  { min: 40, max: 59, grade: 'Solid' },
  { min: 60, max: 79, grade: 'Advanced' },
  { min: 80, max: 94, grade: 'Expert' },
  { min: 95, max: 100, grade: 'Masterwork' },
];

export function mapScoreToGrade(score: number): string {
  for (const entry of GRADE_MAP) {
    if (score >= entry.min && score <= entry.max) {
      return entry.grade;
    }
  }
  return 'Promising';
}
