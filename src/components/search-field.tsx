'use client'

import type { SearchBox } from '@/components/search-box'
import { SearchForm } from '@/components/search-form'
import { useEffect, useRef, useState } from 'react'

type Props = { autoFocus?: boolean; onDone?: () => void; className?: string }

const loadSearchBox = () => import('@/components/search-box').then((m) => m.SearchBox)

/**
 * The header search box as plain HTML, which becomes the full combobox
 * (`SearchBox`) the first time it is pointed at or focused, keeping what was
 * typed and the focus. Until then the page loads and hydrates none of the
 * search code, and Enter still submits the form.
 */
export function SearchField({ autoFocus = false, onDone, className }: Props) {
  const [box, setBox] = useState<{ Box: typeof SearchBox; query: string; focused: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const loading = useRef(false)

  function load() {
    if (loading.current) return
    loading.current = true
    loadSearchBox().then((Box) => {
      const input = inputRef.current
      setBox({ Box, query: input?.value ?? '', focused: input != null && document.activeElement === input })
    })
  }

  // Opened from the header's search icon: the user is about to type.
  useEffect(() => {
    if (autoFocus) load()
  }, [autoFocus])

  if (box) return <box.Box autoFocus={autoFocus || box.focused} initialQuery={box.query} onDone={onDone} className={className} />
  return (
    <div className={className} onPointerEnter={load}>
      <SearchForm input={{ ref: inputRef, autoFocus, onFocus: load }} />
    </div>
  )
}
