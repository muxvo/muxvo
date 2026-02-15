/**
 * Marketplace Validators - validates package structure
 */

const REQUIRED_FIELDS = [
  'id', 'name', 'type', 'displayName', 'description', 'readme',
  'author', 'category', 'tags', 'license', 'stats',
  'latestVersion', 'versions', 'createdAt', 'updatedAt',
];

export interface ValidationResult {
  valid: boolean;
  requiredFields: string[];
  missingFields: string[];
}

export function validatePackageStructure(pkg: Record<string, unknown>): ValidationResult {
  const missingFields = REQUIRED_FIELDS.filter((f) => !(f in pkg));
  return {
    valid: missingFields.length === 0,
    requiredFields: [...REQUIRED_FIELDS],
    missingFields,
  };
}
