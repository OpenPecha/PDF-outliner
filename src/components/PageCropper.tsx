import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react"
import * as pdfjsLib from "pdfjs-dist"
import { clamp, renderPdfPageToCanvas, cropCanvasToDataUrl, dataUrlToUint8Array, uid } from "../utils/lib"
import type { CropPreset } from "../types"
import { MAX_PRESETS_PER_PDF } from "../config"
import "../App.css"

interface PageCropperProps {
  pdfDataUrl: string
  pageNumber: number
  presets: CropPreset[]
  appliedPresetId?: string
  onCreatePreset: (preset: CropPreset) => Promise<void>
  onDeletePreset: (presetId: string) => void
  onApplyPreset: (presetId: string) => void
  onClearApplied: () => void
  onUpdatePresetName: (presetId: string, name: string) => void
}

interface DragState {
  startX: number
  startY: number
  x: number
  y: number
  w: number
  h: number
}

interface Size {
  w: number
  h: number
}

const MIN_DRAG_SIZE = 8

function PageCropper({
  pdfDataUrl,
  pageNumber,
  presets,
  appliedPresetId,
  onCreatePreset,
  onDeletePreset,
  onApplyPreset,
  onClearApplied,
  onUpdatePresetName,
}: PageCropperProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [isRendering, setIsRendering] = useState(true)
  const [imgSize, setImgSize] = useState<Size>({ w: 0, h: 0 })
  const [displaySize, setDisplaySize] = useState<Size>({ w: 0, h: 0 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(appliedPresetId)
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null)

  const selectedPreset = useMemo(
    () => presets.find(p => p.id === selectedPresetId),
    [presets, selectedPresetId]
  )

  // Render PDF page (progressive/lazy loading)
  useEffect(() => {
    let cancelled = false

    async function renderPage() {
      setIsRendering(true)
      setCropPreviewUrl(null)

      // Handle both blob URLs and data URLs
      let pdfDoc
      if (pdfDataUrl.startsWith("blob:")) {
        // Blob URL - fetch and convert to ArrayBuffer
        const response = await fetch(pdfDataUrl)
        const arrayBuffer = await response.arrayBuffer()
        pdfDoc = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise
      } else {
        // Data URL - convert to Uint8Array
        pdfDoc = await (pdfjsLib as any).getDocument({ data: dataUrlToUint8Array(pdfDataUrl) }).promise
      }

      const { canvas, width, height } = await renderPdfPageToCanvas(pdfDoc, pageNumber, 900)

      if (cancelled) return

      canvasRef.current = canvas
      setImgSize({ w: width, h: height })

      const domCanvas = document.getElementById("pdf-canvas") as HTMLCanvasElement | null
      if (domCanvas) {
        domCanvas.width = width
        domCanvas.height = height
        const ctx = domCanvas.getContext("2d")
        ctx?.clearRect(0, 0, width, height)
        ctx?.drawImage(canvas, 0, 0)

        requestAnimationFrame(() => {
          const rect = domCanvas.getBoundingClientRect()
          setDisplaySize({ w: rect.width, h: rect.height })
        })
      }

      setIsRendering(false)
    }

    renderPage()

    return () => { cancelled = true }
  }, [pdfDataUrl, pageNumber])

  // Track display size on resize
  useEffect(() => {
    const updateDisplaySize = () => {
      const domCanvas = document.getElementById("pdf-canvas") as HTMLCanvasElement | null
      if (domCanvas) {
        const rect = domCanvas.getBoundingClientRect()
        setDisplaySize({ w: rect.width, h: rect.height })
      }
    }

    window.addEventListener("resize", updateDisplaySize)

    const container = containerRef.current
    const observer = new ResizeObserver(updateDisplaySize)
    if (container) observer.observe(container)

    return () => {
      window.removeEventListener("resize", updateDisplaySize)
      observer.disconnect()
    }
  }, [])

  // Sync selected preset with applied preset
  useEffect(() => {
    setSelectedPresetId(appliedPresetId)
  }, [appliedPresetId])

  const getRelativePos = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current
    if (!el || imgSize.w === 0 || displaySize.w === 0) return { x: 0, y: 0 }

    const rect = el.getBoundingClientRect()
    const scaleX = imgSize.w / displaySize.w
    const scaleY = imgSize.h / displaySize.h
    const displayX = e.clientX - rect.left
    const displayY = e.clientY - rect.top

    return {
      x: clamp(displayX * scaleX, 0, imgSize.w),
      y: clamp(displayY * scaleY, 0, imgSize.h),
    }
  }, [imgSize, displaySize])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isRendering) return
    if (presets.length >= MAX_PRESETS_PER_PDF) return
    const { x, y } = getRelativePos(e)
    setDrag({ startX: x, startY: y, x, y, w: 0, h: 0 })
  }, [isRendering, presets.length, getRelativePos])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag) return
    const { x, y } = getRelativePos(e)

    setDrag(prev => {
      if (!prev) return null
      const left = Math.min(prev.startX, x)
      const top = Math.min(prev.startY, y)
      const w = Math.abs(x - prev.startX)
      const h = Math.abs(y - prev.startY)
      return { ...prev, x: left, y: top, w, h }
    })
  }, [drag, getRelativePos])

  const handleMouseUp = useCallback(() => {
    if (!drag) return

    if (drag.w >= MIN_DRAG_SIZE && drag.h >= MIN_DRAG_SIZE) {
      // Check limit before creating
      if (presets.length >= MAX_PRESETS_PER_PDF) {
        alert(`Maximum ${MAX_PRESETS_PER_PDF} preset${MAX_PRESETS_PER_PDF > 1 ? 's' : ''} per PDF allowed. Please delete the existing preset first.`)
        setDrag(null)
        return
      }

      const preset: CropPreset = {
        id: uid(),
        name: presets.length === 0 ? "Preset 1" : `Preset ${presets.length + 1}`,
        x: Math.round(drag.x),
        y: Math.round(drag.y),
        width: Math.round(drag.w),
        height: Math.round(drag.h),
      }
      onCreatePreset(preset).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to create preset"
        alert(message)
      })
      setSelectedPresetId(preset.id)
    }

    setDrag(null)
  }, [drag, presets.length, onCreatePreset])

  const handleMouseLeave = useCallback(() => {
    setDrag(null)
  }, [])

  const handlePreviewCrop = useCallback(() => {
    const src = canvasRef.current
    if (!src || !selectedPreset) return

    const x = clamp(selectedPreset.x, 0, src.width - 1)
    const y = clamp(selectedPreset.y, 0, src.height - 1)
    const w = clamp(selectedPreset.width, 1, src.width - x)
    const h = clamp(selectedPreset.height, 1, src.height - y)

    const url = cropCanvasToDataUrl(src, { x, y, width: w, height: h })
    setCropPreviewUrl(url)
  }, [selectedPreset])

  const handleApplyPreset = useCallback(() => {
    if (selectedPresetId) onApplyPreset(selectedPresetId)
  }, [selectedPresetId, onApplyPreset])

  const scaleFactors = useMemo(() => ({
    x: displaySize.w > 0 ? displaySize.w / imgSize.w : 1,
    y: displaySize.h > 0 ? displaySize.h / imgSize.h : 1,
  }), [displaySize, imgSize])

  const canCreatePreset = presets.length < MAX_PRESETS_PER_PDF

  return (
    <div>
      <CropperHeader
        pageNumber={pageNumber}
        hasSelectedPreset={!!selectedPresetId}
        hasPresetToPreview={!!selectedPreset}
        canCreatePreset={canCreatePreset}
        onApplyPreset={handleApplyPreset}
        onClearApplied={onClearApplied}
        onPreviewCrop={handlePreviewCrop}
      />

      <div className="workspace-row mt-12">
        <CanvasArea
          containerRef={containerRef}
          displaySize={displaySize}
          imgSize={imgSize}
          isRendering={isRendering}
          presets={presets}
          selectedPresetId={selectedPresetId}
          appliedPresetId={appliedPresetId}
          drag={drag}
          scaleFactors={scaleFactors}
          canCreatePreset={canCreatePreset}
          onSelectPreset={setSelectedPresetId}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />

        <PresetSidebar
          presets={presets}
          selectedPresetId={selectedPresetId}
          appliedPresetId={appliedPresetId}
          selectedPreset={selectedPreset}
          cropPreviewUrl={cropPreviewUrl}
          onSelectPreset={setSelectedPresetId}
          onDeletePreset={onDeletePreset}
          onUpdatePresetName={onUpdatePresetName}
        />
      </div>

      <div className="notice mt-12">
        Coordinates are stored in <strong>rendered image pixel space</strong> (canvas pixels).
      </div>
    </div>
  )
}

