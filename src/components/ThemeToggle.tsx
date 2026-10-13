import { useCallback, useEffect, useState } from 'react'
import { MoonIcon, SunIcon } from './Icons'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'riad-demo-theme'

function readStoredTheme(): Theme {
  if (typeof document === 'undefined') {
    return 'dark'
  }
  const fromDom = document.documentElement.dataset.theme
  if (fromDom === 'light' || fromDom === 'dark') {
    return fromDom
  }
  return 'dark'
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Private mode / storage disabled: the in-memory theme still applies.
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggle }
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const nextLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={nextLabel} title={nextLabel}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
