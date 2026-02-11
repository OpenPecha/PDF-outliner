import React, { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { clamp, renderPdfPageToCanvas, cropCanvasToDataUrl, dataUrlToUint8Array, uid, loadWorkspace, saveWorkspace } from "../utils/lib";
import type { CropPreset } from "../types";
import "../App.css";

function PageCropper({
    pdfDataUrl,
    pageNumber,
    presets,
    appliedPresetId,
    onCreatePreset,
    onDeletePreset,
    onApplyPreset,
    onClearApplied,
  }: {
    pdfDataUrl: string;
    pageNumber: number;
    presets: CropPreset[];
    appliedPresetId?: string;
    onCreatePreset: (preset: CropPreset) => void;
    onDeletePreset: (presetId: string) => void;
    onApplyPreset: (presetId: string) => void;
    onClearApplied: () => void;
  }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
    const [rendering, setRendering] = useState(true);
    const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [displaySize, setDisplaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  
    const [drag, setDrag] = useState<null | { startX: number; startY: number; x: number; y: number; w: number; h: number }>(
      null
    );
  
    const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(appliedPresetId);
    const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);
    const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  
    // Render page
    useEffect(() => {
      let cancelled = false;
      (async () => {
        setRendering(true);
        setCropPreviewUrl(null);
  
        const pdf = await (pdfjsLib as any).getDocument({ data: dataUrlToUint8Array(pdfDataUrl) }).promise;
        const { canvas, width, height } = await renderPdfPageToCanvas(pdf, pageNumber, 900);
  
        if (cancelled) return;
  
        canvasRef.current = canvas;
        setImgSize({ w: width, h: height });
  
        // Paint into DOM canvas
        const domCanvas = document.getElementById("pdf-canvas") as HTMLCanvasElement | null;
        if (domCanvas) {
          domCanvas.width = width;
          domCanvas.height = height;
          const ctx = domCanvas.getContext("2d");
          ctx?.clearRect(0, 0, width, height);
          ctx?.drawImage(canvas, 0, 0);
          
          // Track display size after canvas is rendered
          const updateDisplaySize = () => {
            const rect = domCanvas.getBoundingClientRect();
            setDisplaySize({ w: rect.width, h: rect.height });
          };
          requestAnimationFrame(updateDisplaySize);
        }
  
        setRendering(false);
      })();
  
      return () => {
        cancelled = true;
      };
    }, [pdfDataUrl, pageNumber]);
  
    // Update display size on resize
    useEffect(() => {
      const updateDisplaySize = () => {
        const domCanvas = document.getElementById("pdf-canvas") as HTMLCanvasElement | null;
        if (domCanvas) {
          const rect = domCanvas.getBoundingClientRect();
          setDisplaySize({ w: rect.width, h: rect.height });
        }
      };
      
      window.addEventListener("resize", updateDisplaySize);
      // Also update when container might resize
      const observer = new ResizeObserver(updateDisplaySize);
      const container = containerRef.current;
      if (container) {
        observer.observe(container);
      }
      
      return () => {
        window.removeEventListener("resize", updateDisplaySize);
        observer.disconnect();
      };
    }, []);
  
    // If applied preset changes externally, reflect it
    useEffect(() => {
      setSelectedPresetId(appliedPresetId);
    }, [appliedPresetId]);
  
    function getRelativePos(e: React.MouseEvent) {
      const el = containerRef.current;
      if (!el || imgSize.w === 0 || imgSize.h === 0 || displaySize.w === 0 || displaySize.h === 0) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      // Convert display coordinates to pixel coordinates
      const scaleX = imgSize.w / displaySize.w;
      const scaleY = imgSize.h / displaySize.h;
      const displayX = e.clientX - rect.left;
      const displayY = e.clientY - rect.top;
      const x = clamp(displayX * scaleX, 0, imgSize.w);
      const y = clamp(displayY * scaleY, 0, imgSize.h);
      return { x, y };
    }
  
    function onMouseDown(e: React.MouseEvent) {
      if (rendering) return;
      const { x, y } = getRelativePos(e);
      setDrag({ startX: x, startY: y, x, y, w: 0, h: 0 });
    }
  
    function onMouseMove(e: React.MouseEvent) {
      if (!drag) return;
      const { x, y } = getRelativePos(e);
  
      const left = Math.min(drag.startX, x);
      const top = Math.min(drag.startY, y);
      const w = Math.abs(x - drag.startX);
      const h = Math.abs(y - drag.startY);
  
      setDrag({ ...drag, x: left, y: top, w, h });
    }
  
    function onMouseUp() {
      if (!drag) return;
      const minSize = 8;
      if (drag.w < minSize || drag.h < minSize) {
        setDrag(null);
        return;
      }
  
      const preset: CropPreset = {
        id: uid(),
        name: `Preset ${presets.length + 1}`,
        x: Math.round(drag.x),
        y: Math.round(drag.y),
        width: Math.round(drag.w),
        height: Math.round(drag.h),
      };
  
      onCreatePreset(preset);
      setSelectedPresetId(preset.id);
      setDrag(null);
    }
  
    function previewCrop() {
      const src = canvasRef.current;
      if (!src || !selectedPreset) return;
  
      // Clamp to bounds
      const x = clamp(selectedPreset.x, 0, src.width - 1);
      const y = clamp(selectedPreset.y, 0, src.height - 1);
      const w = clamp(selectedPreset.width, 1, src.width - x);
      const h = clamp(selectedPreset.height, 1, src.height - y);
  
      const url = cropCanvasToDataUrl(src, { x, y, width: w, height: h });
      setCropPreviewUrl(url);
    }
  
    return (
      <div>
        <div className="row-between">
          <div>
            <h3 className="h3">Page {pageNumber}</h3>
            <div className="subtle">Draw a rectangle on the page to create a crop preset.</div>
          </div>

          <div className="row">
            <button
              className="btn"
              onClick={() => {
                if (!selectedPresetId) return;
                onApplyPreset(selectedPresetId);
              }}
              disabled={!selectedPresetId}
            >
              Apply preset to this page
            </button>

            <button className="btn-ghost" onClick={onClearApplied}>
              Clear applied
            </button>

            <button className="btn" onClick={previewCrop} disabled={!selectedPreset}>
              Preview crop
            </button>
          </div>
        </div>

        <div className="workspace-row mt-12">
          <div className="canvas-wrap">
            <div
              ref={containerRef}
              className="canvas-overlay"
              style={{ width: displaySize.w || imgSize.w, height: displaySize.h || imgSize.h }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={() => setDrag(null)}
            >
              {/* Existing presets overlay */}
              {presets.map((p) => {
                const isSelected = p.id === selectedPresetId;
                const isApplied = p.id === appliedPresetId;
                // Scale preset coordinates from pixel space to display space
                const scaleX = displaySize.w > 0 ? displaySize.w / imgSize.w : 1;
                const scaleY = displaySize.h > 0 ? displaySize.h / imgSize.h : 1;
                return (
                  <div
                    key={p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPresetId(p.id);
                    }}
                    title={`${p.name ?? p.id} (${p.x},${p.y},${p.width},${p.height})`}
                    style={{
                      position: "absolute",
                      left: p.x * scaleX,
                      top: p.y * scaleY,
                      width: p.width * scaleX,
                      height: p.height * scaleY,
                      border: isSelected ? "2px solid #111" : "1px solid #666",
                      background: "rgba(0,0,0,0.06)",
                      boxShadow: isApplied ? "0 0 0 2px rgba(0,0,0,0.25) inset" : undefined,
                      cursor: "pointer",
                    }}
                  />
                );
              })}
  
              {/* Drag preview */}
              {drag && (() => {
                const scaleX = displaySize.w > 0 ? displaySize.w / imgSize.w : 1;
                const scaleY = displaySize.h > 0 ? displaySize.h / imgSize.h : 1;
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: drag.x * scaleX,
                      top: drag.y * scaleY,
                      width: drag.w * scaleX,
                      height: drag.h * scaleY,
                      border: "2px dashed #111",
                      background: "rgba(0,0,0,0.04)",
                      pointerEvents: "none",
                    }}
                  />
                );
              })()}
            </div>

            <canvas id="pdf-canvas" className="canvas" />

            {rendering && <div className="loading-cover">Rendering…</div>}
          </div>

          <div className="sidebar">
            <div className="card">
              <div className="card-title">Presets</div>

              {presets.length === 0 ? (
                <div className="subtle">No presets yet. Draw a rectangle on the page.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {presets.map((p) => (
                    <div key={p.id} className="preset-row">
                      <button
                        className={p.id === selectedPresetId ? "preset-btn-active" : "preset-btn"}
                        onClick={() => setSelectedPresetId(p.id)}
                      >
                        <div style={{ fontWeight: 600 }}>{p.name ?? "Unnamed"}</div>
                        <div className="subtle-small">
                          x:{p.x} y:{p.y} w:{p.width} h:{p.height}
                        </div>
                      </button>
                      <button className="icon-btn" onClick={() => onDeletePreset(p.id)} title="Delete preset">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedPreset && (
              <div className="card">
                <div className="card-title">Selected Preset</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <label className="label">
                    Name
                    <input
                      className="input"
                      value={selectedPreset.name ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        // local edit: update by re-creating via localStorage layer is outside;
                        // simplest: mutate by copying at App-level -> so we do it via custom event
                        // Instead: just update in-place using localStorage write. We'll do a tiny hack:
                        const raw = loadWorkspace();
                        raw.presets = raw.presets.map((pp) => (pp.id === selectedPreset.id ? { ...pp, name: v } : pp));
                        saveWorkspace(raw);
                        // force reload by dispatching storage event-ish:
                        window.dispatchEvent(new Event("storage"));
                      }}
                    />
                  </label>

                  <div className="notice">
                    Applied to this page:{" "}
                    <strong>{appliedPresetId ? presets.find((p) => p.id === appliedPresetId)?.name ?? "Preset" : "None"}</strong>
                  </div>

                  {cropPreviewUrl && (
                    <div>
                      <div className="card-title">Cropped Preview</div>
                      <img src={cropPreviewUrl} alt="Cropped preview" style={{ width: "100%", borderRadius: 10 }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="notice mt-12">
          Coordinates are stored in <strong>rendered image pixel space</strong> (canvas pixels). That matches your later backend
          plan (pdftoppm output → crop by pixels).
        </div>
      </div>
    );
  }

  export default PageCropper;