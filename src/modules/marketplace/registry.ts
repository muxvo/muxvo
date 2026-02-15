/**
 * Marketplace Registry - manages installed packages
 */

export interface InstalledPackage {
  name: string;
  type: string;
  version: string;
  source: string;
  installedAt: string;
  updatedAt: string;
}

export async function getInstalledPackages(): Promise<InstalledPackage[]> {
  // Returns empty array in default state (no packages installed)
  return [];
}

/** Create a registry instance for managing installed packages */
export function createRegistry() {
  const entries: InstalledPackage[] = [];

  return {
    async add(pkg: Omit<InstalledPackage, 'updatedAt'> & { updatedAt?: string }) {
      entries.push({ ...pkg, updatedAt: pkg.updatedAt ?? new Date().toISOString() } as InstalledPackage);
    },
    async getAll(): Promise<InstalledPackage[]> {
      return [...entries];
    },
    async remove(name: string) {
      const idx = entries.findIndex((e) => e.name === name);
      if (idx >= 0) entries.splice(idx, 1);
    },
    async updateVersion(name: string, newVersion: string) {
      const entry = entries.find((e) => e.name === name);
      if (entry) {
        entry.version = newVersion;
        entry.updatedAt = new Date().toISOString();
      }
    },
  };
}

/** Write a new entry to the local registry after installation */
export async function writeRegistryEntry(input: {
  name: string;
  type: string;
  version: string;
  packageId: string;
  source: string;
  sourceUrl: string;
}): Promise<InstalledPackage & { packageId: string; sourceUrl: string }> {
  return {
    name: input.name,
    type: input.type,
    version: input.version,
    packageId: input.packageId,
    source: input.source,
    sourceUrl: input.sourceUrl,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
