import { memo, useCallback } from "react"

interface PageNavProps {
  pages: number[]
  current: number
  onSelect: (page: number) => void
}

const PageNav = memo(function PageNav({ pages, current, onSelect }: PageNavProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {pages.map(page => (
        <PageButton
          key={page}
          page={page}
          isActive={page === current}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
})

interface PageButtonProps {
  page: number
  isActive: boolean
  onSelect: (page: number) => void
}

const PageButton = memo(function PageButton({ page, isActive, onSelect }: PageButtonProps) {
  const handleClick = useCallback(() => onSelect(page), [page, onSelect])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect(page)
    }
  }, [page, onSelect])

  return (
    <button
      className={`w-min  px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
        isActive
          ? "bg-gray-900 text-white shadow-md border-2 border-gray-900"
          : "bg-white text-gray-700 border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100"
      }`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`Go to page ${page}`}
      aria-current={isActive ? "page" : undefined}
      tabIndex={0}
    >
      {page}
    </button>
  )
})

export default PageNav
