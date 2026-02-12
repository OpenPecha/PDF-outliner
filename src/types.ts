export type CropPreset = {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageState = {
  appliedPresetId?: string;
};

export type WorkspaceState = {
  pdfName?: string;
  pdfDataUrl?: string; // base64 data URL so we can persist (only first 5 pages)
  originalPdfDataUrl?: string; // Full original PDF for export (stored separately)
  numPages?: number; // Number of pages available (extracted pages)
  totalPages?: number; // Original total pages in the PDF (for reference)
  presets: CropPreset[];
  pages: Record<number, PageState>; // 1-based page number
};
