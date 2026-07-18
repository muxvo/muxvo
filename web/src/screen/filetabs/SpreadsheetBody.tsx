/**
 * spreadsheet tab 内容（只读）。xlsx 走 `await import('xlsx')` **动态** import（照 PdfBody 先例，
 * 禁静态顶层 import 防塞主包）：base64 → 首表 SheetData → SheetBody（maxRows=500 截断）。
 * 解析中显占位（`.file-tabs-view__sheet-pending`，1-a seam 类名不变）；异常 → 错误态。
 * jsdom 测试只覆盖占位/错误路径（真解析由 e2e/真机验）。
 */

import { useEffect, useState } from 'react';
import { SheetBody, type SheetData } from '../file/SheetBody';

export function SpreadsheetBody({ base64 }: { base64: string }): JSX.Element {
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSheet(null);
    setError(false);
    void (async () => {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(base64, { type: 'base64' });
        const sheetNames = wb.SheetNames;
        const first = sheetNames[0];
        const ws = first ? wb.Sheets[first] : undefined;
        // header:1 → 行数组；raw:false 令日期/数字格式化为字符串（避免 Date 对象崩 React）。
        const rawRows = ws
          ? (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: false }) as unknown[][])
          : [];
        const cells = rawRows.map((row) => row.map((c) => (c == null ? '' : String(c))));
        if (!cancelled) setSheet({ sheetNames, activeSheet: 0, cells });
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base64]);

  if (error) return <div className="file-tabs-view__sheet-error">无法预览此表格</div>;
  if (!sheet) return <div className="file-tabs-view__sheet-pending">表格预览加载中…</div>;
  return <SheetBody sheet={sheet} maxRows={500} />;
}
