'use client'

import { useState } from 'react'

/**
 * Defers a popover or menu until it is wanted, so its library code is neither
 * downloaded nor hydrated with the page: pointing at or focusing its button
 * starts loading the code, and the first click mounts it open. Until then the
 * button is plain HTML.
 */
export function useLazyOpen(preload: () => Promise<unknown>) {
  const [opened, setOpened] = useState(false)
  const warm = () => void preload()
  return [opened, { onPointerEnter: warm, onFocus: warm, onClick: () => setOpened(true) }] as const
}
