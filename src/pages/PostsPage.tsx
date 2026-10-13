import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pagination } from '../components/Pagination'
import { PostCard } from '../components/PostCard'
import { SearchIcon } from '../components/Icons'
import { site } from '../config/site'
import { listCategories, queryPosts } from '../lib/posts'
import { pluralise } from '../lib/text'

type SortKey = 'newest' | 'oldest' | 'title'

const isSortKey = (value: string): value is SortKey =>
  value === 'newest' || value === 'oldest' || value === 'title'

export function PostsPage() {
  const [params, setParams] = useSearchParams()
  const categories = useMemo(() => listCategories(), [])

  const search = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const sortParam = params.get('sort') ?? 'newest'
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'newest'
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const [draft, setDraft] = useState(search)
  useEffect(() => {
    setDraft(search)
  }, [search])

  const results = useMemo(
    () => queryPosts({ search, category, sort }),
    [search, category, sort],
  )

  const totalPages = Math.max(1, Math.ceil(results.length / site.postsPerPage))
  const currentPage = Math.min(page, totalPages)
  const visible = results.slice(
    (currentPage - 1) * site.postsPerPage,
    currentPage * site.postsPerPage,
  )

  const patch = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === '') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    })
    if (changes.page === undefined) {
      next.delete('page')
    }
    setParams(next, { replace: true })
  }

  return (
    <section className="section">
      <div className="container">
        <div className="section__head">
          <div>
            <h1 style={{ fontSize: 'var(--step-3)', marginBottom: 'var(--space-2)' }}>
              All articles
            </h1>
            <p className="section__sub">
              {pluralise(results.length, 'article')} on advanced .NET Core, searchable and filterable.
            </p>
          </div>
        </div>

        <form
          className="toolbar"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            patch({ q: draft.trim() })
          }}
        >
          <div className="toolbar__search">
            <SearchIcon />
            <label className="sr-only" htmlFor="posts-search">
              Search articles
            </label>
            <input
              id="posts-search"
              type="search"
              value={draft}
              placeholder="Search by title, summary, tag or full text…"
              onChange={(event) => setDraft(event.target.value)}
            />
            {draft.length > 0 && (
              <button
                type="button"
                className="toolbar__clear"
                aria-label="Clear search"
                onClick={() => {
                  setDraft('')
                  patch({ q: undefined })
                }}
              >
                ×
              </button>
            )}
          </div>

          <label className="sr-only" htmlFor="posts-sort">
            Sort articles
          </label>
          <select
            id="posts-sort"
            className="toolbar__select"
            value={sort}
            onChange={(event) => patch({ sort: event.target.value })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </form>

        <div className="chips" style={{ marginBottom: 'var(--space-5)' }}>
          <button
            type="button"
            className={`chip${category === '' ? ' is-active' : ''}`}
            onClick={() => patch({ category: undefined })}
          >
            All topics
            <span className="chip__count">{results.length}</span>
          </button>
          {categories.map((entry) => (
            <button
              key={entry.name}
              type="button"
              className={`chip${category === entry.name ? ' is-active' : ''}`}
              onClick={() => patch({ category: entry.name })}
            >
              {entry.name}
              <span className="chip__count">{entry.count}</span>
            </button>
          ))}
        </div>

        <div className="results-line">
          <span>
            Showing {visible.length} of {results.length}
            {category !== '' ? ` in ${category}` : ''}
            {search !== '' ? ` for “${search}”` : ''}
          </span>
          <span>
            Page {currentPage} of {totalPages}
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">
            <h3>No articles matched</h3>
            <p>
              Try a broader search term, or clear the filters to see all {results.length > 0 ?
                'available' :
                'published'}{' '}
              articles.
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid grid--3">
            {visible.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        )}

        <Pagination
          page={currentPage}
          totalPages={totalPages}
          onChange={(nextPage) => patch({ page: nextPage === 1 ? undefined : String(nextPage) })}
        />
      </div>
    </section>
  )
}
