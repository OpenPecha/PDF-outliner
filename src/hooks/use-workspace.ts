import { useState, useEffect, useCallback, useMemo } from "react"
import type { CropPreset } from "../types"
import {
  initDatabase,
  storePdf,
  getPdfBlob,
  getPdfMetadata,
  updatePdfMetadata,
  getCropPresets,
  storeCropPreset,
  deleteCropPreset,
  storePageState,
  getAllPageStates,
  getCurrentPdfId,
  deletePdf,
} from "../utils/indexed-db"
import * as pdfjsLib from "pdfjs-dist"
import { MAX_PRESETS_PER_PDF } from "../config"

const MAX_RENDER_PAGES = 10

interface WorkspaceState {
  pdfId: string | null
  pdfName?: string
  pdfDataUrl?: string // Blob URL or data URL for rendering
  pdfBlobUrl: string | null // Blob URL for rendering (created from IndexedDB)
  totalPages?: number
  presets: CropPreset[]
  pages: Record<number, { appliedPresetId?: string }>
}

interface UseWorkspaceReturn {
  workspace: WorkspaceState
  isLoading: boolean
  availablePages: number[]
  uploadPdf: (file: File) => Promise<void>
  resetWorkspace: () => Promise<void>
  createPreset: (preset: CropPreset) => Promise<void>
  deletePreset: (presetId: string) => Promise<void>
  applyPreset: (page: number, presetId: string) => Promise<void>
  clearAppliedPreset: (page: number) => Promise<void>
  updatePresetName: (presetId: string, name: string) => Promise<void>
  getPdfBlobForExport: () => Promise<Blob | null>
}

const initialWorkspace: WorkspaceState = {
  pdfId: null,
  pdfBlobUrl: null,
  presets: [],
  pages: {},
}

export const STORAGE_KEY = "pdf-crop-workspace-v1";


