import { useState, useEffect, useRef, useCallback, memo } from "react"
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
  onUpdatePresetName: (presetId: string, name: string) => void
  onUpdatePreset: (presetId: string, updates: Partial<CropPreset>) => Promise<void>
}

interface DragState {
  startX: number
  startY: number
  x: number
  y: number
  w: number
  h: number
}

interface MoveDragState {
  presetId: string
  startX: number
  startY: number
  offsetX: number
  offsetY: number
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
  onUpdatePresetName,
  onUpdatePreset,
}: PageCropperProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [isRendering, setIsRendering] = useState(true)
  const [imgSize, setImgSize] = useState<Size>({ w: 0, h: 0 })
  const [displaySize, setDisplaySize] = useState<Size>({ w: 0, h: 0 })
  const [overlayOffset, setOverlayOffset] = useState<Size>({ w: 0, h: 0 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(appliedPresetId)
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null)

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
        pdfDoc = await (pdfjsLib as any).getDocument({ data: arrayBuffer,useSystemFonts: true }).promise
      } else {
        // Data URL - convert to Uint8Array
        pdfDoc = await (pdfjsLib as any).getDocument({ data: dataUrlToUint8Array(pdfDataUrl),useSystemFonts: true }).promise
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
          const canvasAspectRatio = width / height
          const containerAspectRatio = rect.width / rect.height

          let actualWidth: number
          let actualHeight: number
          let offsetX = 0
          let offsetY = 0

          // Calculate actual rendered image size with object-contain
          if (canvasAspectRatio > containerAspectRatio) {
            // Canvas is wider - fit to width, centered vertically
            actualWidth = rect.width
            actualHeight = rect.width / canvasAspectRatio
            offsetY = (rect.height - actualHeight) / 2
          } else {
            // Canvas is taller - fit to height, centered horizontally
            actualHeight = rect.height
            actualWidth = rect.height * canvasAspectRatio
            offsetX = (rect.width - actualWidth) / 2
          }

          setDisplaySize({ w: actualWidth, h: actualHeight })
          setOverlayOffset({ w: offsetX, h: offsetY })
        })
      }

      setIsRendering(false)
    }

    renderPage()

    return () => { cancelled = true }
  }, [pdfDataUrl, pageNumber])

  // Track display size on resize - calculate actual rendered image size accounting for object-contain
  useEffect(() => {
    const updateDisplaySize = () => {
      const domCanvas = document.getElementById("pdf-canvas") as HTMLCanvasElement | null
      if (!domCanvas || imgSize.w === 0 || imgSize.h === 0) return

      const rect = domCanvas.getBoundingClientRect()
      const canvasAspectRatio = imgSize.w / imgSize.h
      const containerAspectRatio = rect.width / rect.height

      let actualWidth: number
      let actualHeight: number
      let offsetX = 0
      let offsetY = 0

      // Calculate actual rendered image size with object-contain
      if (canvasAspectRatio > containerAspectRatio) {
        // Canvas is wider - fit to width, centered vertically
        actualWidth = rect.width
        actualHeight = rect.width / canvasAspectRatio
        offsetY = (rect.height - actualHeight) / 2
      } else {
        // Canvas is taller - fit to height, centered horizontally
        actualHeight = rect.height
        actualWidth = rect.height * canvasAspectRatio
        offsetX = (rect.width - actualWidth) / 2
      }

      setDisplaySize({ w: actualWidth, h: actualHeight })
      setOverlayOffset({ w: offsetX, h: offsetY })
    }

    updateDisplaySize()
    window.addEventListener("resize", updateDisplaySize)

    const container = containerRef.current
    const observer = new ResizeObserver(updateDisplaySize)
    if (container) observer.observe(container)

    return () => {
      window.removeEventListener("resize", updateDisplaySize)
      observer.disconnect()
    }
  }, [imgSize])

  // Sync selected preset with applied preset
  useEffect(() => {
    setSelectedPresetId(appliedPresetId)
  }, [appliedPresetId])

  // Automatically generate preview when a preset is selected
  useEffect(() => {
    const presetIdToPreview = selectedPresetId || appliedPresetId
    
    if (isRendering || !presetIdToPreview || !canvasRef.current || imgSize.w === 0 || imgSize.h === 0) {
      if (!presetIdToPreview) {
        setCropPreviewUrl(null)
      }
      return
    }

    const preset = presets.find(p => p.id === presetIdToPreview)
    if (!preset) {
      setCropPreviewUrl(null)
      return
    }

    const src = canvasRef.current
    // Convert ratios to pixels
    const x = clamp(preset.x * src.width, 0, src.width - 1)
    const y = clamp(preset.y * src.height, 0, src.height - 1)
    const w = clamp(preset.width * src.width, 1, src.width - x)
    const h = clamp(preset.height * src.height, 1, src.height - y)

    const url = cropCanvasToDataUrl(src, { x, y, width: w, height: h })
    setCropPreviewUrl(url)
  }, [isRendering, selectedPresetId, appliedPresetId, presets, imgSize])

  const getRelativePos = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current
    if (!el || imgSize.w === 0 || displaySize.w === 0) return { x: 0, y: 0 }

    const rect = el.getBoundingClientRect()
    const scaleX = imgSize.w / displaySize.w
    const scaleY = imgSize.h / displaySize.h
    const displayX = e.clientX - rect.left
    const displayY = e.clientY - rect.top

    // Return ratios (0-1) instead of pixels
    const pixelX = clamp(displayX * scaleX, 0, imgSize.w)
    const pixelY = clamp(displayY * scaleY, 0, imgSize.h)
    
    return {
      x: pixelX / imgSize.w,
      y: pixelY / imgSize.h,
    }
  }, [imgSize, displaySize])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isRendering) return
    if (moveDrag) return // Don't start creating if we're already moving a preset
    
    // Check if clicking on a selected preset overlay (handled by PresetOverlay)
    // This handler is for creating new presets on empty canvas
    if (presets.length >= MAX_PRESETS_PER_PDF) return
    const { x, y } = getRelativePos(e)
    setDrag({ startX: x, startY: y, x, y, w: 0, h: 0 })
  }, [isRendering, presets.length, moveDrag, getRelativePos])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (moveDrag) {
      // Handle moving a preset
      const { x, y } = getRelativePos(e)
      const preset = presets.find(p => p.id === moveDrag.presetId)
      if (!preset) {
        setMoveDrag(null)
        return
      }

      // Calculate new position in ratios
      // moveDrag.offsetX and offsetY are in ratios, so we can subtract directly
      const newX = clamp(x - moveDrag.offsetX, 0, 1 - preset.width)
      const newY = clamp(y - moveDrag.offsetY, 0, 1 - preset.height)

      setMoveDrag(prev => prev ? { ...prev, startX: newX, startY: newY } : null)
      return
    }

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
  }, [drag, moveDrag, presets, getRelativePos])

  const handleMouseUp = useCallback(() => {
    if (moveDrag) {
      // Handle finishing moving a preset
      const preset = presets.find(p => p.id === moveDrag.presetId)
      if (preset) {
        // moveDrag coordinates are already in ratios
        const newX = clamp(moveDrag.startX, 0, 1 - preset.width)
        const newY = clamp(moveDrag.startY, 0, 1 - preset.height)
        
        if (newX !== preset.x || newY !== preset.y) {
          onUpdatePreset(moveDrag.presetId, { x: newX, y: newY }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Failed to update preset"
            alert(message)
          })
        }
      }
      setMoveDrag(null)
      return
    }

    if (!drag) return

    // Convert MIN_DRAG_SIZE from pixels to ratio
    const minDragRatioX = MIN_DRAG_SIZE / imgSize.w
    const minDragRatioY = MIN_DRAG_SIZE / imgSize.h

    if (drag.w >= minDragRatioX && drag.h >= minDragRatioY) {
      // Check limit before creating
      if (presets.length >= MAX_PRESETS_PER_PDF) {
        alert(`Maximum ${MAX_PRESETS_PER_PDF} preset${MAX_PRESETS_PER_PDF > 1 ? 's' : ''} per PDF allowed. Please delete the existing preset first.`)
        setDrag(null)
        return
      }

      // Store coordinates as ratios (0-1)
      const preset: CropPreset = {
        id: uid(),
        name: presets.length === 0 ? "Preset 1" : `Preset ${presets.length + 1}`,
        x: drag.x,
        y: drag.y,
        width: drag.w,
        height: drag.h,
      }
      onCreatePreset(preset).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to create preset"
        alert(message)
      })
      setSelectedPresetId(preset.id)
    }

    setDrag(null)
  }, [drag, moveDrag, presets, imgSize, onCreatePreset, onUpdatePreset])

  const handleMouseLeave = useCallback(() => {
    setDrag(null)
    setMoveDrag(null)
  }, [])

  const handlePresetDragStart = useCallback((presetId: string, e: React.MouseEvent) => {
    if (isRendering) return
    const preset = presets.find(p => p.id === presetId)
    if (!preset) return

    const { x, y } = getRelativePos(e)
    // Both x, y and preset.x, preset.y are now in ratios
    const offsetX = x - preset.x
    const offsetY = y - preset.y

    setSelectedPresetId(presetId)
    setMoveDrag({
      presetId,
      startX: preset.x,
      startY: preset.y,
      offsetX,
      offsetY,
    })
  }, [isRendering, presets, getRelativePos])

  const canCreatePreset = presets.length < MAX_PRESETS_PER_PDF

  return (
    <div>
      <CropperHeader
        canCreatePreset={canCreatePreset}
      />

      <div className="flex flex-col lg:flex-row gap-4">
        <CanvasArea
          containerRef={containerRef}
          displaySize={displaySize}
          imgSize={imgSize}
          overlayOffset={overlayOffset}
          isRendering={isRendering}
          presets={presets}
          selectedPresetId={selectedPresetId}
          appliedPresetId={appliedPresetId}
          drag={drag}
          moveDrag={moveDrag}
          canCreatePreset={canCreatePreset}
          onSelectPreset={setSelectedPresetId}
          onPresetDragStart={handlePresetDragStart}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />

        <PresetSidebar
          presets={presets}
          selectedPresetId={selectedPresetId}
          cropPreviewUrl={cropPreviewUrl}
          onSelectPreset={setSelectedPresetId}
          onDeletePreset={onDeletePreset}
        />
      </div>

    
    </div>
  )
}

