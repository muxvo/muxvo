/**
 * VERIFY-deploy-env: 验证 deploy-server.yml 包含 env 变量保障机制
 *
 * 确保部署流程中：
 * 1. 有 "Ensure server .env" 步骤，从 GitHub Secrets 写入所有必需变量
 * 2. 有 "Ensure docker-compose .env" 步骤，写入 DB_PASSWORD
 * 3. 有 "Validate env vars" 步骤，验证关键变量非空
 * 4. Ensure 步骤在 Build 步骤之前执行
 * 5. 所有 .env.example 中的 key 都在 Ensure 步骤中被覆盖
 */
import { describe, test, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/deploy-server.yml')
const ENV_EXAMPLE_PATH = resolve(__dirname, '../../server/.env.example')

let workflowContent: string
let stepNames: string[]

beforeAll(() => {
  workflowContent = readFileSync(WORKFLOW_PATH, 'utf-8')
  // Extract step names from "- name: ..." pattern
  stepNames = [...workflowContent.matchAll(/- name: (.+)/g)].map((m) => m[1].trim())
})

/** Get the run block content for a named step */
function getStepRun(stepName: string): string {
  // Find "- name: <stepName>" then extract everything until the next "- name:" or end
  const pattern = new RegExp(
    `- name: ${stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+run: \\|([\\s\\S]*?)(?=\\n\\s+- name:|$)`,
  )
  const match = workflowContent.match(pattern)
  return match ? match[1] : ''
}

/** Get all KEY= lines from .env.example (skip comments) */
function getEnvExampleKeys(): string[] {
  const raw = readFileSync(ENV_EXAMPLE_PATH, 'utf-8')
  return raw
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => line.split('=')[0])
}

describe('deploy-server.yml env 变量保障', () => {
  test('包含 "Ensure server .env" 步骤', () => {
    expect(stepNames).toContain('Ensure server .env')
  })

  test('包含 "Ensure docker-compose .env" 步骤', () => {
    expect(stepNames).toContain('Ensure docker-compose .env')
  })

  test('包含 "Validate env vars" 步骤', () => {
    expect(stepNames).toContain('Validate env vars')
  })

  test('Ensure 步骤在 Build 步骤之前', () => {
    const ensureIdx = stepNames.indexOf('Ensure server .env')
    const validateIdx = stepNames.indexOf('Validate env vars')
    const buildIdx = stepNames.indexOf('Build and restart containers')

    expect(ensureIdx).toBeGreaterThan(-1)
    expect(validateIdx).toBeGreaterThan(-1)
    expect(buildIdx).toBeGreaterThan(-1)
    expect(ensureIdx).toBeLessThan(buildIdx)
    expect(validateIdx).toBeLessThan(buildIdx)
  })

  test('Ensure server .env 引用所有必需的 OAuth Secrets', () => {
    const run = getStepRun('Ensure server .env')

    // GitHub OAuth (OAUTH_GH_ 前缀，因 GitHub 不允许 GITHUB_ 前缀 Secret)
    expect(run).toContain('secrets.OAUTH_GH_CLIENT_ID')
    expect(run).toContain('secrets.OAUTH_GH_CLIENT_SECRET')

    // Google OAuth
    expect(run).toContain('secrets.GOOGLE_CLIENT_ID')
    expect(run).toContain('secrets.GOOGLE_CLIENT_SECRET')

    // Database
    expect(run).toContain('secrets.DB_PASSWORD')
  })

  test('Ensure server .env 覆盖 .env.example 中的所有 key', () => {
    const run = getStepRun('Ensure server .env')
    const exampleKeys = getEnvExampleKeys()

    for (const key of exampleKeys) {
      expect(run, `Missing key: ${key}`).toContain(`${key}=`)
    }
  })

  test('Ensure docker-compose .env 包含 DB_PASSWORD', () => {
    const run = getStepRun('Ensure docker-compose .env')
    expect(run).toContain('DB_PASSWORD=')
    expect(run).toContain('secrets.DB_PASSWORD')
  })

  test('Validate 步骤检查所有关键变量', () => {
    const run = getStepRun('Validate env vars')
    const criticalKeys = [
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'DB_PASSWORD',
    ]
    for (const key of criticalKeys) {
      expect(run, `Validate missing: ${key}`).toContain(key)
    }
  })

  test('Validate 步骤在失败时退出（exit 1）', () => {
    const run = getStepRun('Validate env vars')
    expect(run).toContain('exit 1')
  })
})
