/**
 * IndexedDB utilities for storing large PDF files in chunks
 * Handles files >100MB by splitting into 1-16MB slices
 */

const DB_NAME = "pdf-workspace-db"
const DB_VERSION = 1

// Object store names
const STORES = {
  PDF_CHUNKS: "pdfChunks", // Chunked PDF binary data
  PDF_METADATA: "pdfMetadata", // PDF metadata (name, total pages, etc.)
  ANNOTATIONS: "annotations", // Page annotations
  CROP_PRESETS: "cropPresets", // Crop presets
  PAGE_STATES: "pageStates", // Page-specific states (applied presets)
} as const

const CHUNK_SIZE = 8 * 1024 * 1024 // 8MB chunks (safe middle ground)

interface DbChunk {
  pdfId: string
  chunkIndex: number
  data: ArrayBuffer
}

interface PdfMetadata {
  pdfId: string
  name: string
  totalPages: number
  numChunks: number
  uploadedAt: number
}

let dbInstance: IDBDatabase | null = null

/**
 * Initialize IndexedDB database
 */
export async function initDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains(STORES.PDF_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORES.PDF_CHUNKS, { keyPath: ["pdfId", "chunkIndex"] })
        chunkStore.createIndex("pdfId", "pdfId", { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.PDF_METADATA)) {
        db.createObjectStore(STORES.PDF_METADATA, { keyPath: "pdfId" })
      }

      if (!db.objectStoreNames.contains(STORES.ANNOTATIONS)) {
        const annotationStore = db.createObjectStore(STORES.ANNOTATIONS, { keyPath: ["pdfId", "pageNumber"] })
        annotationStore.createIndex("pdfId", "pdfId", { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.CROP_PRESETS)) {
        db.createObjectStore(STORES.CROP_PRESETS, { keyPath: "id" })
      }

      if (!db.objectStoreNames.contains(STORES.PAGE_STATES)) {
        const pageStateStore = db.createObjectStore(STORES.PAGE_STATES, { keyPath: ["pdfId", "pageNumber"] })
        pageStateStore.createIndex("pdfId", "pdfId", { unique: false })
      }
    }
  })
}

/**
 * Generate a unique PDF ID
 */
