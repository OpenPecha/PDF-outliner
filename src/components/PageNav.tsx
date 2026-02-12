import { memo, useCallback } from "react"
import { useParams, useSearchParams } from "react-router-dom"

interface PageNavProps {
  pages: number[]
  current: number
  onSelect: (page: number) => void
}

const PageNav = memo(function PageNav({ pages, current, onSelect }: PageNavProps) {
  return (
    <div className="page-list">
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
  return (
    <button
      className={isActive ? "page-btn-active" : "page-btn"}
      onClick={handleClick}
    >
      Page {page}
    </button>
  )
})

export default PageNav
