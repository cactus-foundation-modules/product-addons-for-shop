'use client'

// "Learn more" without leaving the page: the add-on's chrome-free description
// view (shop's /shop/products/<slug>/details - gallery, descriptions,
// specification, no purchase UI) inside a modal iframe. A real page through
// the real pipeline, so designed descriptions render exactly as they do on the
// add-on's own page; this component supplies only the dialog around it.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function LearnMoreModal({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

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
        <iframe className="padlm-frame" src={`/shop/products/${encodeURIComponent(slug)}/details`} title={`About ${name}`} loading="eager" />
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
.padlm-frame{width:100%;height:100%;border:none;background:var(--color-surface)}
.padlm-foot{display:flex;justify-content:center;padding:0.75rem 1rem;border-top:1px solid var(--color-border)}
.padlm-done{background:var(--color-primary);color:var(--color-on-primary);border:none;border-radius:8px;padding:0.625rem 2.5rem;font:inherit;font-weight:600;cursor:pointer}
@media (max-width:640px){.padlm-wrap{padding:0}.padlm-panel{width:100%;height:100%;border-radius:0}}
`
