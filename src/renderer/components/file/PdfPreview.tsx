/**
 * PdfPreview Component
 *
 * Renders PDF files using pdfjs-dist with page navigation and zoom controls.
 * Reads the file via IPC (base64) to avoid loading binary data as UTF-8.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
// Use legacy build for Electron 34 (Chromium ~132) compatibility
// The default build requires Uint8Array.prototype.toHex() (Chromium 134+)
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PdfPreviewProps {
  filePath: string;
}

export function PdfPreview({ filePath }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCurrentPage(1);
    setPdfDoc(null);

    window.api.fs.readFile(filePath, 'base64').then((result: { success: boolean; data?: { content: string } }) => {
      if (cancelled) return;
      if (!result?.success || !result.data) {
        setError('Failed to read PDF file');
        setLoading(false);
        return;
      }
      const binaryStr = atob(result.data.content);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return pdfjsLib.getDocument({ data: bytes }).promise;
    }).then((doc) => {
      if (cancelled || !doc) return;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load PDF');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [filePath]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let cancelled = false;

    // Cancel previous render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdfDoc.getPage(currentPage).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      // Support HiDPI displays
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const renderTask = page.render({
        canvas: null,
        canvasContext: context,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      });
      renderTaskRef.current = renderTask;
      renderTask.promise.catch(() => {
        // Render cancelled or failed — ignore
      });
    });

    return () => { cancelled = true; };
  }, [pdfDoc, currentPage, scale]);

  const goToPrev = useCallback(() => {
    setCurrentPage(p => Math.max(1, p - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentPage(p => Math.min(totalPages, p + 1));
  }, [totalPages]);

  const zoomIn = useCallback(() => {
    setScale(s => Math.min(4, s + 0.25));
  }, []);

  const zoomOut = useCallback(() => {
    setScale(s => Math.max(0.5, s - 0.25));
  }, []);

  if (loading) {
    return (
      <div className="pdf-preview pdf-preview--loading">
        <span>Loading PDF...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-preview pdf-preview--error">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="pdf-preview">
      <div className="pdf-preview__toolbar">
        <button onClick={goToPrev} disabled={currentPage <= 1} title="Previous page">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="pdf-preview__page-info">
          {currentPage} / {totalPages}
        </span>
        <button onClick={goToNext} disabled={currentPage >= totalPages} title="Next page">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <span className="pdf-preview__separator" />
        <button onClick={zoomOut} disabled={scale <= 0.5} title="Zoom out">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <span className="pdf-preview__zoom-info">{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} disabled={scale >= 4} title="Zoom in">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div className="pdf-preview__canvas-container">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
