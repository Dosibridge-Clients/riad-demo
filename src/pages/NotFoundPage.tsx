import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="section">
      <div className="container">
        <div className="empty-state">
          <h1 style={{ fontSize: 'var(--step-3)' }}>404</h1>
          <h3>That page does not exist</h3>
          <p>The link may be out of date, or the article was renamed.</p>
          <div className="hero__actions" style={{ justifyContent: 'center' }}>
            <Link className="btn btn--primary" to="/">
              Back home
            </Link>
            <Link className="btn btn--ghost" to="/posts">
              Browse articles
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