// Sub-components

interface CropperHeaderProps {
  pageNumber: number
  hasSelectedPreset: boolean
  hasPresetToPreview: boolean
  canCreatePreset: boolean
  onApplyPreset: () => void
  onClearApplied: () => void
  onPreviewCrop: () => void
}

const CropperHeader = memo(function CropperHeader({
  pageNumber,
  hasPresetToPreview,
  canCreatePreset,
  onPreviewCrop,
}: CropperHeaderProps) {
  return (
    <div className="row-between">
      <div>
        <h3 className="h3">Page {pageNumber}</h3>
        <div className="subtle">
          {canCreatePreset 
            ? "Draw a rectangle on the page to create a crop preset."
            : `Maximum ${MAX_PRESETS_PER_PDF} preset${MAX_PRESETS_PER_PDF > 1 ? 's' : ''} per PDF allowed. Delete the existing preset to create a new one.`
          }
        </div>
      </div>

      <div className="row">
        <button className="btn" onClick={onPreviewCrop} disabled={!hasPresetToPreview}>
          Preview crop
        </button>
      </div>
    </div>
  )
})

interface CanvasAreaProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  displaySize: Size
  imgSize: Size
  isRendering: boolean
  presets: CropPreset[]
  selectedPresetId?: string
  appliedPresetId?: string
  drag: DragState | null
  scaleFactors: { x: number; y: number }
  canCreatePreset: boolean
  onSelectPreset: (id: string) => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: () => void
  onMouseLeave: () => void
}

