import { useState, useEffect, useRef, useCallback, memo } from "react"
import * as pdfjsLib from "pdfjs-dist"
import { clamp, renderPdfPageToCanvas, cropCanvasToDataUrl, dataUrlToUint8Array, uid } from "../utils/lib"
import type { CropPreset } from "../types"
import { MAX_PRESETS_PER_PDF } from "../config"
import "../App.css"
import { CopyIcon, XIcon } from "lucide-react"

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

interface ResizeDragState {
  presetId: string
  handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'
  startX: number
  startY: number
  startPresetX: number
  startPresetY: number
  startPresetW: number
  startPresetH: number
  currentX: number
  currentY: number
  currentW: number
  currentH: number
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
  const [resizeDrag, setResizeDrag] = useState<ResizeDragState | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(appliedPresetId)
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null)
  const [cropBoxInfo, setCropBoxInfo] = useState<{
    width: number
    height: number
    x: number
    y: number
    mediaBoxWidth: number
    mediaBoxHeight: number
  } | null>(null)

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

      const { canvas, width, height, cropBoxWidth, cropBoxHeight, cropBoxX, cropBoxY, mediaBoxWidth, mediaBoxHeight } = await renderPdfPageToCanvas(pdfDoc, pageNumber, 900)

      if (cancelled) return

      canvasRef.current = canvas
      setImgSize({ w: width, h: height })
      setCropBoxInfo({
        width: cropBoxWidth,
        height: cropBoxHeight,
        x: cropBoxX,
        y: cropBoxY,
        mediaBoxWidth,
        mediaBoxHeight
      })

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
    if (moveDrag || resizeDrag) return // Don't start creating if we're already moving/resizing a preset
    
    // Check if clicking on a selected preset overlay (handled by PresetOverlay)
    // This handler is for creating new presets on empty canvas
    if (presets.length >= MAX_PRESETS_PER_PDF) return
    const { x, y } = getRelativePos(e)
    setDrag({ startX: x, startY: y, x, y, w: 0, h: 0 })
  }, [isRendering, presets.length, moveDrag, resizeDrag, getRelativePos])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (resizeDrag) {
      // Handle resizing a preset
      const { x, y } = getRelativePos(e)
      const deltaX = x - resizeDrag.startX
      const deltaY = y - resizeDrag.startY

      let newX = resizeDrag.startPresetX
      let newY = resizeDrag.startPresetY
      let newW = resizeDrag.startPresetW
      let newH = resizeDrag.startPresetH

      // Handle different resize handles
      switch (resizeDrag.handle) {
        case 'nw': // Top-left
          newX = clamp(resizeDrag.startPresetX + deltaX, 0, resizeDrag.startPresetX + resizeDrag.startPresetW - 0.01)
          newY = clamp(resizeDrag.startPresetY + deltaY, 0, resizeDrag.startPresetY + resizeDrag.startPresetH - 0.01)
          newW = resizeDrag.startPresetX + resizeDrag.startPresetW - newX
          newH = resizeDrag.startPresetY + resizeDrag.startPresetH - newY
          break
        case 'ne': // Top-right
          newY = clamp(resizeDrag.startPresetY + deltaY, 0, resizeDrag.startPresetY + resizeDrag.startPresetH - 0.01)
          newW = clamp(resizeDrag.startPresetW + deltaX, 0.01, 1 - resizeDrag.startPresetX)
          newH = resizeDrag.startPresetY + resizeDrag.startPresetH - newY
          break
        case 'sw': // Bottom-left
          newX = clamp(resizeDrag.startPresetX + deltaX, 0, resizeDrag.startPresetX + resizeDrag.startPresetW - 0.01)
          newW = resizeDrag.startPresetX + resizeDrag.startPresetW - newX
          newH = clamp(resizeDrag.startPresetH + deltaY, 0.01, 1 - resizeDrag.startPresetY)
          break
        case 'se': // Bottom-right
          newW = clamp(resizeDrag.startPresetW + deltaX, 0.01, 1 - resizeDrag.startPresetX)
          newH = clamp(resizeDrag.startPresetH + deltaY, 0.01, 1 - resizeDrag.startPresetY)
          break
        case 'n': // Top edge
          newY = clamp(resizeDrag.startPresetY + deltaY, 0, resizeDrag.startPresetY + resizeDrag.startPresetH - 0.01)
          newH = resizeDrag.startPresetY + resizeDrag.startPresetH - newY
          break
        case 's': // Bottom edge
          newH = clamp(resizeDrag.startPresetH + deltaY, 0.01, 1 - resizeDrag.startPresetY)
          break
        case 'e': // Right edge
          newW = clamp(resizeDrag.startPresetW + deltaX, 0.01, 1 - resizeDrag.startPresetX)
          break
        case 'w': // Left edge
          newX = clamp(resizeDrag.startPresetX + deltaX, 0, resizeDrag.startPresetX + resizeDrag.startPresetW - 0.01)
          newW = resizeDrag.startPresetX + resizeDrag.startPresetW - newX
          break
      }

      // Ensure minimum size
      const minSize = 0.01
      if (newW < minSize) {
        if (resizeDrag.handle === 'nw' || resizeDrag.handle === 'w') {
          newX = resizeDrag.startPresetX + resizeDrag.startPresetW - minSize
        }
        newW = minSize
      }
      if (newH < minSize) {
        if (resizeDrag.handle === 'nw' || resizeDrag.handle === 'n') {
          newY = resizeDrag.startPresetY + resizeDrag.startPresetH - minSize
        }
        newH = minSize
      }

      // Ensure within bounds
      newX = clamp(newX, 0, 1 - newW)
      newY = clamp(newY, 0, 1 - newH)

      setResizeDrag(prev => prev ? { 
        ...prev, 
        currentX: newX, 
        currentY: newY, 
        currentW: newW, 
        currentH: newH 
      } : null)
      return
    }

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
  }, [drag, moveDrag, resizeDrag, presets, getRelativePos])

  const handleMouseUp = useCallback(() => {
    if (resizeDrag) {
      // Handle finishing resizing a preset
      const preset = presets.find(p => p.id === resizeDrag.presetId)
      if (!preset) {
        setResizeDrag(null)
        return
      }

      // Use the current dimensions from resizeDrag state
      const { currentX, currentY, currentW, currentH } = resizeDrag

      // Only update if changed
      if (currentX !== preset.x || currentY !== preset.y || currentW !== preset.width || currentH !== preset.height) {
        onUpdatePreset(resizeDrag.presetId, { x: currentX, y: currentY, width: currentW, height: currentH }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Failed to update preset"
          alert(message)
        })
      }

      setResizeDrag(null)
      return
    }

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
  }, [drag, moveDrag, resizeDrag, presets, imgSize, onCreatePreset, onUpdatePreset, getRelativePos])

  const handleMouseLeave = useCallback(() => {
    setDrag(null)
    setMoveDrag(null)
    setResizeDrag(null)
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

  const handlePresetResizeStart = useCallback((presetId: string, handle: ResizeDragState['handle'], e: React.MouseEvent) => {
    if (isRendering) return
    e.stopPropagation()
    const preset = presets.find(p => p.id === presetId)
    if (!preset) return

    const { x, y } = getRelativePos(e)

    setSelectedPresetId(presetId)
    setResizeDrag({
      presetId,
      handle,
      startX: x,
      startY: y,
      startPresetX: preset.x,
      startPresetY: preset.y,
      startPresetW: preset.width,
      startPresetH: preset.height,
      currentX: preset.x,
      currentY: preset.y,
      currentW: preset.width,
      currentH: preset.height,
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
          resizeDrag={resizeDrag}
          canCreatePreset={canCreatePreset}
          cropBoxInfo={cropBoxInfo}
          onSelectPreset={setSelectedPresetId}
          onPresetDragStart={handlePresetDragStart}
          onPresetResizeStart={handlePresetResizeStart}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />

        <PresetSidebar
          presets={presets}
          selectedPresetId={selectedPresetId}
          cropPreviewUrl={cropPreviewUrl}
          cropBoxInfo={cropBoxInfo}
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
  resizeDrag: ResizeDragState | null
  canCreatePreset: boolean
  cropBoxInfo: {
    width: number
    height: number
    x: number
    y: number
    mediaBoxWidth: number
    mediaBoxHeight: number
  } | null
  onSelectPreset: (id: string) => void
  onPresetDragStart: (presetId: string, e: React.MouseEvent) => void
  onPresetResizeStart: (presetId: string, handle: ResizeDragState['handle'], e: React.MouseEvent) => void
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
  resizeDrag,
  canCreatePreset,
  cropBoxInfo,
  onSelectPreset,
  onPresetDragStart,
  onPresetResizeStart,
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
          const isResizing = resizeDrag?.presetId === p.id
          
          let displayPreset = p
          if (isMoving && moveDrag) {
            displayPreset = {
              ...p,
              x: moveDrag.startX,
              y: moveDrag.startY,
            }
          } else if (isResizing && resizeDrag) {
            displayPreset = {
              ...p,
              x: resizeDrag.currentX,
              y: resizeDrag.currentY,
              width: resizeDrag.currentW,
              height: resizeDrag.currentH,
            }
          }

          return (
            <PresetOverlay
              key={p.id}
              preset={displayPreset}
              isSelected={p.id === selectedPresetId}
              isApplied={p.id === appliedPresetId}
              displaySize={displaySize}
              cropBoxInfo={cropBoxInfo}
              onSelect={onSelectPreset}
              onDragStart={onPresetDragStart}
              onResizeStart={onPresetResizeStart}
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
  cropBoxInfo: {
    width: number
    height: number
    x: number
    y: number
    mediaBoxWidth: number
    mediaBoxHeight: number
  } | null
  onSelect: (id: string) => void
  onDragStart: (presetId: string, e: React.MouseEvent) => void
  onResizeStart: (presetId: string, handle: ResizeDragState['handle'], e: React.MouseEvent) => void
}

const PresetOverlay = memo(function PresetOverlay({
  preset,
  isSelected,
  isApplied,
  displaySize,
  cropBoxInfo,
  onSelect,
  onDragStart,
  onResizeStart,
}: PresetOverlayProps) {
  // Helper function to convert preset coordinates to CropBox percentages
  const getCropBoxPercentages = useCallback((preset: CropPreset) => {
    if (!cropBoxInfo) {
      // Fallback to MediaBox percentages if CropBox info not available
      return {
        x: preset.x * 100,
        y: preset.y * 100,
        width: preset.width * 100,
        height: preset.height * 100
      }
    }

    const { width: cropBoxWidth, height: cropBoxHeight, x: cropBoxX, y: cropBoxY, mediaBoxWidth, mediaBoxHeight } = cropBoxInfo

    // Preset coordinates are ratios (0-1) relative to MediaBox in canvas coordinates (top-left origin)
    // Convert to MediaBox canvas coordinates
    const mediaBoxCanvasX = preset.x * mediaBoxWidth
    const mediaBoxCanvasY = preset.y * mediaBoxHeight
    const mediaBoxCanvasW = preset.width * mediaBoxWidth
    const mediaBoxCanvasH = preset.height * mediaBoxHeight

    // Convert canvas coordinates (top-left) to PDF coordinates (bottom-left)
    // In PDF coordinates, y=0 is at bottom, so: pdfY = mediaBoxHeight - canvasY - height
    const mediaBoxPdfX = mediaBoxCanvasX
    const mediaBoxPdfY = mediaBoxHeight - mediaBoxCanvasY - mediaBoxCanvasH
    const mediaBoxPdfW = mediaBoxCanvasW
    const mediaBoxPdfH = mediaBoxCanvasH

    // Convert PDF MediaBox coordinates to CropBox coordinates
    // CropBox coordinates are relative to CropBox origin
    const cropBoxPdfX = mediaBoxPdfX - cropBoxX
    const cropBoxPdfY = mediaBoxPdfY - cropBoxY
    const cropBoxPdfW = mediaBoxPdfW
    const cropBoxPdfH = mediaBoxPdfH

    // Convert to percentages relative to CropBox
    const xPercent = (cropBoxPdfX / cropBoxWidth) * 100
    const yPercent = (cropBoxPdfY / cropBoxHeight) * 100
    const widthPercent = (cropBoxPdfW / cropBoxWidth) * 100
    const heightPercent = (cropBoxPdfH / cropBoxHeight) * 100

    return {
      x: clamp(xPercent, 0, 100),
      y: clamp(yPercent, 0, 100),
      width: clamp(widthPercent, 0, 100),
      height: clamp(heightPercent, 0, 100)
    }
  }, [cropBoxInfo])

  const percentages = getCropBoxPercentages(preset)
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

  const handleResizeMouseDown = useCallback((handle: ResizeDragState['handle'], e: React.MouseEvent) => {
    e.stopPropagation()
    onResizeStart(preset.id, handle, e)
  }, [preset.id, onResizeStart])

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

  const handleSize = 8
  const handleOffset = -handleSize / 2

  return (
    <div
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={`${preset.name ?? preset.id} (${percentages.x.toFixed(1)}%, ${percentages.y.toFixed(1)}%, ${percentages.width.toFixed(1)}%, ${percentages.height.toFixed(1)}%)${isSelected ? " - Drag to move, drag corners to resize" : ""}`}
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
      aria-label={`Crop preset ${preset.name ?? preset.id}${isSelected ? " - Drag to move, drag corners to resize" : ""}`}
      role="button"
      tabIndex={0}
    >
      {isSelected && (
        <>
          {/* Corner handles */}
          <button
            type="button"
            className="absolute bg-gray-900 border-2 border-white rounded-sm cursor-nwse-resize z-10 p-0"
            style={{
              left: handleOffset,
              top: handleOffset,
              width: handleSize,
              height: handleSize,
            }}
            onMouseDown={(e) => handleResizeMouseDown('nw', e)}
            title="Resize top-left"
            aria-label="Resize top-left corner"
          />
          <button
            type="button"
            className="absolute bg-gray-900 border-2 border-white rounded-sm cursor-nesw-resize z-10 p-0"
            style={{
              right: handleOffset,
              top: handleOffset,
              width: handleSize,
              height: handleSize,
            }}
            onMouseDown={(e) => handleResizeMouseDown('ne', e)}
            title="Resize top-right"
            aria-label="Resize top-right corner"
          />
          <button
            type="button"
            className="absolute bg-gray-900 border-2 border-white rounded-sm cursor-nesw-resize z-10 p-0"
            style={{
              left: handleOffset,
              bottom: handleOffset,
              width: handleSize,
              height: handleSize,
            }}
            onMouseDown={(e) => handleResizeMouseDown('sw', e)}
            title="Resize bottom-left"
            aria-label="Resize bottom-left corner"
          />
          <button
            type="button"
            className="absolute bg-gray-900 border-2 border-white rounded-sm cursor-nwse-resize z-10 p-0"
            style={{
              right: handleOffset,
              bottom: handleOffset,
              width: handleSize,
              height: handleSize,
            }}
            onMouseDown={(e) => handleResizeMouseDown('se', e)}
            title="Resize bottom-right"
            aria-label="Resize bottom-right corner"
          />
        </>
      )}
    </div>
  )
})

interface PresetSidebarProps {
  presets: CropPreset[]
  selectedPresetId?: string
  cropPreviewUrl: string | null
  cropBoxInfo: {
    width: number
    height: number
    x: number
    y: number
    mediaBoxWidth: number
    mediaBoxHeight: number
  } | null
  onSelectPreset: (id: string) => void
  onDeletePreset: (id: string) => void
}

const PresetSidebar = memo(function PresetSidebar({
  presets,
  selectedPresetId,
  cropPreviewUrl,
  cropBoxInfo,
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
                cropBoxInfo={cropBoxInfo}
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
  cropBoxInfo: {
    width: number
    height: number
    x: number
    y: number
    mediaBoxWidth: number
    mediaBoxHeight: number
  } | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

const PresetItem = memo(function PresetItem({
  preset,
  isSelected,
  cropBoxInfo,
  onSelect,
  onDelete,
}: PresetItemProps) {
  const [copied, setCopied] = useState(false)
  const handleSelect = useCallback(() => onSelect(preset.id), [preset.id, onSelect])
  const handleDelete = useCallback(() => onDelete(preset.id), [preset.id, onDelete])

  // Helper function to convert preset coordinates to CropBox percentages
  const getCropBoxPercentages = useCallback((preset: CropPreset) => {
    if (!cropBoxInfo) {
      // Fallback to MediaBox percentages if CropBox info not available
      return {
        x: preset.x * 100,
        y: preset.y * 100,
        width: preset.width * 100,
        height: preset.height * 100
      }
    }

    const { width: cropBoxWidth, height: cropBoxHeight, x: cropBoxX, y: cropBoxY, mediaBoxWidth, mediaBoxHeight } = cropBoxInfo

    // Preset coordinates are ratios (0-1) relative to MediaBox in canvas coordinates (top-left origin)
    // Convert to MediaBox canvas coordinates
    const mediaBoxCanvasX = preset.x * mediaBoxWidth
    const mediaBoxCanvasY = preset.y * mediaBoxHeight
    const mediaBoxCanvasW = preset.width * mediaBoxWidth
    const mediaBoxCanvasH = preset.height * mediaBoxHeight

    // Convert canvas coordinates (top-left) to PDF coordinates (bottom-left)
    // In PDF coordinates, y=0 is at bottom, so: pdfY = mediaBoxHeight - canvasY - height
    const mediaBoxPdfX = mediaBoxCanvasX
    const mediaBoxPdfY = mediaBoxHeight - mediaBoxCanvasY - mediaBoxCanvasH
    const mediaBoxPdfW = mediaBoxCanvasW
    const mediaBoxPdfH = mediaBoxCanvasH

    // Convert PDF MediaBox coordinates to CropBox coordinates
    // CropBox coordinates are relative to CropBox origin
    const cropBoxPdfX = mediaBoxPdfX - cropBoxX
    const cropBoxPdfY = mediaBoxPdfY - cropBoxY
    const cropBoxPdfW = mediaBoxPdfW
    const cropBoxPdfH = mediaBoxPdfH

    // Convert to percentages relative to CropBox
    const xPercent = (cropBoxPdfX / cropBoxWidth) * 100
    const yPercent = (cropBoxPdfY / cropBoxHeight) * 100
    const widthPercent = (cropBoxPdfW / cropBoxWidth) * 100
    const heightPercent = (cropBoxPdfH / cropBoxHeight) * 100

    return {
      x: clamp(xPercent, 0, 100),
      y: clamp(yPercent, 0, 100),
      width: clamp(widthPercent, 0, 100),
      height: clamp(heightPercent, 0, 100)
    }
  }, [cropBoxInfo])

  const percentages = getCropBoxPercentages(preset)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect(preset.id)
    }
  }, [preset.id, onSelect])

  const handleCopyPreset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const pythonString = `[${(percentages.x / 100).toFixed(4)}, ${(percentages.y / 100).toFixed(4)}, ${(percentages.width / 100).toFixed(4)}, ${(percentages.height / 100).toFixed(4)}]`
    navigator.clipboard.writeText(pythonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [percentages])

  return (
    <div className="flex justify-between items-center gap-2">
      <div className="flex-1 flex items-center gap-2" >
        <button
          className={`flex-1 cursor-pointer text-left px-3 py-2.5 rounded-lg transition-all duration-200 ${
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
              <span className="font-semibold text-gray-700">X:</span> {percentages.x.toFixed(1)}% &nbsp; 
              <span className="font-semibold text-gray-700">Y:</span> {percentages.y.toFixed(1)}%
            </span>
            <span>
              <span className="font-semibold text-gray-700">W:</span> {percentages.width.toFixed(1)}% &nbsp; 
              <span className="font-semibold text-gray-700">H:</span> {percentages.height.toFixed(1)}%
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1 flex-col">
          <div className="relative">
            <button
              onClick={handleCopyPreset}
              className="size-8 bg-white text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:bg-gray-100 transition-all duration-200 flex items-center justify-center"
              title="Copy CropBox coordinates as Python list"
              aria-label="Copy CropBox coordinates as Python list"
              tabIndex={0}
            >
              <CopyIcon className="w-3.5 h-3.5" />
            </button>
            {copied && (
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gray-800 text-white text-xs rounded shadow z-10 whitespace-nowrap">
                Copied!
              </span>
            )}
          </div>
          <button 
            className="size-8 bg-white text-gray-600 border border-gray-200 rounded-lg hover:bg-red-50 hover:border-red-300 hover:text-red-600 active:bg-red-100 transition-all duration-200 flex items-center justify-center hover:shadow-md"
            onClick={handleDelete} 
            title="Delete preset"
            aria-label={`Delete preset ${preset.name ?? "Unnamed"}`}
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
})

export default PageCropper
