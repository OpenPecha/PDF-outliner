import { STORAGE_KEY } from "../App";
import { PDFDocument } from "pdf-lib";
import type { WorkspaceState } from "../types";

function uid() {
    return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }
  
  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }


  function readQueryPage(): number {
    const p = new URLSearchParams(window.location.search).get("p");
    const v = Number(p);
    if (!Number.isFinite(v) || v < 1) return 1;
    return Math.floor(v);
  }

  
function setQueryPage(p: number) {
    const url = new URL(window.location.href);
    url.searchParams.set("p", String(p));
    window.history.pushState({}, "", url.toString());
  }
  
  function loadWorkspace(): WorkspaceState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { presets: [], pages: {} };
      return JSON.parse(raw);
    } catch {
      return { presets: [], pages: {} };
    }
  }
  
  function saveWorkspace(ws: WorkspaceState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
  }


  
/**
 * Render a single page to a canvas at a fixed width.
 * Returns: { canvas, width, height }
 */
async function renderPdfPageToCanvas(
    pdf: any,
    pageNumber: number,
    targetWidth = 900
  ): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
    const page = await pdf.getPage(pageNumber);
    const viewport1 = page.getViewport({ scale: 1 });
    const scale = targetWidth / viewport1.width;
    const viewport = page.getViewport({ scale });
  
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");
  
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
  
    await page.render({ canvasContext: ctx, viewport }).promise;
  
    return { canvas, width: canvas.width, height: canvas.height };
  }
  
  /**
   * Crop a region from a source canvas and return a data URL.
   */
  function cropCanvasToDataUrl(
    src: HTMLCanvasElement,
    rect: { x: number; y: number; width: number; height: number }
  ) {
    const x = Math.floor(rect.x);
    const y = Math.floor(rect.y);
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
  
    const out = document.createElement("canvas");
    out.width = Math.max(1, w);
    out.height = Math.max(1, h);
  
    const octx = out.getContext("2d");
    if (!octx) return null;
  
    octx.drawImage(src, x, y, w, h, 0, 0, w, h);
    return out.toDataURL("image/png");
  }


/** Helpers: file -> data url; data url -> bytes */
function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  
  function dataUrlToUint8Array(dataUrl: string): Uint8Array {
    // data:application/pdf;base64,....
    const base64 = dataUrl.split(",")[1] ?? "";
    const binStr = atob(base64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes;
  }

  /**
   * Extract the first N pages from a PDF and return as a new PDF data URL.
   * This helps reduce localStorage size by storing only necessary pages.
   */
  async function extractFirstPages(
    pdfBytes: Uint8Array,
    maxPages: number = 5
  ): Promise<{ pdfDataUrl: string; totalPages: number; extractedPages: number }> {
    const sourcePdf = await PDFDocument.load(pdfBytes);
    const totalPages = sourcePdf.getPageCount();
    const pagesToExtract = Math.min(maxPages, totalPages);
    
    // Create a new PDF with only the first N pages
    const newPdf = await PDFDocument.create();
    const pageIndices = Array.from({ length: pagesToExtract }, (_, i) => i);
    const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);
    
    copiedPages.forEach((page) => {
      newPdf.addPage(page);
    });
    
    const pdfBytesNew = await newPdf.save();
    
    // Convert Uint8Array to base64 properly
    const binary = Array.from(pdfBytesNew, (byte) => String.fromCharCode(byte)).join("");
    const base64 = btoa(binary);
    const pdfDataUrl = `data:application/pdf;base64,${base64}`;
    
    return {
      pdfDataUrl,
      totalPages,
      extractedPages: pagesToExtract,
    };
  }

  export { uid, clamp, readQueryPage, setQueryPage, loadWorkspace, saveWorkspace, renderPdfPageToCanvas, cropCanvasToDataUrl ,
    fileToDataUrl, dataUrlToUint8Array, extractFirstPages
      };
