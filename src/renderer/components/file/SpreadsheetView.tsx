/**
 * SpreadsheetView Component
 *
 * Read-only Excel (.xlsx/.xls) preview using SheetJS.
 * Renders spreadsheet data as an HTML table with sheet tabs.
 */

import React, { useMemo, useState } from 'react';
import { read, utils } from 'xlsx';
import './SpreadsheetView.css';

interface SpreadsheetViewProps {
  content: string; // base64 encoded
}

const MAX_ROWS = 1000;

export function SpreadsheetView({ content }: SpreadsheetViewProps) {
  const workbook = useMemo(() => {
    try {
      return read(content, { type: 'base64' });
    } catch {
      return null;
    }
  }, [content]);

  const [activeSheet, setActiveSheet] = useState(0);

  if (!workbook || workbook.SheetNames.length === 0) {
    return <div className="spreadsheet-view__empty">Unable to read spreadsheet</div>;
  }

  const sheetName = workbook.SheetNames[activeSheet];
  const sheet = workbook.Sheets[sheetName];
  const data: string[][] = utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const truncated = data.length > MAX_ROWS;
  const rows = truncated ? data.slice(0, MAX_ROWS) : data;

  return (
    <div className="spreadsheet-view">
      {workbook.SheetNames.length > 1 && (
        <div className="spreadsheet-view__tabs">
          {workbook.SheetNames.map((name, i) => (
            <button
              key={name}
              className={`spreadsheet-view__tab ${i === activeSheet ? 'spreadsheet-view__tab--active' : ''}`}
              onClick={() => setActiveSheet(i)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="spreadsheet-view__table-wrap">
        <table className="spreadsheet-view__table">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="spreadsheet-view__row-num">{ri + 1}</td>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {truncated && (
          <div className="spreadsheet-view__truncated">
            Showing first {MAX_ROWS} of {data.length} rows
          </div>
        )}
      </div>
    </div>
  );
}
