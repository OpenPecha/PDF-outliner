import React, { useEffect, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/build/pdf.worker.mjs";
import { loadWorkspace, saveWorkspace, readQueryPage, setQueryPage, clamp,  fileToDataUrl, dataUrlToUint8Array, extractFirstPages } from "./utils/lib";
import "./App.css";
import Uploader from "./components/Uploader";
import PageNav from "./components/PageNav";
import PageCropper from "./components/PageCropper";
import type { WorkspaceState } from "./types";

export const STORAGE_KEY = "pdf-crop-workspace-v1";
const MAX_RENDER_PAGES = 10;

// pdf.js worker config (modern bundlers usually handle this, but keep it explicit)
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc ??
  new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();





export default function App() {
  const [ws, setWs] = useState<WorkspaceState>(() => loadWorkspace());
  const [loadingPdf, setLoadingPdf] = useState(false);

  const [page, setPage] = useState<number>(() => readQueryPage());
  useEffect(() => {
    const onPop = () => setPage(readQueryPage());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Keep localStorage in sync
  useEffect(() => {
    saveWorkspace(ws);
  }, [ws]);

  const availablePages = useMemo(() => {
    const n = ws.numPages ?? 0;
    const cap = Math.min(MAX_RENDER_PAGES, n || MAX_RENDER_PAGES);
    return Array.from({ length: cap }, (_, i) => i + 1);
  }, [ws.numPages]);

  // Ensure page is in range
  useEffect(() => {
    if (availablePages.length === 0) return;
    const max = Math.max(...availablePages);
    const next = clamp(page, 1, max);
    if (next !== page) {
      setPage(next);
      setQueryPage(next);
    }
  }, [availablePages, page]);

  async function onUploadPdf(file: File) {
    setLoadingPdf(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const pdfBytes = dataUrlToUint8Array(dataUrl);
      
      // Extract first 5 pages to reduce localStorage size
      const { pdfDataUrl: extractedDataUrl, totalPages, extractedPages } = await extractFirstPages(pdfBytes, MAX_RENDER_PAGES);
      
      // Load the extracted PDF to get page count
      const pdf = await (pdfjsLib as any).getDocument({ data: dataUrlToUint8Array(extractedDataUrl) }).promise;

      setWs((prev) => ({
        pdfName: file.name,
        pdfDataUrl: extractedDataUrl, // Store only the extracted pages
        numPages: extractedPages, // Use extracted pages count, not total
        totalPages: totalPages, // Store original total for reference
        presets: prev.presets ?? [],
        pages: prev.pages ?? {},
      }));
      setQueryPage(1);
      setPage(1);
    } finally {
      setLoadingPdf(false);
    }
  }

  function resetWorkspace() {
    localStorage.removeItem(STORAGE_KEY);
    setWs({ presets: [], pages: {} });
    setQueryPage(1);
    setPage(1);
  }

  if (!ws.pdfDataUrl) {
    return (
      <div className="container mx-auto h-screen flex flex-col items-center justify-center"> 
        <h2 className="h2">PDF Crop Workspace (GUI)</h2>

        <Uploader disabled={loadingPdf} onUpload={onUploadPdf} />

        {loadingPdf && <div className="notice">Loading PDF…</div>}

        <div className="notice mt-16">
          Tip: After upload, open <code>/?p=1</code>, <code>/?p=2</code>, <code>/?p=3</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="top-bar">
        <div>
          <div className="title">{ws.pdfName ?? "PDF"}</div>
          <div className="subtle">
            Pages: {ws.numPages ?? "?"} of {ws.totalPages ?? ws.numPages ?? "?"} total
            {ws.totalPages && ws.totalPages > (ws.numPages ?? 0) && (
              <span className="notice" style={{ marginLeft: 8, fontSize: "0.9em" }}>
                (Only first 5 pages stored to save localStorage space)
              </span>
            )}
          </div>
        </div>

        <div className="row">
          <button className="btn-ghost" onClick={resetWorkspace}>
            Reset
          </button>
          <Uploader disabled={loadingPdf} onUpload={onUploadPdf} label="Replace PDF" />
        </div>
      </div>

      <div className="grid">
        <div className="left">
          <h3 className="h3">Rendered Pages</h3>
          <PageNav
            pages={availablePages}
            current={page}
            onSelect={(p) => {
              setPage(p);
              setQueryPage(p);
            }}
          />
          <div className="notice mt-12">
            Page view uses query param: <code>/?p={page}</code>
          </div>
        </div>

        <div className="right">
          <PageCropper
            key={page} // reset internal dragging on page switch
            pdfDataUrl={ws.pdfDataUrl}
            pageNumber={page}
            presets={ws.presets}
            appliedPresetId={ws.pages?.[page]?.appliedPresetId}
            onCreatePreset={(preset) =>
              setWs((prev) => ({
                ...prev,
                presets: [...(prev.presets ?? []), preset],
              }))
            }
            onDeletePreset={(presetId) =>
              setWs((prev) => ({
                ...prev,
                presets: (prev.presets ?? []).filter((p) => p.id !== presetId),
                pages: Object.fromEntries(
                  Object.entries(prev.pages ?? {}).map(([k, v]) => {
                    const pn = Number(k);
                    if (v.appliedPresetId === presetId) {
                      return [pn, { ...v, appliedPresetId: undefined }];
                    }
                    return [pn, v];
                  })
                ),
              }))
            }
            onApplyPreset={(presetId) =>
              setWs((prev) => ({
                ...prev,
                pages: {
                  ...(prev.pages ?? {}),
                  [page]: { ...(prev.pages?.[page] ?? {}), appliedPresetId: presetId },
                },
              }))
            }
            onClearApplied={() =>
              setWs((prev) => ({
                ...prev,
                pages: {
                  ...(prev.pages ?? {}),
                  [page]: { ...(prev.pages?.[page] ?? {}), appliedPresetId: undefined },
                },
              }))
            }
          />
        </div>
      </div>
    </div>
  );
}




