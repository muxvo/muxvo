/**
 * Config persistence module
 */

interface ConfigData {
  openTerminals: string[];
  gridLayout: {
    columnRatios: number[];
    perRowColumnRatios?: number[][];
    rowRatios: number[];
  };
}

export function createConfigPersistence() {
  let _config: ConfigData | null = null;
  const _preferences: Record<string, unknown> = {};

  return {
    async save(config: ConfigData) {
      _config = { ...config };
    },
    async load(): Promise<ConfigData> {
      return _config!;
    },
    async savePreference(key: string, value: unknown) {
      _preferences[key] = value;
    },
    async loadPreference(key: string) {
      return _preferences[key];
    },
  };
}
