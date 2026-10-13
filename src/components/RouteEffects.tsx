import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

declare global {
  interface Window {
    __prerenderReady?: boolean
  }
}

/** Resets scroll on navigation and flags route transitions for tooling. */
export function RouteEffects() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    window.__prerenderReady = true
  }, [pathname, search])

  return null
}
