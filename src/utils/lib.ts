import { PDFDocument, PDFPage } from "pdf-lib"
import * as pdfjsLib from "pdfjs-dist"

// Ensure worker is configured
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc ??
  new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString()

/**
 * Generate a unique identifier
 */
export function uid(): string {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16)
}

/**
 * Clamp a number between min and max values
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

// File conversion utilities

/**
 * Convert a File to a base64 data URL
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Convert a base64 data URL to Uint8Array
 */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? ""
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

// PDF utilities

interface RenderResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/**
 * Render a single PDF page to a canvas at a fixed width
 */
export async function renderPdfPageToCanvas(
  pdf: any,
  pageNumber: number,
  targetWidth = 900
): Promise<RenderResult> {
  const page = await pdf.getPage(pageNumber)
  const viewport1 = page.getViewport({ scale: 1 })
  const scale = targetWidth / viewport1.width
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", {
    // Enable better text rendering for non-Latin fonts
    alpha: true,
    desynchronized: false,
  })
  if (!ctx) throw new Error("2D context not available")

  // Configure canvas for better text rendering
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)

  await page.render({ canvasContext: ctx, viewport }).promise

  return { canvas, width: canvas.width, height: canvas.height }
}

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Crop a region from a source canvas and return a data URL
 */
export function cropCanvasToDataUrl(
  src: HTMLCanvasElement,
  rect: CropRect
): string | null {
  const x = Math.floor(rect.x)
  const y = Math.floor(rect.y)
  const w = Math.floor(rect.width)
  const h = Math.floor(rect.height)

  const output = document.createElement("canvas")
  output.width = Math.max(1, w)
  output.height = Math.max(1, h)

  const ctx = output.getContext("2d")
  if (!ctx) return null

  ctx.drawImage(src, x, y, w, h, 0, 0, w, h)
  return output.toDataURL("image/png")
}

// PDF extraction utilities

interface ExtractionResult {
  pdfDataUrl: string
  totalPages: number
  extractedPages: number
}

/**
 * Extract the first N pages from a PDF and return as a new PDF data URL.
 * Helps reduce localStorage size by storing only necessary pages.
 */
export async function extractFirstPages(
  pdfBytes: Uint8Array,
  maxPages = 5
): Promise<ExtractionResult> {
  const sourcePdf = await PDFDocument.load(pdfBytes)
  const totalPages = sourcePdf.getPageCount()
  const pagesToExtract = Math.min(maxPages, totalPages)

  const newPdf = await PDFDocument.create()
  const pageIndices = Array.from({ length: pagesToExtract }, (_, i) => i)
  const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices)

  for (const page of copiedPages) {
    newPdf.addPage(page)
  }

  const pdfBytesNew = await newPdf.save()

  // Convert Uint8Array to base64
  const binary = Array.from(pdfBytesNew, byte => String.fromCharCode(byte)).join("")
  const base64 = btoa(binary)
  const pdfDataUrl = `data:application/pdf;base64,${base64}`

  return {
    pdfDataUrl,
    totalPages,
    extractedPages: pagesToExtract,
  }
}

// PDF Export utilities

interface CropPresetForExport {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Apply crop box to a PDF page.
 * Converts coordinates from ratios (0-1) directly to PDF point space.
 */
function applyCropToPage(
  page: PDFPage,
  preset: CropPresetForExport
) {
  const { width: pageWidth, height: pageHeight } = page.getSize()
  
  // Convert from ratios (0-1) to PDF coordinates
  // Canvas origin is top-left, PDF origin is bottom-left
  // preset.x, preset.y, preset.width, preset.height are all ratios (0-1)
  const pdfX = preset.x * pageWidth
  const pdfY = pageHeight - (preset.y * pageHeight) - (preset.height * pageHeight)
  const pdfWidth = preset.width * pageWidth
  const pdfHeight = preset.height * pageHeight

  // Clamp values to page bounds
  const clampedX = clamp(pdfX, 0, pageWidth)
  const clampedY = clamp(pdfY, 0, pageHeight)
  const clampedWidth = clamp(pdfWidth, 1, pageWidth - clampedX)
  const clampedHeight = clamp(pdfHeight, 1, pageHeight - clampedY)

  page.setCropBox(clampedX, clampedY, clampedWidth, clampedHeight)
}

interface CropExportResult {
  pdfBytes: Uint8Array
  filename: string
}

/**
 * Export a cropped PDF using the given preset applied to specified pages.
 * The preset coordinates are in ratios (0-1), where:
 * - x, y are the top-left corner position as ratios of page width/height
 * - width, height are the crop dimensions as ratios of page width/height
 * @param pageRange Optional range object with startPage and endPage (1-indexed). If not provided, exports all pages.
 */
export async function exportCroppedPdf(
  originalPdfDataUrl: string,
  preset: CropPresetForExport,
  originalFilename: string,
  pageRange?: { startPage: number; endPage: number }
): Promise<CropExportResult> {
  const pdfBytes = dataUrlToUint8Array(originalPdfDataUrl)
  const sourcePdfDoc = await PDFDocument.load(pdfBytes)
  const totalPages = sourcePdfDoc.getPageCount()

  // Determine which pages to export
  let pagesToExport: number[]
  if (pageRange) {
    const startPage = Math.max(1, Math.min(pageRange.startPage, totalPages))
    const endPage = Math.max(startPage, Math.min(pageRange.endPage, totalPages))
    pagesToExport = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i - 1) // Convert to 0-indexed
  } else {
    pagesToExport = Array.from({ length: totalPages }, (_, i) => i)
  }

  // Create new PDF document with selected pages
  const newPdfDoc = await PDFDocument.create()
  const copiedPages = await newPdfDoc.copyPages(sourcePdfDoc, pagesToExport)
  
  for (const page of copiedPages) {
    newPdfDoc.addPage(page)
  }

  // Apply crop to all pages in the new document
  const pages = newPdfDoc.getPages()
  for (let i = 0; i < pages.length; i++) {
    applyCropToPage(pages[i], preset)
  }

  const croppedPdfBytes = await newPdfDoc.save()
  
  // Generate filename
  const baseName = originalFilename.replace(/\.pdf$/i, "")
  let filename = `${baseName}_cropped.pdf`
  
  if (pageRange) {
    const startPage = Math.max(1, Math.min(pageRange.startPage, totalPages))
    const endPage = Math.max(startPage, Math.min(pageRange.endPage, totalPages))
    if (startPage === endPage) {
      filename = `${baseName}_cropped_page${startPage}.pdf`
    } else {
      filename = `${baseName}_cropped_pages${startPage}-${endPage}.pdf`
    }
  }

  return {
    pdfBytes: croppedPdfBytes,
    filename,
  }
}

/**
 * Trigger a download of a Uint8Array as a file.
 */
export function downloadPdfBytes(pdfBytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  URL.revokeObjectURL(url)
}
