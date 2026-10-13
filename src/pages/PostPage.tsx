import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PostCard } from '../components/PostCard'
import { ReadingProgress } from '../components/ReadingProgress'
import { CalendarIcon, ClockIcon, FolderIcon } from '../components/Icons'
import { site } from '../config/site'
import { getPost, neighbours, relatedPosts } from '../lib/posts'
import { renderMarkdown } from '../lib/markdown'
import { formatDate, initialsOf, pluralise } from '../lib/text'

export function PostPage() {
  const { slug = '' } = useParams()
  const post = getPost(slug)
  const articleRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const rendered = useMemo(() => (post === undefined ? null : renderMarkdown(post.body)), [post])
  const related = useMemo(() => (post === undefined ? [] : relatedPosts(post, 3)), [post])
  const { previous, next } = useMemo(() => neighbours(slug), [slug])

  useEffect(() => {
    if (post !== undefined) {
      document.title = `${post.title} · ${site.name}`
    }
    return () => {
      document.title = `${site.name} — Advanced .NET Core Engineering Blog`
    }
  }, [post])

  /** One delegated listener covers every code block rendered by the markdown pipeline. */
  useEffect(() => {
    const root = articleRef.current
    if (root === null) {
      return
    }

    const onClick = async (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const button = target.closest('[data-copy-code]')
      if (!(button instanceof HTMLElement)) {
        return
      }
      const code = button.closest('.code-block')?.querySelector('code')
      const text = code?.textContent ?? ''
      try {
        await navigator.clipboard.writeText(text)
        button.textContent = 'Copied'
        setCopied(text.slice(0, 24))
        window.setTimeout(() => {
          button.textContent = 'Copy'
        }, 1800)
      } catch {
        button.textContent = 'Press ⌘C'
      }
    }

    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [rendered])

  if (post === undefined || rendered === null) {
    return (
      <section className="section">
        <div className="container">
          <div className="empty-state">
            <h3>Article not found</h3>
            <p>The article “{slug}” does not exist or may have been renamed.</p>
            <Link className="btn btn--primary" to="/posts">
              Back to all articles
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const shareUrl = typeof window === 'undefined' ? '' : window.location.href
  const shareText = encodeURIComponent(`${post.title} — ${site.name}`)
  const encodedUrl = encodeURIComponent(shareUrl)

  return (
    <>
      <ReadingProgress />
      <div className="container article-layout">
        <article>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span aria-hidden="true">/</span>
            <Link to="/posts">Articles</Link>
            <span aria-hidden="true">/</span>
            <Link to={`/posts?category=${encodeURIComponent(post.category)}`}>{post.category}</Link>
          </nav>

          <h1 className="article__title">{post.title}</h1>
          <p className="article__lead">{post.excerpt}</p>

          <div className="article__meta">
            <span className="author-block">
              <span className="avatar" aria-hidden="true">
                {initialsOf(post.author)}
              </span>
              <span>
                <span className="author-block__name">{post.author}</span>
                <span className="author-block__role">{site.author.role}</span>
              </span>
            </span>
            <span className="article__meta-item">
              <CalendarIcon />
              <time dateTime={post.date}>{formatDate(post.date)}</time>
            </span>
            <span className="article__meta-item">
              <ClockIcon />
              {post.readingMinutes} min read
            </span>
            <span className="article__meta-item">
              <FolderIcon />
              {post.category}
            </span>
            <span className="badge badge--level">{post.level}</span>
            <span className="article__meta-item">{pluralise(post.words, 'word')}</span>
            {copied !== null && <span className="sr-only">Copied code to clipboard</span>}
          </div>

          <div
            className="prose"
            ref={articleRef}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />

          <div className="tags-row">
            {post.tags.map((tag) => (
              <Link key={tag} className="tag" to={`/posts?q=${encodeURIComponent(tag)}`}>
                #{tag}
              </Link>
            ))}
          </div>

          <div className="share-row">
            <span className="share-row__label">Share</span>
            <a
              className="chip"
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              LinkedIn
            </a>
            <a
              className="chip"
              href={`https://x.com/intent/post?text=${shareText}&url=${encodedUrl}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              X / Twitter
            </a>
            <button
              type="button"
              className="chip"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl)
              }}
            >
              Copy link
            </button>
          </div>

          {(previous !== undefined || next !== undefined) && (
            <nav className="prevnext" aria-label="Article navigation">
              {previous !== undefined ? (
                <Link className="prevnext__item" to={`/posts/${previous.slug}`}>
                  <span className="prevnext__label">← Newer article</span>
                  <span className="prevnext__title">{previous.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next !== undefined ? (
                <Link className="prevnext__item prevnext__item--next" to={`/posts/${next.slug}`}>
                  <span className="prevnext__label">Older article →</span>
                  <span className="prevnext__title">{next.title}</span>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </article>

        <aside className="toc__side">
          {rendered.toc.length > 0 && (
            <nav className="toc" aria-label="On this page">
              <div className="toc__title">On this page</div>
              <ul className="toc__list">
                {rendered.toc.map((entry) => (
                  <li
                    key={entry.id}
                    className={`toc__item${entry.depth === 3 ? ' toc__item--3' : ''}`}
                  >
                    <a href={`#${entry.id}`}>{entry.text}</a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="side-card">
            <div className="side-card__title">Article facts</div>
            <ul className="side-list">
              <li>
                <span className="author-block__name">Category</span>
                <Link
                  className="side-list__meta"
                  to={`/posts?category=${encodeURIComponent(post.category)}`}
                >
                  {post.category}
                </Link>
              </li>
              <li>
                <span className="author-block__name">Reading time</span>
                <span className="side-list__meta">{post.readingMinutes} minutes</span>
              </li>
              <li>
                <span className="author-block__name">Length</span>
                <span className="side-list__meta">{pluralise(post.words, 'word')}</span>
              </li>
              <li>
                <span className="author-block__name">Level</span>
                <span className="side-list__meta">{post.level}</span>
              </li>
            </ul>
          </div>

          <div className="side-card">
            <div className="side-card__title">Related reading</div>
            <ul className="side-list">
              {related.map((entry) => (
                <li key={entry.slug}>
                  <Link to={`/posts/${entry.slug}`}>{entry.title}</Link>
                  <span className="side-list__meta">
                    {entry.category} · {entry.readingMinutes} min
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section__head">
            <div>
              <h2 className="section__title">Keep reading</h2>
              <p className="section__sub">Related articles from the same track.</p>
            </div>
            <Link className="btn btn--ghost" to="/posts">
              All articles
            </Link>
          </div>
          <div className="grid grid--3">
            {related.map((entry) => (
              <PostCard key={entry.slug} post={entry} variant="compact" />
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
