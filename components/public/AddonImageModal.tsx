'use client'

// A proper look at an add-on's pictures without leaving the product page: the
// picture the shopper clicked, big, with every other picture of that add-on as
// a thumbnail strip beneath it.
//
// Ordering is the whole point of the thing. Once a combination has been settled
// - the shopper has picked the screen's fabric, say - that combination's own
// photographs come first, and the listing's general pictures follow after them.
// The caller decides which is which by tagging each image `variant` or
// `product`; this component only draws what it is handed, in the order it is
// handed it.
//
// Deliberately NOT the "Learn more" modal: that one frames the add-on's whole
// description page in an iframe. This is pictures alone, opened from the
// picture itself, which is what a shopper clicking a thumbnail is asking for.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type PadGalleryImage = {
  url: string
  alt: string
  // 'variant' - a photograph of the chosen combination; 'product' - one of the
  // listing's own. Only used to caption and to rule the strip between the two
  // groups, and only when both are present.
  group: 'variant' | 'product'
}

// Same picture filed under both the chosen combination and the listing appears
// once, in the earlier position - which, with variation pictures passed first,
// is the combination's.
export function dedupeGalleryImages(images: PadGalleryImage[]): PadGalleryImage[] {
  const seen = new Set<string>()
  const out: PadGalleryImage[] = []
  for (const image of images) {
    if (!image.url || seen.has(image.url)) continue
    seen.add(image.url)
    out.push(image)
  }
  return out
}

export function AddonImageModal({
  name,
  images,
  startIndex = 0,
  onClose,
}: {
  name: string
  images: PadGalleryImage[]
  startIndex?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(images.length - 1, 0)))
  const closeRef = useRef<HTMLButtonElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const mixed = useMemo(
    () => images.some((i) => i.group === 'variant') && images.some((i) => i.group === 'product'),
    [images],
  )

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); setIndex((i) => (i + 1) % images.length) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex((i) => (i - 1 + images.length) % images.length) }
    }
    document.addEventListener('keydown', onKey, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose, images.length])

  // Walking the pictures with the arrow keys must walk the strip too, or the
  // highlighted thumbnail sits off the end of a row nobody has scrolled.
  useEffect(() => {
    const strip = stripRef.current
    const active = strip?.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])

  const current = images[Math.min(Math.max(index, 0), images.length - 1)]
  if (typeof document === 'undefined' || !current) return null

  // "The variation shown" rather than "your chosen combination": the caller may
  // be picturing the nearest variation to a half-settled choice, which is not
  // one the shopper has finished making.
  const caption = mixed
    ? current.group === 'variant' ? 'The variation shown' : name
    : null

  return createPortal(
    <div className="padgal-wrap" role="dialog" aria-modal="true" aria-label={`Pictures of ${name}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="padgal-overlay" onClick={onClose} aria-hidden="true" />
      <div className="padgal-panel">
        <div className="padgal-head">
          <h2 className="padgal-title">{name}</h2>
          {images.length > 1 && (
            <span className="padgal-count">{index + 1} / {images.length}</span>
          )}
          <button ref={closeRef} type="button" className="padgal-close" aria-label="Close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="padgal-stage">
          {/* eslint-disable-next-line @next/next/no-img-element -- product media is an absolute storage URL, not a configured next/image loader */}
          <img className="padgal-img" src={current.url} alt={current.alt} />
          {images.length > 1 && (
            <>
              <button
                type="button" className="padgal-nav padgal-prev" aria-label="Previous picture"
                onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
              >
                &lsaquo;
              </button>
              <button
                type="button" className="padgal-nav padgal-next" aria-label="Next picture"
                onClick={() => setIndex((i) => (i + 1) % images.length)}
              >
                &rsaquo;
              </button>
            </>
          )}
        </div>
        {caption && <p className="padgal-caption">{caption}</p>}
        {images.length > 1 && (
          <div ref={stripRef} className="padgal-thumbs" role="tablist" aria-label={`Pictures of ${name}`}>
            {images.map((image, i) => (
              <span key={`${image.url}-${i}`} className="padgal-thumbcell">
                {/* The hairline where the chosen combination's pictures end and
                    the listing's own begin, so the strip reads as two groups
                    rather than one long unexplained run. */}
                {mixed && i > 0 && images[i - 1]?.group === 'variant' && image.group === 'product' && (
                  <span className="padgal-sep" aria-hidden="true" />
                )}
                <button
                  type="button" role="tab" aria-selected={i === index} data-active={i === index}
                  aria-label={`Picture ${i + 1} of ${images.length}`}
                  className={`padgal-thumb${i === index ? ' padgal-on' : ''}`}
                  onClick={() => setIndex(i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
                  <img src={image.url} alt="" loading="lazy" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// Colours are theme tokens throughout - the modal must sit in any palette, light
// or dark.
const CSS = `
.padgal-wrap{position:fixed;inset:0;z-index:960;display:grid;place-items:center;padding:1rem}
.padgal-overlay{position:absolute;inset:0;background:color-mix(in srgb, var(--color-text) 45%, transparent)}
.padgal-panel{position:relative;background:var(--color-surface);color:var(--color-text);border-radius:14px;width:min(960px,100%);height:min(88vh,960px);display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;overflow:hidden;box-shadow:var(--shadow-lg)}
.padgal-head{display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;border-bottom:1px solid var(--color-border)}
.padgal-title{margin:0;font-size:1.0625rem;flex:1;min-width:0;overflow-wrap:anywhere}
.padgal-count{font-size:0.8125rem;color:var(--color-text-muted);flex-shrink:0}
.padgal-close{background:none;border:none;color:var(--color-text-muted);cursor:pointer;padding:0.25rem;display:grid;place-items:center}
.padgal-stage{position:relative;min-height:0;background:var(--color-bg-subtle);display:grid;place-items:center;padding:0.75rem}
.padgal-img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.padgal-nav{position:absolute;top:50%;transform:translateY(-50%);width:2.25rem;height:2.25rem;border-radius:50%;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:1.5rem;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0 0 0.15rem}
.padgal-prev{left:0.5rem}
.padgal-next{right:0.5rem}
.padgal-caption{margin:0;padding:0.5rem 1rem 0;font-size:0.8125rem;color:var(--color-text-muted);text-align:center}
.padgal-thumbs{display:flex;gap:0.5rem;align-items:center;overflow-x:auto;padding:0.75rem 1rem;border-top:1px solid var(--color-border)}
.padgal-thumbcell{display:flex;align-items:center;gap:0.5rem;flex-shrink:0}
.padgal-sep{width:1px;height:44px;background:var(--color-border);display:block}
.padgal-thumb{width:64px;height:64px;border-radius:8px;border:2px solid var(--color-border);background:var(--color-surface);padding:0;overflow:hidden;cursor:pointer;flex-shrink:0}
.padgal-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.padgal-thumb.padgal-on{border-color:var(--color-primary)}
@media (max-width:640px){.padgal-wrap{padding:0}.padgal-panel{width:100%;height:100%;border-radius:0}}
`
