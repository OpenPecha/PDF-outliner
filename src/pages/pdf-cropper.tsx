import { useState, useCallback } from "react"
import * as pdfjsLib from "pdfjs-dist"
import "pdfjs-dist/build/pdf.worker.mjs"
import { exportCroppedPdf, downloadPdfBytes } from "../utils/lib"
import { useWorkspace, usePageNavigation } from "../hooks"
import Uploader from "../components/Uploader"
import PageNav from "../components/PageNav"
import PageCropper from "../components/PageCropper"
 

// pdf.js worker config
;import { Download, ListRestart } from "lucide-react"
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 font-sans">
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 px-8 py-6">
          <div className="text-gray-700 text-lg font-semibold">Loading workspace…</div>
        </div>
      </div>
    )
  }

  if (!workspace.pdfDataUrl) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 font-sans px-4">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">PDF Crop Workspace</h2>
            <p className="text-gray-600 text-base">Upload a PDF to get started</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 space-y-6">
            <Uploader disabled={isLoadingPdf} onUpload={handleUploadPdf} />
            {isLoadingPdf && (
              <div className="text-center py-4 text-base text-gray-700 font-medium">
                Loading PDF…
              </div>
            )}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-base text-blue-800">
            <p className="font-bold mb-2 text-blue-900">💡 Tip</p>
            <p>
              After upload, navigate to pages using <code className="bg-blue-100 text-blue-700 px-2 py-1 rounded-md text-sm font-mono">/?p=1</code>, <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">/?p=2</code>, <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">/?p=3</code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const appliedPresetId = workspace.pages?.[currentPage]?.appliedPresetId

  return (
    <div className="min-h-screen  font-sans">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex flex-col lg:flex-row gap-8">
          <aside className="lg:border-r lg:border-gray-300 lg:pr-8 overflow-x-hidden lg:w-1/4">
            <div className="space-y-6 sticky top-8">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
                <div className="flex flex-col gap-3">
                  <button 
                    className="w-full flex items-center  gap-2 px-4 py-2.5 bg-gray-800 text-white text-base font-semibold rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200" 
                    onClick={handleExportCroppedPdf}
                    disabled={workspace.presets.length === 0 || isExporting}
                    title={workspace.presets.length === 0 ? "Create a crop preset first" : "Export all pages with crop applied"}
                    aria-label={isExporting ? "Exporting PDF" : "Export cropped PDF"}
                  >
                    {isExporting ? (
                      <span className="flex items-center justify-center gap-2.5">
                        <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        Exporting…
                      </span>
                    ) : (
                     <><Download/> "Export Cropped PDF"</>
                    )}
                  </button>
                  {/* <button 
                    className="w-full flex items-center  gap-2 px-4 py-2.5 bg-white text-gray-800 text-base font-semibold rounded-lg shadow-md border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-opacity-75 transition duration-200" 
                    onClick={handleReset}
                    aria-label="Reset workspace"
                  >
                    <><ListRestart/> Restart</>
                  </button> */}
                  <Uploader disabled={isLoadingPdf} onUpload={handleUploadPdf} label="Upload New PDF" />
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4">
                <h3 className="text-base font-bold text-gray-800 mb-4 uppercase tracking-wide">Rendered Pages</h3>
                <PageNav
                  pages={availablePages}
                  current={currentPage}
                  onSelect={navigateToPage}
                />
              </div>
              </div>
          </aside>

          <main className="min-w-0 flex-1 p-4 lg:p-0">
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

