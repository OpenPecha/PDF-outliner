import { useState, useCallback } from "react"
import { Link } from "react-router-dom"
import * as pdfjsLib from "pdfjs-dist"
import "pdfjs-dist/build/pdf.worker.mjs"
import { exportCroppedPdf, downloadPdfBytes } from "../utils/lib"
import { useWorkspace, usePageNavigation } from "../hooks"
import Uploader from "../components/Uploader"
import PageNav from "../components/PageNav"
import PageCropper from "../components/PageCropper"
import "../App.css"

// pdf.js worker config
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc ??
  new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString()

// Register service worker for offline caching
// Skip registration in chrome-extension context (Cache API doesn't support chrome-extension:// URLs)
if ("serviceWorker" in navigator && globalThis.location.protocol !== "chrome-extension:") {
  globalThis.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("Service Worker registered:", registration.scope)
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error)
      })
  })
}

export default function PdfCropperPage() {
  const {
    workspace,
    availablePages,
    uploadPdf,
    resetWorkspace,
    createPreset,
    deletePreset,
    applyPreset,
    clearAppliedPreset,
    updatePresetName,
    getPdfBlobForExport,
    isLoading: workspaceLoading,
  } = useWorkspace()

  const { currentPage, navigateToPage } = usePageNavigation(availablePages)
  const [isLoadingPdf, setIsLoadingPdf] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const handleUploadPdf = useCallback(
    async (file: File) => {
      setIsLoadingPdf(true)
      try {
        await uploadPdf(file)
        navigateToPage(1)
      } catch (error) {
        console.error("Upload failed:", error)
        alert("Failed to upload PDF. Please try again.")
      } finally {
        setIsLoadingPdf(false)
      }
    },
    [uploadPdf, navigateToPage]
  )

  const handleReset = useCallback(async () => {
    await resetWorkspace()
    navigateToPage(1)
  }, [resetWorkspace, navigateToPage])

  const handleApplyPreset = useCallback((presetId: string) => {
    applyPreset(currentPage, presetId)
  }, [applyPreset, currentPage])

  const handleClearApplied = useCallback(() => {
    clearAppliedPreset(currentPage)
  }, [clearAppliedPreset, currentPage])

  const handleExportCroppedPdf = useCallback(async () => {
    // Find a preset to use - prefer the one applied to page 1, or any selected preset
    const page1AppliedPresetId = workspace.pages?.[1]?.appliedPresetId
    const presetToUse = workspace.presets.find((p) => p.id === page1AppliedPresetId) ?? workspace.presets[0]

    if (!presetToUse) {
      alert("Please create a crop preset first by drawing a rectangle on page 1.")
      return
    }

    const pdfBlob = await getPdfBlobForExport()
    if (!pdfBlob) {
      alert("PDF not available. Please upload a PDF first.")
      return
    }

    setIsExporting(true)
    try {
      // Convert blob to data URL for export function
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(pdfBlob)
      })

      const { pdfBytes, filename } = await exportCroppedPdf(
        dataUrl,
        presetToUse,
        workspace.pdfName ?? "document.pdf"
      )
      downloadPdfBytes(pdfBytes, filename)
    } catch (error) {
      console.error("Export failed:", error)
      alert("Failed to export cropped PDF. Please try again.")
    } finally {
      setIsExporting(false)
    }
  }, [workspace, getPdfBlobForExport])

  // Early return for empty state
  if (workspaceLoading) {
    return (
      <div className="container mx-auto h-screen flex flex-col items-center justify-center">
        <div className="notice">Loading workspace…</div>
      </div>
    )
  }

  if (!workspace.pdfDataUrl) {
    return (
      <div className="container mx-auto h-screen flex flex-col items-center justify-center">
        <h2 className="h2">PDF Crop Workspace (GUI)</h2>
        <Uploader disabled={isLoadingPdf} onUpload={handleUploadPdf} />
        {isLoadingPdf && <div className="notice">Loading PDF…</div>}
        <div className="notice mt-16">
          Tip: After upload, open <code>/?p=1</code>, <code>/?p=2</code>, <code>/?p=3</code>.
        </div>
      </div>
    )
  }

  const appliedPresetId = workspace.pages?.[currentPage]?.appliedPresetId

  return (
    <div className="shell">
      <TopBar
        pdfName={workspace.pdfName}
        totalPages={workspace.totalPages}
        isLoadingPdf={isLoadingPdf}
        isExporting={isExporting}
        hasPresets={workspace.presets.length > 0}
        onReset={handleReset}
        onUpload={handleUploadPdf}
        onExport={handleExportCroppedPdf}
      />

      <div className="grid">
        <aside className="left">
          <h3 className="h3">Rendered Pages</h3>
          <PageNav
            pages={availablePages}
            current={currentPage}
            onSelect={navigateToPage}
          />
        </aside>

        <main className="right">
          <PageCropper
            key={currentPage}
            pdfDataUrl={workspace.pdfDataUrl || workspace.pdfBlobUrl || ""}
            pageNumber={currentPage}
            presets={workspace.presets}
            appliedPresetId={appliedPresetId}
            onCreatePreset={createPreset}
            onDeletePreset={deletePreset}
            onApplyPreset={handleApplyPreset}
            onClearApplied={handleClearApplied}
            onUpdatePresetName={updatePresetName}
          />
        </main>
      </div>
    </div>
  )
}

// Extracted component for top bar
interface TopBarProps {
  pdfName?: string
  totalPages?: number
  isLoadingPdf: boolean
  isExporting: boolean
  hasPresets: boolean
  onReset: () => void
  onUpload: (file: File) => void
  onExport: () => void
}

function TopBar({ pdfName, totalPages, isLoadingPdf, isExporting, hasPresets, onReset, onUpload, onExport }: TopBarProps) {
  const displayTotal = totalPages ?? "?"

  return (
    <div className="top-bar border-b border-gray-200 pb-4">
      <div>
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-500 hover:text-gray-700 text-sm font-medium">
            ← Home
          </Link>
          <div className="title">{pdfName ?? "PDF"}</div>
        </div>
        <div className="subtle">{displayTotal} pages total</div>
      </div>

      <div className="row">
        <button 
          className="btn" 
          onClick={onExport}
          disabled={!hasPresets || isExporting}
          title={!hasPresets ? "Create a crop preset first" : "Export all pages with crop applied"}
        >
          {isExporting ? "Exporting…" : "Export Cropped PDF"}
        </button>
        <button className="btn-ghost" onClick={onReset}>
          Reset
        </button>
        <Uploader disabled={isLoadingPdf} onUpload={onUpload} label="Replace PDF" />
      </div>
    </div>
  )
}
