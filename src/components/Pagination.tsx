interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

/** Windowed pager: first, last, and a small window around the current page. */
function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1])
  const visible = Array.from(pages)
    .filter((candidate) => candidate >= 1 && candidate <= totalPages)
    .sort((a, b) => a - b)

  const result: (number | 'gap')[] = []
  visible.forEach((value, index) => {
    if (index > 0 && value - (visible[index - 1] ?? value) > 1) {
      result.push('gap')
    }
    result.push(value)
  })
  return result
}

export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) {
    return null
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="pagination__btn"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        ‹
      </button>

      {pageWindow(page, totalPages).map((entry, index) =>
        entry === 'gap' ? (
          <span key={`gap-${index}`} className="pagination__ellipsis" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            className={`pagination__btn${entry === page ? ' is-active' : ''}`}
            onClick={() => onChange(entry)}
            aria-current={entry === page ? 'page' : undefined}
            aria-label={`Page ${entry}`}
          >
            {entry}
          </button>
        ),
      )}

      <button
        type="button"
        className="pagination__btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        ›
      </button>
    </nav>
  )
}