// Sub-components

interface CropperHeaderProps {
  readonly canCreatePreset: boolean
}

const CropperHeader = memo(function CropperHeader({
  canCreatePreset,
}: CropperHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
      <div className="space-y-1">
        <div className="text-sm text-gray-500">
          {canCreatePreset 
            ? "Draw a rectangle on the page to create a crop preset."
            : `Maximum ${MAX_PRESETS_PER_PDF} preset${MAX_PRESETS_PER_PDF > 1 ? 's' : ''} per PDF allowed. Delete the existing preset to create a new one.`
          }
        </div>
      </div>
    </div>
  )
})

interface CanvasAreaProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  displaySize: Size
  imgSize: Size
  overlayOffset: Size
  isRendering: boolean
  presets: CropPreset[]
  selectedPresetId?: string
  appliedPresetId?: string
  drag: DragState | null
  moveDrag: MoveDragState | null
  canCreatePreset: boolean
  onSelectPreset: (id: string) => void
  onPresetDragStart: (presetId: string, e: React.MouseEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: () => void
  onMouseLeave: () => void
}

const CanvasArea = memo(function CanvasArea({
  containerRef,
  displaySize,
  imgSize,
  overlayOffset,
  isRendering,
  presets,
  selectedPresetId,
  appliedPresetId,
  drag,
  moveDrag,
  canCreatePreset,
  onSelectPreset,
  onPresetDragStart,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
}: CanvasAreaProps) {
  return (
    <div className="relative border border-gray-200 rounded-xl overflow-hidden bg-black/50 shadow-sm max-h-[80vh] flex-1">
      <div
        ref={containerRef}
        className="absolute z-10"
        style={{ 
          left: overlayOffset.w,
          top: overlayOffset.h,
          width: displaySize.w || imgSize.w, 
          height: displaySize.h || imgSize.h,
          cursor: canCreatePreset ? 'crosshair' : 'not-allowed'
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      >
        {presets.map(p => {
          const isMoving = moveDrag?.presetId === p.id
          const displayPreset = isMoving && moveDrag ? {
            ...p,
            x: moveDrag.startX,
            y: moveDrag.startY,
          } : p

          return (
            <PresetOverlay
              key={p.id}
              preset={displayPreset}
              isSelected={p.id === selectedPresetId}
              isApplied={p.id === appliedPresetId}
              displaySize={displaySize}
              onSelect={onSelectPreset}
              onDragStart={onPresetDragStart}
            />
          )
        })}

        {drag && (
          <div
            className="absolute border-2 border-dashed border-gray-900 bg-black/5 pointer-events-none"
            style={{
              left: drag.x * displaySize.w,
              top: drag.y * displaySize.h,
              width: drag.w * displaySize.w,
              height: drag.h * displaySize.h,
            }}
          />
        )}
      </div>

      <canvas id="pdf-canvas" className="block w-full max-h-[80vh] object-contain" />

      {isRendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-20">
          <div className="flex items-center gap-3 text-gray-700 font-semibold">
            <span className="inline-block w-5 h-5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin"></span>
            Rendering…
          </div>
        </div>
      )}
    </div>
  )
})

interface PresetOverlayProps {
  preset: CropPreset
  isSelected: boolean
  isApplied: boolean
  displaySize: Size
  onSelect: (id: string) => void
  onDragStart: (presetId: string, e: React.MouseEvent) => void
}

const PresetOverlay = memo(function PresetOverlay({
  preset,
  isSelected,
  isApplied,
  displaySize,
  onSelect,
  onDragStart,
}: PresetOverlayProps) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isSelected) {
      // Start dragging if this preset is selected
      onDragStart(preset.id, e)
    } else {
      // Just select if not selected
      onSelect(preset.id)
    }
  }, [preset.id, isSelected, onSelect, onDragStart])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    // Only select if not already selected (to avoid interfering with drag)
    if (!isSelected) {
      onSelect(preset.id)
    }
  }, [preset.id, isSelected, onSelect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      e.stopPropagation()
      onSelect(preset.id)
    }
  }, [preset.id, onSelect])

  return (
    <div
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={`${preset.name ?? preset.id} (${(preset.x * 100).toFixed(1)}%, ${(preset.y * 100).toFixed(1)}%, ${(preset.width * 100).toFixed(1)}%, ${(preset.height * 100).toFixed(1)}%)${isSelected ? " - Drag to move" : ""}`}
      className={`absolute transition-all duration-200 ${
        isSelected 
          ? "border-2 border-gray-900 bg-gray-900/10 shadow-lg cursor-move" 
          : "border border-gray-500 bg-black/6 hover:bg-black/8 cursor-pointer"
      } ${isApplied ? "ring-2 ring-inset ring-gray-400" : ""}`}
      style={{
        left: preset.x * displaySize.w,
        top: preset.y * displaySize.h,
        width: preset.width * displaySize.w,
        height: preset.height * displaySize.h,
      }}
      aria-label={`Crop preset ${preset.name ?? preset.id}${isSelected ? " - Drag to move" : ""}`}
      role="button"
      tabIndex={0}
    />
  )
})

