'use client'

import { createContext, use, useEffect, useState } from 'react'

/**
 * Wikipedia's Appearance menu (text size, width, color) plus whether the
 * Contents and Appearance panels are pinned to the sidebars. Stored per browser
 * in localStorage and mirrored onto <html> as data attributes, which is what the
 * CSS reads, so the server render and the first paint never disagree on layout.
 */
export type Prefs = {
  text: 'small' | 'standard' | 'large'
  width: 'standard' | 'wide'
  theme: 'auto' | 'light' | 'dark'
  toc: 'pinned' | 'hidden'
  appearance: 'pinned' | 'hidden'
}

export const DEFAULT_PREFS: Prefs = { text: 'standard', width: 'standard', theme: 'light', toc: 'pinned', appearance: 'pinned' }

const STORAGE_KEY = 'wiki-prefs'

/**
 * Runs in <head> before the body paints: applies stored prefs to <html> and
 * resolves the `auto` theme against the OS setting. Kept tiny and dependency
 * free because it is inlined into every page.
 */
export const PREFS_SCRIPT = `(function(){try{var d=document.documentElement,p=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'{}'),t=p.theme||'light';['text','width','theme','toc','appearance'].forEach(function(k){if(p[k])d.dataset[k]=p[k]});if(t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches))d.classList.add('dark')}catch(e){}})()`

function readPrefs(): Prefs {
  const data = document.documentElement.dataset
  return {
    text: (data.text as Prefs['text']) ?? DEFAULT_PREFS.text,
    width: (data.width as Prefs['width']) ?? DEFAULT_PREFS.width,
    theme: (data.theme as Prefs['theme']) ?? DEFAULT_PREFS.theme,
    toc: (data.toc as Prefs['toc']) ?? DEFAULT_PREFS.toc,
    appearance: (data.appearance as Prefs['appearance']) ?? DEFAULT_PREFS.appearance,
  }
}

function applyTheme(theme: Prefs['theme']) {
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

type PrefsContextValue = { prefs: Prefs; setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void }

const PrefsContext = createContext<PrefsContextValue>({ prefs: DEFAULT_PREFS, setPref: () => {} })

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)

  // Adopt what the head script applied, and follow the OS while on `auto`.
  useEffect(() => {
    const initial = readPrefs()
    setPrefs(initial)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => document.documentElement.dataset.theme === 'auto' && applyTheme('auto')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const next = { ...readPrefs(), [key]: value }
    document.documentElement.dataset[key] = value
    if (key === 'theme') applyTheme(value as Prefs['theme'])
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Private mode or blocked storage: the choice still applies to this page view.
    }
    setPrefs(next)
  }

  return <PrefsContext value={{ prefs, setPref }}>{children}</PrefsContext>
}

export function usePrefs() {
  return use(PrefsContext)
}
