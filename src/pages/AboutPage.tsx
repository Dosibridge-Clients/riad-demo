import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { site } from '../config/site'
import { listCategories, listPosts, totalWords } from '../lib/posts'
import { initialsOf, pluralise } from '../lib/text'

export function AboutPage() {
  const posts = listPosts()
  const categories = listCategories()
  const words = totalWords()

  useEffect(() => {
    document.title = `About · ${site.name}`
    return () => {
      document.title = `${site.name} — Advanced .NET Core Engineering Blog`
    }
  }, [])

  return (
    <section className="section">
      <div className="container">
        <div className="section__head">
          <div>
            <span className="eyebrow">About the blog</span>
            <h1 style={{ fontSize: 'var(--step-3)' }}>{site.title}</h1>
            <p className="section__sub">{site.tagline}</p>
          </div>
        </div>

        <div className="container--narrow" style={{ paddingInline: 0 }}>
          <div className="prose">
            <p>{site.description}</p>
            <p>
              This site is a static publication: {posts.length} articles, {words.toLocaleString('en-US')}{' '}
              words, {pluralise(categories.length, 'category', 'categories')} — all authored in Markdown
              and compiled into a React application. There is no CMS and no runtime backend, which
              means content changes are reviewed like code and the published site is exactly what the
              repository contains.
            </p>
            <h2>Who writes here</h2>
            <p>
              Articles are written for developers who already have a working .NET service in
              production and need to reason about why a particular approach fails at scale. Each
              piece takes one decision, shows the mechanism behind it in the framework source or
              documentation, and then states the trade-off plainly.
            </p>
            <h2>How the content is organised</h2>
            <p>
              Articles are grouped into {categories.length} categories that map to the layers of a real
              system — from architecture and EF Core data access, through performance and concurrency,
              to security, messaging, testing and deployment. Every article is standalone, so you can
              arrive from a search engine and leave with something usable.
            </p>
            <h2>Editorial rules</h2>
            <ul>
              <li>Every article is at least 300 words of substantive prose, most are considerably longer.</li>
              <li>Code samples target .NET 8 and later, C# 12 and later, and current ASP.NET Core APIs.</li>
              <li>Claims about behaviour are attached to a named type, method or configuration switch.</li>
              <li>Trade-offs are stated explicitly — no article ends with “it depends”.</li>
              <li>
                Duplicate coverage is avoided: a topic already answered elsewhere on the site is linked,
                not repeated.
              </li>
            </ul>
            <h2>Technology</h2>
            <p>
              The frontend is React 18 with TypeScript, bundled by Vite, routed with React Router, and
              styled with a small hand-written CSS design system (no UI framework, no CSS-in-JS).
              Markdown is compiled at build time; syntax highlighting is applied in the browser with
              highlight.js. The site ships as static files and can be served from any web host or CDN.
            </p>
          </div>
        </div>

        <div className="grid grid--2" style={{ marginTop: 'var(--space-7)' }}>
          <div className="card">
            <div className="author-block" style={{ marginBottom: 'var(--space-4)' }}>
              <span className="avatar" style={{ width: 48, height: 48, fontSize: '1rem' }} aria-hidden="true">
                {initialsOf(site.author.name)}
              </span>
              <span>
                <span className="author-block__name" style={{ fontSize: '1.05rem' }}>
                  {site.author.name}
                </span>
                <span className="author-block__role">{site.author.role}</span>
              </span>
            </div>
            <p className="card__excerpt">
              Writing about the parts of .NET that only hurt once a system is under load: pooling,
              cancellation, query shape, cache coherence, message delivery and deployment safety.
            </p>
            <div className="chips">
              {site.social.map((item) => (
                <a key={item.label} className="chip" href={item.href} target="_blank" rel="noreferrer noopener">
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="card__title">Stats</h3>
            <ul className="side-list">
              <li>
                <span className="author-block__name">Articles</span>
                <span className="side-list__meta">{posts.length}</span>
              </li>
              <li>
                <span className="author-block__name">Total words</span>
                <span className="side-list__meta">{words.toLocaleString('en-US')}</span>
              </li>
              <li>
                <span className="author-block__name">Categories</span>
                <span className="side-list__meta">{categories.length}</span>
              </li>
              <li>
                <span className="author-block__name">Newest article</span>
                <span className="side-list__meta">{posts[0]?.title ?? '—'}</span>
              </li>
            </ul>
            <Link className="btn btn--primary" to="/posts" style={{ marginTop: 'var(--space-5)' }}>
              Browse the library
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
