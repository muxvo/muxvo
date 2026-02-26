/**
 * VERIFY-restore-session — Integration test for archive session restore
 *
 * Tests the restoreSession() handler that copies .jsonl from
 * ~/.muxvo/chat-archive/ back to ~/.claude/projects/ when CC has deleted it.
 *
 * Uses real filesystem with a unique test projectHash/sessionId to avoid collisions.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { promises as fsp } from 'fs';
import { createChatHandlers } from '@/main/ipc/chat-handlers';

const TEST_PROJECT_HASH = '__test-restore-verify__';
const TEST_SESSION_ID = 'aaaaaaaa-0000-0000-0000-000000000099';
const JSONL_CONTENT = '{"type":"user","message":{"role":"user","content":"test restore"}}\n';

const archiveDir = join(homedir(), '.muxvo', 'chat-archive', TEST_PROJECT_HASH);
const archiveFile = join(archiveDir, `${TEST_SESSION_ID}.jsonl`);
const ccDir = join(homedir(), '.claude', 'projects', TEST_PROJECT_HASH);
const ccFile = join(ccDir, `${TEST_SESSION_ID}.jsonl`);

describe('VERIFY: restoreSession handler', () => {
  let handlers: ReturnType<typeof createChatHandlers>;

  beforeAll(async () => {
    handlers = createChatHandlers();
    // Clean up any leftover from previous runs
    await fsp.rm(archiveDir, { recursive: true, force: true });
    await fsp.rm(ccDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    // Clean up test artifacts
    await fsp.rm(archiveDir, { recursive: true, force: true });
    await fsp.rm(ccDir, { recursive: true, force: true });
  });

  test('returns archive-not-found when neither archive nor CC has the file', async () => {
    const result = await handlers.restoreSession({
      projectHash: TEST_PROJECT_HASH,
      sessionId: TEST_SESSION_ID,
    });
    expect(result).toEqual({ success: false, error: 'archive-not-found' });
  });

  test('copies archive .jsonl to CC directory when CC file is missing', async () => {
    // Setup: create archive file only
    await fsp.mkdir(archiveDir, { recursive: true });
    await fsp.writeFile(archiveFile, JSONL_CONTENT, 'utf-8');

    const result = await handlers.restoreSession({
      projectHash: TEST_PROJECT_HASH,
      sessionId: TEST_SESSION_ID,
    });

    expect(result).toEqual({ success: true, restored: true });

    // Verify the file was actually copied
    const copied = await fsp.readFile(ccFile, 'utf-8');
    expect(copied).toBe(JSONL_CONTENT);
  });

  test('returns restored:false when CC file already exists', async () => {
    // CC file should exist from previous test
    const result = await handlers.restoreSession({
      projectHash: TEST_PROJECT_HASH,
      sessionId: TEST_SESSION_ID,
    });

    expect(result).toEqual({ success: true, restored: false });
  });
});
