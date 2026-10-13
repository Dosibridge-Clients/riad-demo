import { Link } from 'react-router-dom'
import { site } from '../config/site'
import { listCategories } from '../lib/posts'
import { GithubIcon, LinkedinIcon, RssIcon } from './Icons'

const iconFor = (label: string) => {
  if (label === 'GitHub') return <GithubIcon />
  if (label === 'LinkedIn') return <LinkedinIcon />
  return <RssIcon />
}

export function SiteFooter() {
  const categories = listCategories().slice(0, 6)
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__about">
            <Link to="/" className="brand" style={{ marginBottom: 'var(--space-4)' }}>
              <span className="brand__mark" aria-hidden="true">
                {site.author.initials}
              </span>
              <span className="brand__text">
                <span className="brand__name">{site.name}</span>
                <span className="brand__tag">{site.title}</span>
              </span>
            </Link>
            <p>{site.description}</p>
            <div className="chips" style={{ marginTop: 'var(--space-4)' }}>
              {site.social.map((item) => (
                <a
                  key={item.label}
                  className="chip"
                  href={item.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {iconFor(item.label)}
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <div className="footer__title">Browse</div>
            <ul className="footer__list">
              {site.nav.map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
              <li>
                <Link to="/posts?sort=oldest">Oldest first</Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="footer__title">Categories</div>
            <ul className="footer__list">
              {categories.map((category) => (
                <li key={category.name}>
                  <Link to={`/posts?category=${encodeURIComponent(category.name)}`}>
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="footer__title">About this site</div>
            <ul className="footer__list">
              <li>React 18 + Vite + TypeScript</li>
              <li>Markdown content, no database</li>
              <li>60 articles on advanced .NET Core</li>
              <li>Dark and light themes</li>
            </ul>
          </div>
        </div>

        <div className="footer__bottom">
          <span>
            © {year} {site.name}. All rights reserved.
          </span>
          <span>Built for engineers who read the source.</span>
        </div>
      </div>
    </footer>
  )
}
