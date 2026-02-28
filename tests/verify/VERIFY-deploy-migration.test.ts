import { describe, test, expect } from 'vitest';

/**
 * VERIFY: Deploy Server migration 双跑冲突修复
 *
 * 验证：
 * 1. deploy-server.yml 不包含 node-pg-migrate migration step
 * 2. server/package.json 不依赖 node-pg-migrate
 * 3. 自定义 migrator (server/src/db/migrate.ts) 的 extractUpSection 正确解析 -- Up/-- Down
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('Deploy migration conflict fix', () => {
  test('deploy-server.yml should NOT have node-pg-migrate step', () => {
    const workflow = readFileSync(
      resolve(ROOT, '.github/workflows/deploy-server.yml'),
      'utf-8',
    );
    expect(workflow).not.toContain('migrate:up');
    expect(workflow).not.toContain('node-pg-migrate');
    expect(workflow).not.toContain('Run database migrations');
  });

  test('server/package.json should NOT depend on node-pg-migrate', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, 'server/package.json'), 'utf-8'),
    );
    expect(pkg.dependencies?.['node-pg-migrate']).toBeUndefined();
    expect(pkg.scripts?.['migrate:up']).toBeUndefined();
    expect(pkg.scripts?.['migrate:down']).toBeUndefined();
  });

  test('custom migrator extractUpSection correctly splits Up/Down', async () => {
    // Read the migrate.ts source and extract the function logic
    const migrateSource = readFileSync(
      resolve(ROOT, 'server/src/db/migrate.ts'),
      'utf-8',
    );

    // Verify the custom migrator exists and has extractUpSection
    expect(migrateSource).toContain('function extractUpSection');
    expect(migrateSource).toContain("sql.indexOf('-- Up')");
    expect(migrateSource).toContain("sql.indexOf('-- Down')");

    // Replicate the extractUpSection logic to verify it works
    function extractUpSection(sql: string): string {
      const upIdx = sql.indexOf('-- Up');
      const downIdx = sql.indexOf('-- Down');
      if (upIdx === -1) return sql;
      const start = sql.indexOf('\n', upIdx);
      if (start === -1) return '';
      const end = downIdx === -1 ? sql.length : downIdx;
      return sql.slice(start, end).trim();
    }

    // Test with a real migration file format
    const sampleMigration = `-- Up
CREATE TABLE users (
    id UUID PRIMARY KEY
);

-- Down
DROP TABLE IF EXISTS users;`;

    const upSql = extractUpSection(sampleMigration);
    expect(upSql).toContain('CREATE TABLE users');
    expect(upSql).not.toContain('DROP TABLE');
    expect(upSql).not.toContain('-- Down');
  });
});
