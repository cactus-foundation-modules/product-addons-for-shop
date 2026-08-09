'use client'

// The showcase: one card per add-on - picture, name, blurb, from-price - with
// "Learn more" (the chrome-free description modal) and "Add", which scrolls
// back to the purchase area and ticks that add-on open in the box (see
// lib/accessory-focus.ts). Rendered by the automatic tab in shop's strip AND
// by the hand-placed block; one component so the two can never drift.
import { useEffect, useState } from 'react'
import { focusAddon } from '@/modules/product-addons-for-shop/lib/accessory-focus'
import { LearnMoreModal } from '@/modules/product-addons-for-shop/components/public/LearnMoreModal'
import {
  AddonImageModal,
  dedupeGalleryImages,
  type PadGalleryImage,
} from '@/modules/product-addons-for-shop/components/public/AddonImageModal'
import {
  ADDON_IMAGES_EVENT,
  getAddonImages,
  type AddonImagesDetail,
} from '@/modules/product-addons-for-shop/lib/addon-images'

export type ShowcaseCard = {
  linkId: string
  name: string
  slug: string
  shortDescription: string | null
  imageUrl: string | null
  // The listing's whole set of pictures, for the modal the card's picture opens.
  // Nothing is chosen out here - the showcase is a shop window, not the picker -
  // so there are no combination pictures to put first, unlike the box's own
  // gallery. Optional because this payload crosses to the browser as JSON and
  // sits in caches that predate the field; one serialised before this shipped
  // simply has an unclickable picture, as it always did.
  images?: Array<{ url: string; alt: string }>
  fromPriceFormatted: string
}

export type ShowcasePayload = {
  nounPlural: string
  cards: ShowcaseCard[]
}

export function AddonsShowcase({ payload, preview }: { payload: ShowcasePayload; preview?: boolean }) {
  const [learnMore, setLearnMore] = useState<ShowcaseCard | null>(null)
  const [gallery, setGallery] = useState<{ name: string; images: PadGalleryImage[] } | null>(null)
  // What the add-ons box has settled each add-on on, if there is a box on this
  // page. Snapshot on mount (the box may well have published before this tab
  // was ever opened), event afterwards. Nothing heard = the server's listing
  // pictures stand, which is what a page without the box block gets.
  const [live, setLive] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (preview) return
    const initial = getAddonImages()
    // Deferred a tick so this effect sets no state synchronously, matching how
    // the box reads shop-variations' own selection snapshot.
    if (initial) queueMicrotask(() => setLive(initial.images))
    const onImages = (e: Event) => setLive((e as CustomEvent<AddonImagesDetail>).detail.images)
    window.addEventListener(ADDON_IMAGES_EVENT, onImages)
    return () => window.removeEventListener(ADDON_IMAGES_EVENT, onImages)
  }, [preview])

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
        {payload.cards.map((card) => {
          // The variation the box has settled this add-on on, when there is a
          // box on the page saying so; the listing's own pictures otherwise.
          // Same ordering rule the box's own gallery uses - the variation's
          // photographs first, the listing's behind them, deduplicated - so
          // the two surfaces show one another's pictures in one another's
          // order rather than each telling its own story.
          const variationImages = live[card.linkId] ?? []
          const shownUrl = variationImages[0] ?? card.imageUrl
          const galleryImages = dedupeGalleryImages([
            ...variationImages.map((url) => ({ url, alt: `${card.name} - the variation shown`, group: 'variant' as const })),
            ...(card.images ?? []).map((image) => ({ url: image.url, alt: image.alt || card.name, group: 'product' as const })),
          ])
          return (
          <li key={card.linkId} className="pads-card">
            {shownUrl && galleryImages.length > 0 ? (
              <button
                type="button" className="pads-imgbtn" disabled={preview} aria-label={`See pictures of ${card.name}`}
                onClick={() => setGallery({ name: card.name, images: galleryImages })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- product media is an absolute storage URL */}
                <img className="pads-img" src={shownUrl} alt="" loading="lazy" />
              </button>
            ) : shownUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- product media is an absolute storage URL
              <img className="pads-img" src={shownUrl} alt="" loading="lazy" />
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
          )
        })}
      </ul>
      {learnMore && <LearnMoreModal slug={learnMore.slug} name={learnMore.name} onClose={() => setLearnMore(null)} />}
      {gallery && <AddonImageModal name={gallery.name} images={gallery.images} onClose={() => setGallery(null)} />}
    </div>
  )
}

const CSS = `
.pads-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem}
.pads-card{border:1px solid var(--color-border);border-radius:12px;overflow:hidden;background:var(--color-surface);display:grid;grid-template-rows:auto 1fr}
/* Square, like every other product picture on the shop - a card with its own
   ratio reads as a different sort of thing sitting in the same page. */
.pads-img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
.pads-img-empty{background:var(--color-bg-subtle)}
/* The card's picture opens the add-on's pictures rather than doing nothing at
   all, so it is a control and says so. */
.pads-imgbtn{display:block;width:100%;padding:0;border:none;background:none;cursor:zoom-in;line-height:0}
.pads-imgbtn:disabled{cursor:default}
.pads-imgbtn:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}
.pads-body{padding:0.75rem;display:grid;gap:0.375rem;align-content:start}
.pads-name{margin:0;font-weight:600}
.pads-blurb{margin:0;font-size:0.8125rem;color:var(--color-text-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pads-price{margin:0;font-size:0.875rem;color:var(--color-text-muted)}
.pads-actions{display:flex;gap:0.5rem;margin-top:0.25rem}
.pads-learn{background:none;border:1px solid var(--color-border);color:var(--color-text);border-radius:8px;padding:0.375rem 0.75rem;font-size:0.8125rem;cursor:pointer}
.pads-add{background:var(--color-primary);color:var(--color-on-primary);border:none;border-radius:8px;padding:0.375rem 1rem;font-size:0.8125rem;font-weight:600;cursor:pointer}
`
