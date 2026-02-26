import { ListRestart, FileUp, Link as LinkIcon } from "lucide-react"
import { memo, useCallback, useRef, useState } from "react"

interface UploaderProps {
  disabled?: boolean
  onUpload: (file: File) => void | Promise<void>
  label?: string
}

type UploadMode = "file" | "url"

const Uploader = memo(function Uploader({
  disabled = false,
  onUpload,
  label = "Upload PDF",
}: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<UploadMode>("file")
  const [url, setUrl] = useState("")
  const [isLoadingUrl, setIsLoadingUrl] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    // Reset input value to allow re-uploading the same file
    if (inputRef.current) inputRef.current.value = ""
  }, [onUpload])

  const validateUrl = useCallback((urlString: string): boolean => {
    try {
      const urlObj = new URL(urlString)
      return urlObj.pathname.toLowerCase().endsWith(".pdf")
    } catch {
      return false
    }
  }, [])

  const handleUrlSubmit = useCallback(async () => {
    if (!url.trim()) {
      setUrlError("Please enter a URL")
      return
    }

    if (!validateUrl(url)) {
      setUrlError("URL must end with .pdf")
      return
    }

    setIsLoadingUrl(true)
    setUrlError(null)

    try {
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.statusText}`)
      }

      const contentType = response.headers.get("content-type")
      if (contentType && !contentType.includes("application/pdf")) {
        throw new Error("The URL does not point to a PDF file")
      }

      const blob = await response.blob()
      
      // Extract filename from URL or use default
      const urlPath = new URL(url).pathname
      const filename = urlPath.split("/").pop() || "document.pdf"
      
      // Convert blob to File
      const file = new File([blob], filename, { type: "application/pdf" })
      
      await onUpload(file)
      setUrl("")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download PDF"
      setUrlError(message)
      console.error("URL download failed:", error)
    } finally {
      setIsLoadingUrl(false)
    }
  }, [url, validateUrl, onUpload])

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !disabled && !isLoadingUrl) {
      handleUrlSubmit()
    }
  }, [disabled, isLoadingUrl, handleUrlSubmit])

  return (
    <div className="w-full space-y-3">
      {/* Mode selector tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          type="button"
          onClick={() => {
            setMode("file")
            setUrlError(null)
          }}
          disabled={disabled}
          className={`px-3 py-2 text-sm font-semibold transition-colors border-b-2 ${
            mode === "file"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="flex items-center gap-2">
            <FileUp className="w-4 h-4" />
            File
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("url")
            setUrlError(null)
          }}
          disabled={disabled}
          className={`px-3 py-2 text-sm font-semibold transition-colors border-b-2 ${
            mode === "url"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4" />
            Link
          </span>
        </button>
      </div>

      {/* File upload mode */}
      {mode === "file" && (
        <label className="block cursor-pointer w-full">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            disabled={disabled}
            className="hidden"
            onChange={handleFileChange}
            aria-label={label}
          />
          <span
            className={`flex items-center gap-2 w-full text-center px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:shadow-sm ${
              disabled ? "" : "cursor-pointer"
            }`}
          >
            <ListRestart className="w-4 h-4" /> {label}
          </span>
        </label>
      )}

      {/* URL input mode */}
      {mode === "url" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              ref={urlInputRef}
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setUrlError(null)
              }}
              onKeyDown={handleUrlKeyDown}
              placeholder="https://example.com/document.pdf"
              disabled={disabled || isLoadingUrl}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={handleUrlSubmit}
              disabled={disabled || isLoadingUrl || !url.trim()}
              className="px-4 py-2 bg-gray-800 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200 flex items-center gap-2"
            >
              {isLoadingUrl ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{" "}
                  Loading...
                </>
              ) : (
                <>
                  <LinkIcon className="w-4 h-4" />
                  Load
                </>
              )}
            </button>
          </div>
          {urlError && (
            <p className="text-sm text-red-600">{urlError}</p>
          )}
          <p className="text-xs text-gray-500">
            Enter a URL that ends with .pdf to download and load the PDF
          </p>
        </div>
      )}
    </div>
  )
})

export default Uploader
