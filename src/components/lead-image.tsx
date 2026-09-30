'use client'

import { filePageUrl, imageSrc, type ImageRef } from '@/lib/links'
import { useEffect, useRef, useState } from 'react'

/**
 * The lead image, floated right where an infobox's image would be, and linked
 * to its file page on Wikipedia, which credits the author and license. It
 * shimmers until the image loads (`data-loading`). On small screens it fills
 * a fixed frame, so the text below never moves when it arrives.
 */
export function LeadImage({ image, title }: { image: ImageRef; title: string }) {
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLImageElement>(null)

  // An image that loaded before hydration fired its load event before React listened for it.
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true)
  }, [])

  return (
    <figure className="wiki-lead-image" data-loading={loaded ? undefined : ''}>
      <a href={filePageUrl(image)} target="_blank" rel="noreferrer" title="Image credit and license on Wikipedia">
        <img ref={ref} src={imageSrc(image)} alt={title} decoding="async" fetchPriority="high" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
      </a>
    </figure>
  )
}
