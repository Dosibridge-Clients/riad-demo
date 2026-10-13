import { Link } from 'react-router-dom'
import { PostCard } from '../components/PostCard'
import { ArrowRightIcon, BookIcon, FolderIcon, SparkIcon } from '../components/Icons'
import { site } from '../config/site'
import { featuredPost, listCategories, listPosts, totalWords } from '../lib/posts'
import { pluralise } from '../lib/text'

export function HomePage() {
  const posts = listPosts()
  const featured = featuredPost()
  const categories = listCategories()
  const latest = posts.slice(1, 7)
  const words = totalWords()
  const averageMinutes = Math.round(
    posts.reduce((sum, post) => sum + post.readingMinutes, 0) / Math.max(1, posts.length),
  )

  return (
    <>
      <section className="hero">
        <div className="container hero__grid">
          <div>
            <span className="eyebrow">
              <SparkIcon size={13} />
              {posts.length} deep-dive articles
            </span>
            <h1>
              Advanced <em>.NET Core</em> engineering, explained properly.
            </h1>
            <p className="hero__lead">
              Middleware internals, EF Core performance, async pitfalls, memory management, messaging
              patterns and cloud deployment — written for engineers who already ship .NET and want to
              understand what happens underneath.
            </p>
            <div className="hero__actions">
              <Link className="btn btn--primary" to="/posts">
                Browse all articles <ArrowRightIcon />
              </Link>
              <Link className="btn btn--ghost" to="/about">
                About this blog
              </Link>
            </div>
            <div className="hero__stats">
              <div>
                <span className="stat__value">{posts.length}</span>
                <span className="stat__label">Articles</span>
              </div>
              <div>
                <span className="stat__value">{words.toLocaleString('en-US')}</span>
                <span className="stat__label">Words published</span>
              </div>
              <div>
                <span className="stat__value">{categories.length}</span>
                <span className="stat__label">Categories</span>
              </div>
              <div>
                <span className="stat__value">{averageMinutes} min</span>
                <span className="stat__label">Average read</span>
              </div>
            </div>
          </div>

          <div>
            <PostCard post={featured} variant="featured" />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section__head">
            <div>
              <h2 className="section__title">Latest articles</h2>
              <p className="section__sub">
                Fresh write-ups across the whole stack, newest first.
              </p>
            </div>
            <Link className="btn btn--ghost" to="/posts">
              View all <ArrowRightIcon />
            </Link>
          </div>

          <div className="grid grid--3">
            {latest.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ background: 'var(--bg-soft)' }}>
        <div className="container">
          <div className="section__head">
            <div>
              <h2 className="section__title">Browse by category</h2>
              <p className="section__sub">
                {pluralise(categories.length, 'topic area')} of the .NET platform, each with full
                articles.
              </p>
            </div>
          </div>

          <div className="grid grid--cats">
            {categories.map((category) => (
              <Link
                key={category.name}
                to={`/posts?category=${encodeURIComponent(category.name)}`}
                className="card card--compact"
              >
                <div className="card__meta">
                  <FolderIcon />
                  <span>{pluralise(category.count, 'article')}</span>
                </div>
                <h3 className="card__title" style={{ fontSize: 'var(--step-0)' }}>
                  {category.name}
                </h3>
                <span
                  className="article__meta-item"
                  style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.8rem' }}
                >
                  Read the series <ArrowRightIcon size={14} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta">
            <span className="eyebrow">
              <BookIcon size={13} />
              Start here
            </span>
            <h2>Read the series in order, or jump to what is breaking in production.</h2>
            <p>
              Every article stands alone, but the categories build on each other: start with
              architecture and EF Core, then move into performance, concurrency and distributed
              messaging.
            </p>
            <div className="hero__actions" style={{ justifyContent: 'center' }}>
              <Link className="btn btn--primary" to="/posts?category=Architecture">
                Start with architecture <ArrowRightIcon />
              </Link>
              <Link className="btn btn--ghost" to={`/posts/${featured.slug}`}>
                Read the featured article
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section__head">
            <div>
              <h2 className="section__title">About {site.name}</h2>
              <p className="section__sub">{site.author.role} · {site.author.name}</p>
            </div>
            <Link className="btn btn--ghost" to="/about">
              More about the blog
            </Link>
          </div>
          <div className="grid grid--2">
            <div className="card">
              <h3 className="card__title">What you will find here</h3>
              <p className="card__excerpt">
                No hello-world tutorials. Each article takes a real decision a .NET team has to make
                — connection pooling, query splitting, caching strategy, cancellation, outbox
                delivery — and shows the failure mode, the fix and the trade-off.
              </p>
            </div>
            <div className="card">
              <h3 className="card__title">How the content is built</h3>
              <p className="card__excerpt">
                Articles are plain Markdown files compiled into a static React site. No database, no
                CMS, no runtime API: content changes ship as a commit and a build.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