const CanvasArea = memo(function CanvasArea({
  containerRef,
  displaySize,
  imgSize,
  isRendering,
  presets,
  selectedPresetId,
  appliedPresetId,
  drag,
  scaleFactors,
  canCreatePreset,
  onSelectPreset,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
}: CanvasAreaProps) {
  return (
    <div className="canvas-wrap">
      <div
        ref={containerRef}
        className="canvas-overlay"
        style={{ 
          width: displaySize.w || imgSize.w, 
          height: displaySize.h || imgSize.h,
          cursor: canCreatePreset ? 'crosshair' : 'not-allowed'
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      >
        {presets.map(p => (
          <PresetOverlay
            key={p.id}
            preset={p}
            isSelected={p.id === selectedPresetId}
            isApplied={p.id === appliedPresetId}
            scaleFactors={scaleFactors}
            onSelect={onSelectPreset}
          />
        ))}

        {drag && (
          <div
            style={{
              position: "absolute",
              left: drag.x * scaleFactors.x,
              top: drag.y * scaleFactors.y,
              width: drag.w * scaleFactors.x,
              height: drag.h * scaleFactors.y,
              border: "2px dashed #111",
              background: "rgba(0,0,0,0.04)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <canvas id="pdf-canvas" className="canvas" />

      {isRendering && <div className="loading-cover">Rendering…</div>}
    </div>
  )
})

interface PresetOverlayProps {
  preset: CropPreset
  isSelected: boolean
  isApplied: boolean
  scaleFactors: { x: number; y: number }
  onSelect: (id: string) => void
}

const PresetOverlay = memo(function PresetOverlay({
  preset,
  isSelected,
  isApplied,
  scaleFactors,
  onSelect,
}: PresetOverlayProps) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(preset.id)
  }, [preset.id, onSelect])

  return (
    <div
      onClick={handleClick}
      title={`${preset.name ?? preset.id} (${preset.x},${preset.y},${preset.width},${preset.height})`}
      style={{
        position: "absolute",
        left: preset.x * scaleFactors.x,
        top: preset.y * scaleFactors.y,
        width: preset.width * scaleFactors.x,
        height: preset.height * scaleFactors.y,
        border: isSelected ? "2px solid #111" : "1px solid #666",
        background: "rgba(0,0,0,0.06)",
        boxShadow: isApplied ? "0 0 0 2px rgba(0,0,0,0.25) inset" : undefined,
        cursor: "pointer",
      }}
    />
  )
})

interface PresetSidebarProps {
  presets: CropPreset[]
  selectedPresetId?: string
  appliedPresetId?: string
  selectedPreset?: CropPreset
  cropPreviewUrl: string | null
  onSelectPreset: (id: string) => void
  onDeletePreset: (id: string) => void
  onUpdatePresetName: (id: string, name: string) => void
}

const PresetSidebar = memo(function PresetSidebar({
  presets,
  selectedPresetId,
  appliedPresetId,
  selectedPreset,
  cropPreviewUrl,
  onSelectPreset,
  onDeletePreset,
  onUpdatePresetName,
}: PresetSidebarProps) {
  const appliedPresetName = useMemo(() => {
    if (!appliedPresetId) return "None"
    const preset = presets.find(p => p.id === appliedPresetId)
    return preset?.name ?? "Preset"
  }, [presets, appliedPresetId])

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedPreset) {
      onUpdatePresetName(selectedPreset.id, e.target.value)
    }
  }, [selectedPreset, onUpdatePresetName])

  return (
    <div className="sidebar">
      <div className="card">
        <div className="card-title">Presets</div>

        {presets.length === 0 ? (
          <div className="subtle">No presets yet. Draw a rectangle on the page.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {presets.map(p => (
              <PresetItem
                key={p.id}
                preset={p}
                isSelected={p.id === selectedPresetId}
                onSelect={onSelectPreset}
                onDelete={onDeletePreset}
              />
            ))}
          </div>
        )}
      </div>

    
      {cropPreviewUrl && (
              <div>
                <div className="card-title">Cropped Preview</div>
                <img
                  src={cropPreviewUrl}
                  alt="Cropped preview"
                  style={{ width: "100%", borderRadius: 10 }}
                />
              </div>
            )}
    </div>
  )
})

interface PresetItemProps {
  preset: CropPreset
  isSelected: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

const PresetItem = memo(function PresetItem({
  preset,
  isSelected,
  onSelect,
  onDelete,
}: PresetItemProps) {
  const handleSelect = useCallback(() => onSelect(preset.id), [preset.id, onSelect])
  const handleDelete = useCallback(() => onDelete(preset.id), [preset.id, onDelete])

  return (
    <div className="preset-row">
      <button
        className={isSelected ? "preset-btn-active" : "preset-btn"}
        onClick={handleSelect}
      >
        <div style={{ fontWeight: 600 }}>{preset.name ?? "Unnamed"}</div>
        <div className="subtle-small">
          x:{preset.x} y:{preset.y} w:{preset.width} h:{preset.height}
        </div>
      </button>
      <button className="icon-btn" onClick={handleDelete} title="Delete preset">
        ✕
      </button>
    </div>
  )
})

export default PageCropper