function generatePdfId(): string {
  return `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Split ArrayBuffer into chunks
 */
function chunkArrayBuffer(buffer: ArrayBuffer, chunkSize: number = CHUNK_SIZE): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = []
  let offset = 0

  while (offset < buffer.byteLength) {
    const end = Math.min(offset + chunkSize, buffer.byteLength)
    chunks.push(buffer.slice(offset, end))
    offset = end
  }

  return chunks
}

/**
 * Store PDF file in IndexedDB as chunks
 */
export async function storePdf(file: File): Promise<string> {
  const db = await initDatabase()
  const pdfId = generatePdfId()

  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer()
  const chunks = chunkArrayBuffer(arrayBuffer)

  // Store metadata
  const metadata: PdfMetadata = {
    pdfId,
    name: file.name,
    totalPages: 0, // Will be updated after PDF parsing
    numChunks: chunks.length,
    uploadedAt: Date.now(),
  }

  const metadataTx = db.transaction([STORES.PDF_METADATA], "readwrite")
  await promisifyRequest(metadataTx.objectStore(STORES.PDF_METADATA).put(metadata))

  // Store chunks in parallel transactions
  const chunkPromises = chunks.map((chunk, index) => {
    const chunkTx = db.transaction([STORES.PDF_CHUNKS], "readwrite")
    const chunkData: DbChunk = {
      pdfId,
      chunkIndex: index,
      data: chunk,
    }
    return promisifyRequest(chunkTx.objectStore(STORES.PDF_CHUNKS).put(chunkData))
  })

  await Promise.all(chunkPromises)

  return pdfId
}

/**
 * Retrieve PDF from IndexedDB chunks and return as Blob
 */
export async function getPdfBlob(pdfId: string): Promise<Blob> {
  const db = await initDatabase()

  // Get metadata to know chunk count
  const metadataTx = db.transaction([STORES.PDF_METADATA], "readonly")
  const metadata = await promisifyRequest<PdfMetadata>(
    metadataTx.objectStore(STORES.PDF_METADATA).get(pdfId)
  )

  if (!metadata) {
    throw new Error(`PDF with id ${pdfId} not found`)
  }

  // Retrieve all chunks
  const chunkStore = db.transaction([STORES.PDF_CHUNKS], "readonly").objectStore(STORES.PDF_CHUNKS)
  const index = chunkStore.index("pdfId")
  const chunkMap = new Map<number, ArrayBuffer>()

  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(pdfId))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const chunk = cursor.value as DbChunk
        chunkMap.set(chunk.chunkIndex, chunk.data)
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(request.error)
  })

  // Sort chunks by index and combine
  // Ensure we have all chunks in order
  const chunks: ArrayBuffer[] = []
  for (let i = 0; i < metadata.numChunks; i++) {
    const chunk = chunkMap.get(i)
    if (!chunk) {
      throw new Error(`Missing chunk ${i} for PDF ${pdfId}`)
    }
    chunks.push(chunk)
  }

  // Combine chunks into single ArrayBuffer
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset)
    offset += chunk.byteLength
  }

  return new Blob([combined.buffer], { type: "application/pdf" })
}

/**
 * Get PDF metadata
 */
export async function getPdfMetadata(pdfId: string): Promise<PdfMetadata | null> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.PDF_METADATA], "readonly")
  return await promisifyRequest<PdfMetadata | null>(tx.objectStore(STORES.PDF_METADATA).get(pdfId))
}

/**
 * Update PDF metadata (e.g., total pages after parsing)
 */
export async function updatePdfMetadata(pdfId: string, updates: Partial<PdfMetadata>): Promise<void> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.PDF_METADATA], "readwrite")
  const store = tx.objectStore(STORES.PDF_METADATA)
  const existing = await promisifyRequest<PdfMetadata>(store.get(pdfId))
  
  if (existing) {
    await promisifyRequest(store.put({ ...existing, ...updates }))
  }
}

/**
 * Store crop preset
 */
export async function storeCropPreset(pdfId: string, preset: { id: string; name?: string; x: number; y: number; width: number; height: number }): Promise<void> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.CROP_PRESETS], "readwrite")
  await promisifyRequest(tx.objectStore(STORES.CROP_PRESETS).put({ ...preset, pdfId }))
}

/**
 * Get all crop presets for a PDF
 */
export async function getCropPresets(pdfId: string): Promise<Array<{ id: string; name?: string; x: number; y: number; width: number; height: number }>> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.CROP_PRESETS], "readonly")
  const store = tx.objectStore(STORES.CROP_PRESETS)
  const presets: Array<{ id: string; name?: string; x: number; y: number; width: number; height: number }> = []

  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor()
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const value = cursor.value as { pdfId: string; id: string; name?: string; x: number; y: number; width: number; height: number }
        if (value.pdfId === pdfId) {
          const { pdfId: _, ...preset } = value
          presets.push(preset)
        }
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(request.error)
  })

  return presets
}

/**
 * Delete crop preset
 */
export async function deleteCropPreset(presetId: string): Promise<void> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.CROP_PRESETS], "readwrite")
  await promisifyRequest(tx.objectStore(STORES.CROP_PRESETS).delete(presetId))
}

/**
 * Store page state (applied preset)
 */
export async function storePageState(pdfId: string, pageNumber: number, state: { appliedPresetId?: string }): Promise<void> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.PAGE_STATES], "readwrite")
  await promisifyRequest(tx.objectStore(STORES.PAGE_STATES).put({ pdfId, pageNumber, ...state }))
}

/**
 * Get page state
 */
export async function getPageState(pdfId: string, pageNumber: number): Promise<{ appliedPresetId?: string } | null> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.PAGE_STATES], "readonly")
  const result = await promisifyRequest<{ pdfId: string; pageNumber: number; appliedPresetId?: string } | null>(
    tx.objectStore(STORES.PAGE_STATES).get([pdfId, pageNumber])
  )
  
  if (result) {
    const { pdfId: _, pageNumber: __, ...state } = result
    return state
  }
  return null
}

/**
 * Get all page states for a PDF
 */
export async function getAllPageStates(pdfId: string): Promise<Record<number, { appliedPresetId?: string }>> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.PAGE_STATES], "readonly")
  const store = tx.objectStore(STORES.PAGE_STATES)
  const index = store.index("pdfId")
  const states: Record<number, { appliedPresetId?: string }> = {}

  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(pdfId))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const value = cursor.value as { pdfId: string; pageNumber: number; appliedPresetId?: string }
        const { pdfId: _, pageNumber, ...state } = value
        states[pageNumber] = state
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(request.error)
  })

  return states
}

/**
 * Delete all data for a PDF
 */
export async function deletePdf(pdfId: string): Promise<void> {
  const db = await initDatabase()

  // Delete chunks
  const chunkTx = db.transaction([STORES.PDF_CHUNKS], "readwrite")
  const chunkStore = chunkTx.objectStore(STORES.PDF_CHUNKS)
  const chunkIndex = chunkStore.index("pdfId")
  
  await new Promise<void>((resolve, reject) => {
    const request = chunkIndex.openKeyCursor(IDBKeyRange.only(pdfId))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor>).result
      if (cursor) {
        chunkStore.delete(cursor.primaryKey)
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(request.error)
  })

  // Delete metadata
  const metadataTx = db.transaction([STORES.PDF_METADATA], "readwrite")
  await promisifyRequest(metadataTx.objectStore(STORES.PDF_METADATA).delete(pdfId))

  // Delete page states
  const stateTx = db.transaction([STORES.PAGE_STATES], "readwrite")
  const stateStore = stateTx.objectStore(STORES.PAGE_STATES)
  const stateIndex = stateStore.index("pdfId")
  
  await new Promise<void>((resolve, reject) => {
    const request = stateIndex.openKeyCursor(IDBKeyRange.only(pdfId))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor>).result
      if (cursor) {
        stateStore.delete(cursor.primaryKey)
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get current PDF ID (most recent)
 */
export async function getCurrentPdfId(): Promise<string | null> {
  const db = await initDatabase()
  const tx = db.transaction([STORES.PDF_METADATA], "readonly")
  const store = tx.objectStore(STORES.PDF_METADATA)
  
  return new Promise((resolve, reject) => {
    const request = store.openCursor(null, "prev") // Get most recent
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      resolve(cursor ? (cursor.value as PdfMetadata).pdfId : null)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Helper to promisify IDBRequest
 */
function promisifyRequest<T = unknown>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}
