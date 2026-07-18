/**
 * pdf tab 内容（只读预览）。pdfjs-dist 与其 worker 均**动态** import（`?worker&inline` 内联，
 * 禁静态顶层 import 防塞主包）；首页起逐页 canvas 渲染。任何异常 → `.pdf-preview--error` 兜底。
 * jsdom 测试只覆盖错误态路径（真渲染由 e2e/真机验）。
 */

import { useEffect, useRef, useState } from 'react';

export function PdfBody({ base64 }: { base64: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline')).default;
        pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;

        for (let n = 1; n <= doc.numPages; n++) {
          // eslint-disable-next-line no-await-in-loop
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'file-tabs-view__pdf-page';
          container.appendChild(canvas);
          // eslint-disable-next-line no-await-in-loop
          await page.render({ canvas, viewport }).promise;
          if (cancelled) return;
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base64]);

  if (error) {
    return (
      <div className="pdf-preview pdf-preview--error">
        <span>无法预览此 PDF</span>
      </div>
    );
  }
  return <div className="pdf-preview file-tabs-view__pdf" ref={containerRef} />;
}
