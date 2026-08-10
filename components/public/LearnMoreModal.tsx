'use client'

// "Learn more" without leaving the page: the add-on's chrome-free description
// view (shop's /shop/products/<slug>/details - gallery, descriptions,
// specification, no purchase UI) inside a modal iframe. A real page through
// the real pipeline, so designed descriptions render exactly as they do on the
// add-on's own page; this component supplies only the dialog around it.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function LearnMoreModal({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // The frame is a whole page through the whole pipeline - gallery, designed
  // description, specification - so on a cold route it can be a few seconds
  // arriving. Until it says it has, the panel would otherwise be a blank white
  // rectangle with a title on it, which reads as broken rather than as busy.
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="padlm-wrap" role="dialog" aria-modal="true" aria-label={`About ${name}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="padlm-overlay" onClick={onClose} aria-hidden="true" />
      <div className="padlm-panel">
        <div className="padlm-head">
          <h2 className="padlm-title">{name}</h2>
          <button ref={closeRef} type="button" className="padlm-close" aria-label="Close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="padlm-body">
          {!loaded && (
            // Announced as well as shown: a shopper on a screen reader gets the
            // same "it is coming" the sighted one does. The frame keeps its own
            // title, so the spinner is not the panel's accessible name.
            <div className="padlm-loading" role="status">
              <span className="padlm-spinner" aria-hidden="true" />
              <span className="padlm-loadingtext">Fetching the details…</span>
            </div>
          )}
          {/* Hidden rather than unmounted while it loads: it has to be in the
              document to do the loading, and fading it in stops a half-painted
              page showing through the spinner. */}
          <iframe
            className={`padlm-frame${loaded ? ' padlm-ready' : ''}`}
            src={`/shop/products/${encodeURIComponent(slug)}/details`}
            title={`About ${name}`} loading="eager" onLoad={() => setLoaded(true)}
          />
        </div>
        <div className="padlm-foot">
          <button type="button" className="padlm-done" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const CSS = `
.padlm-wrap{position:fixed;inset:0;z-index:960;display:grid;place-items:center;padding:1rem}
.padlm-overlay{position:absolute;inset:0;background:color-mix(in srgb, var(--color-text) 45%, transparent)}
.padlm-panel{position:relative;background:var(--color-surface);color:var(--color-text);border-radius:14px;width:min(920px,100%);height:min(84vh,900px);display:grid;grid-template-rows:auto 1fr auto;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.35)}
.padlm-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.75rem 1rem;border-bottom:1px solid var(--color-border)}
.padlm-title{margin:0;font-size:1.0625rem}
.padlm-close{background:none;border:none;color:var(--color-text-muted);cursor:pointer;padding:0.25rem;display:grid;place-items:center}
.padlm-body{position:relative;min-height:0;background:var(--color-surface)}
.padlm-frame{width:100%;height:100%;border:none;background:var(--color-surface);opacity:0;transition:opacity 0.2s ease}
.padlm-ready{opacity:1}
.padlm-loading{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:0.75rem;background:var(--color-surface)}
/* Ring rather than a spinning dot: the gap in the border is what reads as
   movement, so a single element does the whole job. Colours are tokens, so it
   sits in any palette light or dark. */
.padlm-spinner{width:34px;height:34px;border-radius:50%;border:3px solid var(--color-border);border-top-color:var(--color-primary);animation:padlm-spin 0.8s linear infinite}
.padlm-loadingtext{font-size:0.875rem;color:var(--color-text-secondary)}
@keyframes padlm-spin{to{transform:rotate(360deg)}}
/* A shopper who has asked for less movement still gets an answer, just a still
   one - the wording carries it on its own. */
@media (prefers-reduced-motion:reduce){.padlm-spinner{animation:none}.padlm-frame{transition:none}}
.padlm-foot{display:flex;justify-content:center;padding:0.75rem 1rem;border-top:1px solid var(--color-border)}
.padlm-done{background:var(--color-primary);color:var(--color-on-primary);border:none;border-radius:8px;padding:0.625rem 2.5rem;font:inherit;font-weight:600;cursor:pointer}
@media (max-width:640px){.padlm-wrap{padding:0}.padlm-panel{width:100%;height:100%;border-radius:0}}
`