export function useWorkspace(): UseWorkspaceReturn {
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace)
  const [isLoading, setIsLoading] = useState(true)

  // Initialize database and load current PDF on mount
  useEffect(() => {
    let cancelled = false

    async function loadWorkspace() {
      try {
        await initDatabase()
        const pdfId = await getCurrentPdfId()

        if (pdfId && !cancelled) {
          const metadata = await getPdfMetadata(pdfId)
          if (metadata) {
            const blob = await getPdfBlob(pdfId)
            const blobUrl = URL.createObjectURL(blob)

            const presets = await getCropPresets(pdfId)
            const pages = await getAllPageStates(pdfId)

            setWorkspace({
              pdfId,
              pdfName: metadata.name,
              pdfBlobUrl: blobUrl,
              totalPages: metadata.totalPages,
              presets,
              pages,
            })
          }
        }
      } catch (error) {
        console.error("Failed to load workspace:", error)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadWorkspace()

    return () => {
      cancelled = true
      // Clean up blob URL
      if (workspace.pdfBlobUrl) {
        URL.revokeObjectURL(workspace.pdfBlobUrl)
      }
    }
  }, [])

  const availablePages = useMemo(() => {
    const n = workspace.totalPages ?? 0
    if (n === 0) return []
    
    // Create array of all page numbers
    const allPages = Array.from({ length: n }, (_, i) => i + 1)
    
    // If total pages is less than or equal to MAX_RENDER_PAGES, return all pages
    if (n <= MAX_RENDER_PAGES) return allPages
    
    // Randomly pick MAX_RENDER_PAGES pages
    const selected: number[] = []
    const available = [...allPages]
    
    for (let i = 0; i < MAX_RENDER_PAGES; i++) {
      const randomIndex = Math.floor(Math.random() * available.length)
      selected.push(available[randomIndex])
      available.splice(randomIndex, 1)
    }
    
    // Sort the selected pages for better UX
    return selected.sort((a, b) => a - b)
  }, [workspace.totalPages])

  const uploadPdf = useCallback(async (file: File) => {
    setIsLoading(true)
    try {
      // Clean up old blob URL
      if (workspace.pdfBlobUrl) {
        URL.revokeObjectURL(workspace.pdfBlobUrl)
      }

      // Delete old PDF if exists
      if (workspace.pdfId) {
        await deletePdf(workspace.pdfId)
      }

      // Store PDF in IndexedDB
      const pdfId = await storePdf(file)

      // Parse PDF to get page count
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise
      const totalPages = pdf.numPages

      // Update metadata with page count
      await updatePdfMetadata(pdfId, { totalPages })

      // Create blob URL for rendering
      const blob = await getPdfBlob(pdfId)
      const blobUrl = URL.createObjectURL(blob)

      setWorkspace({
        pdfId,
        pdfName: file.name,
        pdfBlobUrl: blobUrl,
        totalPages,
        presets: [],
        pages: {},
      })
    } catch (error) {
      console.error("Failed to upload PDF:", error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [workspace.pdfId, workspace.pdfBlobUrl])

  const resetWorkspace = useCallback(async () => {
    if (workspace.pdfBlobUrl) {
      URL.revokeObjectURL(workspace.pdfBlobUrl)
    }

    if (workspace.pdfId) {
      await deletePdf(workspace.pdfId)
    }

    setWorkspace(initialWorkspace)
  }, [workspace.pdfId, workspace.pdfBlobUrl])

  const createPreset = useCallback(
    async (preset: CropPreset) => {
      if (!workspace.pdfId) return

      // Check if limit is reached
      if (workspace.presets.length >= MAX_PRESETS_PER_PDF) {
        throw new Error(`Maximum ${MAX_PRESETS_PER_PDF} preset${MAX_PRESETS_PER_PDF > 1 ? 's' : ''} per PDF allowed`)
      }

      await storeCropPreset(workspace.pdfId, preset)
      setWorkspace((prev) => ({
        ...prev,
        presets: [...prev.presets, preset],
      }))
    },
    [workspace.pdfId, workspace.presets.length]
  )

  const deletePreset = useCallback(
    async (presetId: string) => {
      if (!workspace.pdfId) return

      await deleteCropPreset(presetId)
      setWorkspace((prev) => ({
        ...prev,
        presets: prev.presets.filter((p) => p.id !== presetId),
        pages: Object.fromEntries(
          Object.entries(prev.pages).map(([k, v]) => {
            const pn = Number(k)
            if (v.appliedPresetId === presetId) {
              return [pn, { ...v, appliedPresetId: undefined }]
            }
            return [pn, v]
          })
        ),
      }))
    },
    [workspace.pdfId]
  )

  const applyPreset = useCallback(
    async (page: number, presetId: string) => {
      if (!workspace.pdfId) return

      await storePageState(workspace.pdfId, page, { appliedPresetId: presetId })
      setWorkspace((prev) => ({
        ...prev,
        pages: {
          ...prev.pages,
          [page]: { ...prev.pages[page], appliedPresetId: presetId },
        },
      }))
    },
    [workspace.pdfId]
  )

  const clearAppliedPreset = useCallback(
    async (page: number) => {
      if (!workspace.pdfId) return

      await storePageState(workspace.pdfId, page, { appliedPresetId: undefined })
      setWorkspace((prev) => ({
        ...prev,
        pages: {
          ...prev.pages,
          [page]: { ...prev.pages[page], appliedPresetId: undefined },
        },
      }))
    },
    [workspace.pdfId]
  )

  const updatePresetName = useCallback(
    async (presetId: string, name: string) => {
      if (!workspace.pdfId) return

      // Update in IndexedDB (preset already stored, just update name)
      const presets = await getCropPresets(workspace.pdfId)
      const preset = presets.find((p) => p.id === presetId)
      if (preset) {
        await storeCropPreset(workspace.pdfId, { ...preset, name })
      }

      setWorkspace((prev) => ({
        ...prev,
        presets: prev.presets.map((p) => (p.id === presetId ? { ...p, name } : p)),
      }))
    },
    [workspace.pdfId]
  )

  const getPdfBlobForExport = useCallback(async (): Promise<Blob | null> => {
    if (!workspace.pdfId) return null
    return await getPdfBlob(workspace.pdfId)
  }, [workspace.pdfId])


  
  return {
    workspace: {
      pdfId: workspace.pdfId,
      pdfName: workspace.pdfName,
      pdfDataUrl: workspace.pdfBlobUrl ?? undefined, // Blob URL as data URL for rendering
      pdfBlobUrl: workspace.pdfBlobUrl,
      totalPages: workspace.totalPages,
      presets: workspace.presets,
      pages: workspace.pages,
    },
    isLoading,
    availablePages,
    uploadPdf,
    resetWorkspace,
    createPreset,
    deletePreset,
    applyPreset,
    clearAppliedPreset,
    updatePresetName,
    getPdfBlobForExport,
  }
}
