/**
 * SpreadsheetView Component
 *
 * Editable Excel (.xlsx/.xls) viewer using SheetJS.
 * Renders spreadsheet data as an HTML table with inline cell editing and sheet tabs.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { read, utils, write } from 'xlsx';
import type { WorkBook } from 'xlsx';
import './SpreadsheetView.css';

export interface SpreadsheetHandle {
  getBase64: () => string;
}

interface SpreadsheetViewProps {
  content: string; // base64 encoded
  onChange?: () => void;
}

const MAX_ROWS = 1000;

export const SpreadsheetView = forwardRef<SpreadsheetHandle, SpreadsheetViewProps>(
  function SpreadsheetView({ content, onChange }, ref) {
    const workbook = useMemo(() => {
      try {
        return read(content, { type: 'base64' });
      } catch {
        return null;
      }
    }, [content]);

    const [activeSheet, setActiveSheet] = useState(0);
    const [sheetsData, setSheetsData] = useState<Record<number, string[][]>>({});
    const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Initialize sheet data from workbook
    useEffect(() => {
      if (!workbook) return;
      const initial: Record<number, string[][]> = {};
      workbook.SheetNames.forEach((name, i) => {
        const sheet = workbook.Sheets[name];
        initial[i] = utils.sheet_to_json(sheet, { header: 1, defval: '' });
      });
      setSheetsData(initial);
      setEditingCell(null);
    }, [workbook]);

    // Focus input when editing starts
    useEffect(() => {
      if (editingCell && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [editingCell]);

    // Expose getBase64 for save
    useImperativeHandle(ref, () => ({
      getBase64(): string {
        const wb: WorkBook = utils.book_new();
        const sheetNames = workbook?.SheetNames || [];
        sheetNames.forEach((name, i) => {
          const data = sheetsData[i] || [];
          const ws = utils.aoa_to_sheet(data);
          utils.book_append_sheet(wb, ws, name);
        });
        return write(wb, { type: 'base64', bookType: 'xlsx' });
      },
    }), [sheetsData, workbook]);

    const handleCellClick = useCallback((row: number, col: number) => {
      setEditingCell({ row, col });
    }, []);

    const commitEdit = useCallback((row: number, col: number, value: string) => {
      setSheetsData(prev => {
        const sheetData = prev[activeSheet];
        if (!sheetData) return prev;
        const newData = sheetData.map(r => [...r]);
        // Ensure row exists and has enough columns
        while (newData.length <= row) newData.push([]);
        while (newData[row].length <= col) newData[row].push('');
        newData[row][col] = value;
        return { ...prev, [activeSheet]: newData };
      });
      setEditingCell(null);
      onChange?.();
    }, [activeSheet, onChange]);

    const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
      if (e.key === 'Enter') {
        commitEdit(row, col, e.currentTarget.value);
      } else if (e.key === 'Escape') {
        setEditingCell(null);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit(row, col, e.currentTarget.value);
        const nextCol = e.shiftKey ? col - 1 : col + 1;
        if (nextCol >= 0) {
          setEditingCell({ row, col: nextCol });
        }
      }
    }, [commitEdit]);

    const handleInputBlur = useCallback((e: React.FocusEvent<HTMLInputElement>, row: number, col: number) => {
      commitEdit(row, col, e.currentTarget.value);
    }, [commitEdit]);

    if (!workbook || workbook.SheetNames.length === 0) {
      return <div className="spreadsheet-view__empty">Unable to read spreadsheet</div>;
    }

    const data = sheetsData[activeSheet] || [];
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
                onClick={() => { setActiveSheet(i); setEditingCell(null); }}
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
                    <td
                      key={ci}
                      className={editingCell?.row === ri && editingCell?.col === ci ? 'spreadsheet-view__cell--editing' : ''}
                      onClick={() => handleCellClick(ri, ci)}
                    >
                      {editingCell?.row === ri && editingCell?.col === ci ? (
                        <input
                          ref={inputRef}
                          className="spreadsheet-view__cell-input"
                          defaultValue={String(cell)}
                          onKeyDown={(e) => handleInputKeyDown(e, ri, ci)}
                          onBlur={(e) => handleInputBlur(e, ri, ci)}
                        />
                      ) : (
                        <span className="spreadsheet-view__cell-text">{cell}</span>
                      )}
                    </td>
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
);
