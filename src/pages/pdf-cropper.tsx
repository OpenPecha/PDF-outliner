import { useState, useCallback } from "react"
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
    updatePreset,
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-4">
          <div className="text-gray-600 font-medium">Loading workspace…</div>
        </div>
      </div>
    )
  }

  if (!workspace.pdfDataUrl) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold text-gray-900">PDF Crop Workspace</h2>
            <p className="text-gray-500 text-sm">Upload a PDF to get started</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <Uploader disabled={isLoadingPdf} onUpload={handleUploadPdf} />
            {isLoadingPdf && (
              <div className="text-center py-3 text-sm text-gray-600 font-medium">
                Loading PDF…
              </div>
            )}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
            <p className="font-medium mb-1">💡 Tip</p>
            <p>
              After upload, navigate to pages using <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">/?p=1</code>, <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">/?p=2</code>, <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">/?p=3</code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const appliedPresetId = workspace.pages?.[currentPage]?.appliedPresetId

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <aside className="lg:border-r lg:border-gray-200 lg:pr-6 overflow-x-hidden lg:w-1/4">
            <div className="space-y-4 sticky top-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
                <div className="flex flex-col gap-2">
                  <button 
                    className="w-full px-3 py-2 bg-gray-900 cursor-pointer text-white text-sm font-semibold rounded-lg hover:bg-gray-800 active:bg-gray-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md disabled:hover:shadow-sm" 
                    onClick={handleExportCroppedPdf}
                    disabled={workspace.presets.length === 0 || isExporting}
                    title={workspace.presets.length === 0 ? "Create a crop preset first" : "Export all pages with crop applied"}
                    aria-label={isExporting ? "Exporting PDF" : "Export cropped PDF"}
                  >
                    {isExporting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        Exporting…
                      </span>
                    ) : (
                      "Export"
                    )}
                  </button>
                  <button 
                    className="w-full px-3 py-2 bg-white cursor-pointer text-gray-700 text-sm font-semibold rounded-lg border border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 shadow-sm hover:shadow-md" 
                    onClick={handleReset}
                    aria-label="Reset workspace"
                  >
                    Reset
                  </button>
                  <Uploader disabled={isLoadingPdf} onUpload={handleUploadPdf} label="Replace PDF" />
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
                <h3 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">Rendered Pages</h3>
                <PageNav
                  pages={availablePages}
                  current={currentPage}
                  onSelect={navigateToPage}
                />
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <PageCropper
              key={currentPage}
              pdfDataUrl={workspace.pdfDataUrl || workspace.pdfBlobUrl || ""}
              pageNumber={currentPage}
              presets={workspace.presets}
              appliedPresetId={appliedPresetId}
              onCreatePreset={createPreset}
              onDeletePreset={deletePreset}
              onApplyPreset={handleApplyPreset}
              onUpdatePresetName={updatePresetName}
              onUpdatePreset={updatePreset}
            />
          </main>
        </div>
      </div>
    </div>
  )
}

