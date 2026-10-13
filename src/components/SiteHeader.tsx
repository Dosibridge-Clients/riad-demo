import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { site } from '../config/site'
import { CloseIcon, MenuIcon, SearchIcon } from './Icons'
import { ThemeToggle } from './ThemeToggle'

export function SiteHeader() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [navigate])

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = term.trim()
    navigate(query.length > 0 ? `/posts?q=${encodeURIComponent(query)}` : '/posts')
    setMenuOpen(false)
  }

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand" aria-label={`${site.name} — home`}>
          <span className="brand__mark" aria-hidden="true">
            {site.author.initials}
          </span>
          <span className="brand__text">
            <span className="brand__name">{site.name}</span>
            <span className="brand__tag">{site.tagline}</span>
          </span>
        </Link>

        <nav className={`nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">
          {site.nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <form className="header__search" role="search" onSubmit={submit}>
          <SearchIcon />
          <label className="sr-only" htmlFor="site-search">
            Search articles
          </label>
          <input
            id="site-search"
            type="search"
            value={term}
            placeholder="Search articles…"
            onChange={(event) => setTerm(event.target.value)}
          />
        </form>

        <ThemeToggle />

        <button
          type="button"
          className="icon-btn header__toggle"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>
    </header>
  )
}
