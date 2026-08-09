'use client'

// The showcase: one card per add-on - picture, name, blurb, from-price - with
// "Learn more" (the chrome-free description modal) and "Add", which scrolls
// back to the purchase area and ticks that add-on open in the box (see
// lib/accessory-focus.ts). Rendered by the automatic tab in shop's strip AND
// by the hand-placed block; one component so the two can never drift.
import { useState } from 'react'
import { focusAddon } from '@/modules/product-addons-for-shop/lib/accessory-focus'
import { LearnMoreModal } from '@/modules/product-addons-for-shop/components/public/LearnMoreModal'

export type ShowcaseCard = {
  linkId: string
  name: string
  slug: string
  shortDescription: string | null
  imageUrl: string | null
  fromPriceFormatted: string
}

export type ShowcasePayload = {
  nounPlural: string
  cards: ShowcaseCard[]
}

export function AddonsShowcase({ payload, preview }: { payload: ShowcasePayload; preview?: boolean }) {
  const [learnMore, setLearnMore] = useState<ShowcaseCard | null>(null)

  function onAdd(card: ShowcaseCard) {
    if (preview) return
    focusAddon(card.linkId)
    // The same landing the tab strip's own "Configure" action uses: the
    // purchase area's anchor. The box scrolls itself when it hears the focus
    // event too, so whichever exists wins; this is the fallback with the box
    // further down a long page.
    document.getElementById('spd-buy')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (payload.cards.length === 0) return null

  return (
    <div className="pads-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <ul className="pads-grid">
        {payload.cards.map((card) => (
          <li key={card.linkId} className="pads-card">
            {card.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- product media is an absolute storage URL
              <img className="pads-img" src={card.imageUrl} alt="" loading="lazy" />
            ) : (
              <div className="pads-img pads-img-empty" aria-hidden="true" />
            )}
            <div className="pads-body">
              <p className="pads-name">{card.name}</p>
              {card.shortDescription && <p className="pads-blurb">{card.shortDescription}</p>}
              <p className="pads-price">{card.fromPriceFormatted}</p>
              <div className="pads-actions">
                <button type="button" className="pads-learn" disabled={preview} onClick={() => setLearnMore(card)}>
                  Learn more
                </button>
                <button type="button" className="pads-add" disabled={preview} onClick={() => onAdd(card)}>
                  Add
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {learnMore && <LearnMoreModal slug={learnMore.slug} name={learnMore.name} onClose={() => setLearnMore(null)} />}
    </div>
  )
}

const CSS = `
.pads-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem}
.pads-card{border:1px solid var(--color-border);border-radius:12px;overflow:hidden;background:var(--color-surface);display:grid;grid-template-rows:auto 1fr}
.pads-img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
.pads-img-empty{background:var(--color-bg-subtle)}
.pads-body{padding:0.75rem;display:grid;gap:0.375rem;align-content:start}
.pads-name{margin:0;font-weight:600}
.pads-blurb{margin:0;font-size:0.8125rem;color:var(--color-text-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pads-price{margin:0;font-size:0.875rem;color:var(--color-text-muted)}
.pads-actions{display:flex;gap:0.5rem;margin-top:0.25rem}
.pads-learn{background:none;border:1px solid var(--color-border);color:var(--color-text);border-radius:8px;padding:0.375rem 0.75rem;font-size:0.8125rem;cursor:pointer}
.pads-add{background:var(--color-primary);color:var(--color-on-primary);border:none;border-radius:8px;padding:0.375rem 1rem;font-size:0.8125rem;font-weight:600;cursor:pointer}
`