interface PresetSidebarProps {
  presets: CropPreset[]
  selectedPresetId?: string
  cropPreviewUrl: string | null
  onSelectPreset: (id: string) => void
  onDeletePreset: (id: string) => void
}

const PresetSidebar = memo(function PresetSidebar({
  presets,
  selectedPresetId,
  cropPreviewUrl,
  onSelectPreset,
  onDeletePreset,
}: PresetSidebarProps) {

  return (
    <div className="space-y-2 lg:w-1/4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
        <div className="text-xs font-bold text-gray-900 mb-2 uppercase tracking-wide">Presets</div>

        {presets.length === 0 ? (
          <div className="text-sm text-gray-500 py-1">No presets yet. Draw a rectangle on the page.</div>
        ) : (
          <>
            {presets.map(p => (
              <PresetItem
                key={p.id}
                preset={p}
                isSelected={p.id === selectedPresetId}
                onSelect={onSelectPreset}
                onDelete={onDeletePreset}
              />
            ))}
          </>
        )}
      </div>

      {cropPreviewUrl && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <div className="text-xs font-bold text-gray-900 mb-2 uppercase tracking-wide">Cropped Preview</div>
          <img
            src={cropPreviewUrl}
            alt="Cropped preview"
            className="w-full rounded-lg border border-gray-200"
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect(preset.id)
    }
  }, [preset.id, onSelect])

  return (
    <div className="flex justify-between">
      <button
        className={`w-max cursor-pointer text-left px-3 py-2.5 rounded-lg transition-all duration-200 ${
          isSelected
            ? " shadow-md"
            : "bg-white text-gray-700 border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100"
        }`}
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
        aria-label={`Select preset ${preset.name ?? "Unnamed"}`}
        aria-pressed={isSelected}
        tabIndex={0}
      >
        <span className="flex flex-col gap-0.5 text-xs opacity-80 font-mono">
          <span>
            <span className="font-semibold text-gray-700">X:</span> {preset.x.toFixed(2)} &nbsp; 
            <span className="font-semibold text-gray-700">Y:</span> {preset.y.toFixed(2)}
          </span>
          <span>
            <span className="font-semibold text-gray-700">W:</span> {preset.width.toFixed(2)} &nbsp; 
            <span className="font-semibold text-gray-700">H:</span> {preset.height.toFixed(2)}
          </span>
        </span>
      </button>
      <button 
        className="h-[42px] w-10 bg-white text-gray-600 border-2 border-gray-200 rounded-lg hover:bg-red-50 hover:border-red-300 hover:text-red-600 active:bg-red-100 transition-all duration-200 font-bold text-lg flex items-center justify-center shadow-sm hover:shadow-md" 
        onClick={handleDelete} 
        title="Delete preset"
        aria-label={`Delete preset ${preset.name ?? "Unnamed"}`}
      >
        ✕
      </button>
    </div>
  )
})

export default PageCropper
