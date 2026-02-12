import { useState, useEffect, useCallback } from "react"
import { clamp } from "../utils/lib"

function readQueryPage(): number {
  const p = new URLSearchParams(window.location.search).get("p")
  const v = Number(p)
  if (!Number.isFinite(v) || v < 1) return 1
  return Math.floor(v)
}

function setQueryPage(p: number) {
  const url = new URL(window.location.href)
  url.searchParams.set("p", String(p))
  window.history.pushState({}, "", url.toString())
}

interface UsePageNavigationReturn {
  currentPage: number
  navigateToPage: (page: number) => void
}

export function usePageNavigation(availablePages: number[]): UsePageNavigationReturn {
  const [currentPage, setCurrentPage] = useState<number>(() => readQueryPage())

  // Handle browser back/forward navigation
  useEffect(() => {
    const onPopState = () => setCurrentPage(readQueryPage())
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  // Ensure page is in valid range
  useEffect(() => {
    if (availablePages.length === 0) return
    const maxPage = Math.max(...availablePages)
    const validPage = clamp(currentPage, 1, maxPage)
    if (validPage !== currentPage) {
      setCurrentPage(validPage)
      setQueryPage(validPage)
    }
  }, [availablePages, currentPage])

  const navigateToPage = useCallback((page: number) => {
    setCurrentPage(page)
    setQueryPage(page)
  }, [])

  return {
    currentPage,
    navigateToPage,
  }
}
