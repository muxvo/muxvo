/**
 * SheetJS 表格产物纯 View（从 FileTempViewScreen 恒等抽出——ftv golden 仍活跃，DOM/类名字节冻结）。
 * 默认（maxRows 缺省）渲染与抽出前逐字节一致；filetabs 传 maxRows 时超限截断并加提示行。
 */

export interface SheetData {
  sheetNames: string[];
  activeSheet: number;
  cells: (string | number)[][];
}

export function SheetBody({ sheet, maxRows }: { sheet: SheetData; maxRows?: number }): JSX.Element {
  const truncated = maxRows != null && sheet.cells.length > maxRows;
  const rows = truncated ? sheet.cells.slice(0, maxRows) : sheet.cells;
  return (
    <div className="spreadsheet-view">
      {sheet.sheetNames.length > 1 && (
        <div className="spreadsheet-view__tabs">
          {sheet.sheetNames.map((name, i) => (
            <button
              key={name}
              className={`spreadsheet-view__tab ${i === sheet.activeSheet ? 'spreadsheet-view__tab--active' : ''}`}
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
                  <td key={ci} className="">
                    <span className="spreadsheet-view__cell-text">{cell}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && <div className="spreadsheet-view__truncated">仅显示前 {maxRows} 行</div>}
    </div>
  );
}
