import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { RouteEffects } from './components/RouteEffects'
import { SiteFooter } from './components/SiteFooter'
import { SiteHeader } from './components/SiteHeader'
import { HomePage } from './pages/HomePage'
import { PostsPage } from './pages/PostsPage'

/** The article page carries the markdown compiler and highlighter, so it loads on demand. */
const PostPage = lazy(() => import('./pages/PostPage').then((module) => ({ default: module.PostPage })))
const AboutPage = lazy(() =>
  import('./pages/AboutPage').then((module) => ({ default: module.AboutPage })),
)
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
)

function Pending() {
  return (
    <div className="container section" aria-busy="true">
      <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 220, width: '100%' }} />
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <RouteEffects />
        <Suspense fallback={<Pending />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/posts" element={<PostsPage />} />
            <Route path="/posts/:slug" element={<PostPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <SiteFooter />
    </BrowserRouter>
  )
}
