/**
 * VERIFY: Spreadsheet edit + save round-trip
 *
 * Tests the full data flow:
 * 1. Create xlsx → base64
 * 2. Parse with SheetJS (simulating SpreadsheetView read)
 * 3. Edit a cell in the parsed data
 * 4. Write back to base64 with SheetJS (simulating getBase64())
 * 5. Write base64 to disk using Buffer.from (simulating fs-handlers writeFile base64)
 * 6. Read file back, parse, verify edit persisted
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { read, write, utils } from 'xlsx';
import type { WorkBook } from 'xlsx';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'muxvo-verify-spreadsheet');
const TEST_FILE = join(TEST_DIR, 'test-edit.xlsx');

describe('VERIFY: Spreadsheet edit and save round-trip', () => {
  let originalBase64: string;

  beforeAll(async () => {
    await fsp.mkdir(TEST_DIR, { recursive: true });

    // Create a test xlsx with known data
    const wb = utils.book_new();
    const data = [
      ['Name', 'Age', 'City'],
      ['Alice', 30, 'Beijing'],
      ['Bob', 25, 'Shanghai'],
    ];
    const ws = utils.aoa_to_sheet(data);
    utils.book_append_sheet(wb, ws, 'Sheet1');

    // Also add a second sheet
    const data2 = [['Score'], [100], [200]];
    const ws2 = utils.aoa_to_sheet(data2);
    utils.book_append_sheet(wb, ws2, 'Sheet2');

    // Write to base64 (simulating what readFile returns)
    originalBase64 = write(wb, { type: 'base64', bookType: 'xlsx' });
  });

  afterAll(async () => {
    await fsp.rm(TEST_DIR, { recursive: true, force: true });
  });

  test('read base64 → parse → data matches original', () => {
    const wb = read(originalBase64, { type: 'base64' });
    expect(wb.SheetNames).toEqual(['Sheet1', 'Sheet2']);

    const sheet1Data: string[][] = utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, defval: '' });
    expect(sheet1Data[0]).toEqual(['Name', 'Age', 'City']);
    expect(sheet1Data[1]).toEqual(['Alice', 30, 'Beijing']);
  });

  test('edit cell → getBase64() → write to disk → read back preserves edit', async () => {
    // Step 1: Parse (simulating SpreadsheetView mount)
    const wb = read(originalBase64, { type: 'base64' });
    const sheetData: string[][] = utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, defval: '' });

    // Step 2: Edit a cell (simulating user click + input)
    sheetData[1][0] = 'Charlie'; // Change "Alice" to "Charlie"
    sheetData[2][2] = 'Shenzhen'; // Change "Shanghai" to "Shenzhen"

    // Step 3: getBase64() — rebuild workbook from edited data
    const newWb = utils.book_new();
    wb.SheetNames.forEach((name, i) => {
      if (name === 'Sheet1') {
        const newWs = utils.aoa_to_sheet(sheetData);
        utils.book_append_sheet(newWb, newWs, name);
      } else {
        // Preserve other sheets unchanged
        const otherData: string[][] = utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
        const otherWs = utils.aoa_to_sheet(otherData);
        utils.book_append_sheet(newWb, otherWs, name);
      }
    });
    const savedBase64 = write(newWb, { type: 'base64', bookType: 'xlsx' });

    // Step 4: Write to disk using Buffer.from (simulating fs-handlers writeFile with encoding='base64')
    await fsp.writeFile(TEST_FILE, Buffer.from(savedBase64, 'base64'));

    // Step 5: Read back from disk
    const fileBuffer = await fsp.readFile(TEST_FILE);
    const readBackBase64 = fileBuffer.toString('base64');

    // Step 6: Parse and verify edits persisted
    const verifyWb = read(readBackBase64, { type: 'base64' });
    expect(verifyWb.SheetNames).toEqual(['Sheet1', 'Sheet2']);

    const verifyData: string[][] = utils.sheet_to_json(verifyWb.Sheets['Sheet1'], { header: 1, defval: '' });
    expect(verifyData[1][0]).toBe('Charlie'); // Was "Alice"
    expect(verifyData[2][2]).toBe('Shenzhen'); // Was "Shanghai"
    expect(verifyData[0]).toEqual(['Name', 'Age', 'City']); // Header unchanged
    expect(verifyData[1][1]).toBe(30); // Age unchanged

    // Verify Sheet2 preserved
    const sheet2Data: string[][] = utils.sheet_to_json(verifyWb.Sheets['Sheet2'], { header: 1, defval: '' });
    expect(sheet2Data[0]).toEqual(['Score']);
    expect(sheet2Data[1]).toEqual([100]);
  });

  test('empty cell edit preserves empty string', async () => {
    const wb = read(originalBase64, { type: 'base64' });
    const sheetData: string[][] = utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, defval: '' });

    // Clear a cell
    sheetData[1][2] = '';

    const newWb = utils.book_new();
    const newWs = utils.aoa_to_sheet(sheetData);
    utils.book_append_sheet(newWb, newWs, 'Sheet1');
    const base64 = write(newWb, { type: 'base64', bookType: 'xlsx' });

    // Round-trip through disk
    const tmpFile = join(TEST_DIR, 'test-empty.xlsx');
    await fsp.writeFile(tmpFile, Buffer.from(base64, 'base64'));
    const readBack = read(await fsp.readFile(tmpFile), { type: 'buffer' });
    const data: string[][] = utils.sheet_to_json(readBack.Sheets['Sheet1'], { header: 1, defval: '' });

    expect(data[1][2]).toBe(''); // City cleared
    expect(data[1][0]).toBe('Alice'); // Name preserved
  });
});
