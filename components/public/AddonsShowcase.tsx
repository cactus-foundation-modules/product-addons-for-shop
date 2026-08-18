'use client'

// The showcase: one card per add-on - picture, name, blurb, from-price - with
// "Learn more" (the chrome-free description modal) and "Add", which scrolls
// back to the purchase area and ticks that add-on open in the box (see
// lib/accessory-focus.ts). Rendered by the automatic tab in shop's strip AND
// by the hand-placed block; one component so the two can never drift.
import { useEffect, useMemo, useState } from 'react'
// breakpoints-shared touches no database, so a client component may import it
// without dragging prisma into the page builder's bundle.
import { DEFAULT_BREAKPOINTS, type Breakpoints } from '@/modules/shop/lib/breakpoints-shared'
import { focusAddon } from '@/modules/product-addons-for-shop/lib/accessory-focus'
import { isAddonApplicable } from '@/modules/product-addons-for-shop/lib/mapping'
import type { PadShowWhenRule } from '@/modules/product-addons-for-shop/lib/types'
import {
  VARIANT_SELECTION_EVENT,
  getVariantSelection,
  type VariantSelectionDetail,
} from '@/modules/shop-variations/lib/selection-broadcast'
import type { SvrOptionWithValues } from '@/modules/shop-variations/lib/types'
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
  // Nothing of this add-on left to sell. A shopper is never handed a card in
  // this state - the server drops it - so a true here means staff are looking,
  // and the card says so plainly rather than tempting anyone with it. Optional
  // for the same reason `images` is: a payload serialised before this shipped
  // simply has no badge, as it always did.
  outOfStock?: boolean
  fromPriceFormatted: string
  // The conditions on the MAIN product that have to hold before this accessory
  // is applicable at all - the same rules the purchase box gates on, so a
  // shopper is never shown a card here for something the box below refuses to
  // offer. Optional because this payload crosses to the browser as JSON: one
  // serialised before this shipped simply has no conditions, as it always did.
  showWhen?: PadShowWhenRule[]
}

export type ShowcasePayload = {
  nounPlural: string
  cards: ShowcaseCard[]
  // The site's own Styles > Spacing & Breakpoints widths, so the cards collapse
  // where the rest of the shop's grids collapse rather than at a pixel this
  // module made up. Media queries cannot read a CSS custom property, so the
  // resolved width has to be baked into the <style> at render time - the same
  // reason shop's own card grid takes them as an argument. Optional for the
  // same reason `images` is: a payload serialised before this shipped falls
  // back to the defaults, which are the values a site gets until it changes
  // them anyway.
  breakpoints?: Breakpoints
  // The main product's own options, so a card's conditions can be tested here
  // against the shopper's live choices. Optional for the same reason as the
  // rest: without it no card carries conditions worth testing either.
  mainOptions?: SvrOptionWithValues[]
}

export function AddonsShowcase({ payload, preview }: { payload: ShowcasePayload; preview?: boolean }) {
  const [learnMore, setLearnMore] = useState<ShowcaseCard | null>(null)
  const [gallery, setGallery] = useState<{ name: string; images: PadGalleryImage[] } | null>(null)
  // What the add-ons box has settled each add-on on, if there is a box on this
  // page. Snapshot on mount (the box may well have published before this tab
  // was ever opened), event afterwards. Nothing heard = the server's listing
  // pictures stand, which is what a page without the box block gets.
  const [live, setLive] = useState<Record<string, string[]>>({})
  // The main product's live choices, for the cards that only apply to some of
  // them. Same snapshot-then-event read the box uses, so both surfaces answer
  // to one broadcast rather than each guessing.
  const [mainSelection, setMainSelection] = useState<VariantSelectionDetail | null>(null)
  const css = useMemo(() => showcaseCss(payload.breakpoints ?? DEFAULT_BREAKPOINTS), [payload.breakpoints])

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

  // Only worth listening at all where some card actually carries conditions;
  // a showcase of unconditional accessories does no work for this.
  const gated = (payload.cards ?? []).some((card) => (card.showWhen ?? []).length > 0)
  useEffect(() => {
    if (preview || !gated) return
    const initial = getVariantSelection()
    if (initial) queueMicrotask(() => setMainSelection((current) => current ?? initial))
    const onChange = (e: Event) => setMainSelection((e as CustomEvent<VariantSelectionDetail>).detail)
    window.addEventListener(VARIANT_SELECTION_EVENT, onChange)
    return () => window.removeEventListener(VARIANT_SELECTION_EVENT, onChange)
  }, [preview, gated])

  // The broadcast as option id -> value id, exactly as the box builds it: each
  // chosen value id belongs to one option, so order does not come into it.
  const mainSelectionMap = useMemo(() => {
    const map: Record<string, string> = {}
    const options = payload.mainOptions ?? []
    if (!mainSelection || options.length === 0) return map
    const valueToOption = new Map<string, string>()
    for (const option of options) {
      for (const value of option.values) valueToOption.set(value.id, option.id)
    }
    for (const valueId of mainSelection.chosenValueIds) {
      const optionId = valueToOption.get(valueId)
      if (optionId) map[optionId] = valueId
    }
    return map
  }, [mainSelection, payload.mainOptions])

  // A card the shopper has ruled out is not shown here either: the tab is the
  // same offer as the box, and its Add button lands in a box that would refuse
  // it. The page builder's preview shows the lot - an editor needs to
  // see what they are arranging, conditions and all.
  const cards = useMemo(
    () => (preview
      ? payload.cards
      : payload.cards.filter((card) => isAddonApplicable(card.showWhen, payload.mainOptions ?? [], mainSelectionMap))),
    [preview, payload.cards, payload.mainOptions, mainSelectionMap],
  )

  function onAdd(card: ShowcaseCard) {
    if (preview) return
    focusAddon(card.linkId)
    // The same landing the tab strip's own "Configure" action uses: the
    // purchase area's anchor. The box scrolls itself when it hears the focus
    // event too, so whichever exists wins; this is the fallback with the box
    // further down a long page.
    document.getElementById('spd-buy')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (cards.length === 0) return null

  return (
    <div className="pads-wrap">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {/* A single accessory stretched across a desktop-width grid reads as a
          layout that has gone wrong rather than as one card, so on anything
          wider than a phone it takes a card's width and sits in the middle. A
          phone has room for one card and nothing else, so it is left alone. */}
      <ul className={`pads-grid${cards.length === 1 ? ' pads-one' : ''}`}>
        {cards.map((card) => {
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
              {/* The whole of the card's writing opens the description, not just
                  the button under it - a shopper who wants to know more about an
                  accessory reaches for its name, which until now did nothing at
                  all. One button around the three lines rather than three of
                  them, so the tab order gains one stop and not three, and it is
                  named for the job rather than read out as the whole card. The
                  staff note and the action row stay outside it: a button cannot
                  hold another button, and the note is not a description.
                  Everything inside is a span, since a button may only carry
                  phrasing content - a <p> in here is invalid markup. */}
              <button
                type="button" className="pads-text" disabled={preview}
                aria-label={`Learn more about ${card.name}`} onClick={() => setLearnMore(card)}
              >
                <span className="pads-name">
                  {card.name}
                  {card.outOfStock && <span className="pads-oos">Out of stock</span>}
                </span>
                {card.shortDescription && <span className="pads-blurb">{card.shortDescription}</span>}
                <span className="pads-price">{card.fromPriceFormatted}</span>
              </button>
              {card.outOfStock && <p className="pads-staff">Shoppers cannot see this one while it is out of stock.</p>}
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

function showcaseCss({ mobileBp }: Breakpoints): string {
  return `
.pads-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem}
/* One accessory stretched the full width of a desktop reads as a layout that has
   gone wrong rather than as one card, so it takes a card's width and sits in the
   middle. Overridden on a phone below, where a card at half width would be a
   stamp. */
.pads-one{grid-template-columns:minmax(230px,340px);justify-content:center}
/* Lift-and-shadow on hover, matching shop's own category cards (.shop-card in
   card-parts.tsx) exactly - same offset, same shadow - so a card here reads as
   the same sort of thing as everywhere else in the shop. The picture inside
   zooms very slightly along with it, that part's own rule below. */
.pads-card{border:1px solid var(--color-border);border-radius:12px;overflow:hidden;background:var(--color-surface);display:grid;grid-template-rows:auto 1fr;box-shadow:0 1px 3px rgba(0,0,0,.06);transition:box-shadow .25s ease,transform .25s ease}
.pads-card:hover{transform:translateY(-4px);box-shadow:0 8px 30px rgba(0,0,0,.10)}
/* Square, like every other product picture on the shop - a card with its own
   ratio reads as a different sort of thing sitting in the same page. */
.pads-img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;transition:transform .4s ease}
.pads-card:hover .pads-img{transform:scale(1.03)}
.pads-img-empty{background:var(--color-bg-subtle)}
/* The card's picture opens the add-on's pictures rather than doing nothing at
   all, so it is a control and says so. */
.pads-imgbtn{display:block;width:100%;padding:0;border:none;background:none;cursor:zoom-in;line-height:0}
/* Same blanket theme rule as .pads-text below: harmless behind an opaque
   photograph, and the site's button fill glowing through a cut-out product
   picture the moment the pointer crosses it otherwise. */
.pads-imgbtn:hover,.pads-imgbtn:focus,.pads-imgbtn:active{background:none !important}
.pads-imgbtn:disabled{cursor:default}
.pads-imgbtn:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}
.pads-body{padding:0.75rem;display:grid;gap:0.375rem;align-content:start}
/* A button that has to look like nothing: the card's writing reads exactly as it
   did, with only the whole card's lift (above) and the focus ring saying it is a
   control - not a background of its own.

   The :hover rule is the load-bearing one and it needs its !important. The site's
   own Styles > Buttons settings emit a BLANKET rule - main button:hover, with a
   background of its own and an !important on it (see core's lib/design/tokens.ts)
   - which cannot tell a call to action from an element that is only a button so
   a keyboard can reach it. Without this the theme's button fill landed across
   the card's name, blurb and price on hover. Nothing short of !important beats
   it, the theme's own declaration carrying one. Shop fights the identical rule
   in detail-parts.tsx for its quantity stepper.

   appearance:none is ordinary hygiene for a button dressed as text, not part of
   that fix. */
.pads-text{appearance:none;-webkit-appearance:none;display:grid;gap:0.375rem;width:100%;margin:0;padding:0;border:none;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:6px}
.pads-text:hover,.pads-text:focus,.pads-text:active{background:none !important}
.pads-text:disabled{cursor:default}
.pads-text:focus-visible{outline:2px solid var(--color-primary);outline-offset:3px}
.pads-name{margin:0;font-weight:600}
.pads-oos{margin-left:0.5rem;font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:var(--color-danger);border:1px solid var(--color-danger);border-radius:999px;padding:0.05rem 0.4rem;vertical-align:middle;white-space:nowrap}
.pads-staff{margin:0;font-size:0.75rem;color:var(--color-text-muted)}
.pads-blurb{margin:0;font-size:0.8125rem;color:var(--color-text-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* Bold and in the brand colour, matching shop's own category cards
   (.shop-card-price) rather than reading as a muted afterthought under the
   name - the price is the reason a shopper is looking at this card at all. */
.pads-price{margin:0;font-size:0.875rem;font-weight:600;color:var(--color-primary)}
.pads-actions{display:flex;gap:0.5rem;margin-top:0.25rem}
.pads-learn{background:none;border:1px solid var(--color-border);color:var(--color-text);border-radius:8px;padding:0.375rem 0.75rem;font-size:0.8125rem;cursor:pointer}
.pads-add{background:var(--color-primary);color:var(--color-on-primary);border:none;border-radius:8px;padding:0.375rem 1rem;font-size:0.8125rem;font-weight:600;cursor:pointer}
/* Phones keep two accessories across, exactly as the shop's own category grids
   do rather than dropping to one - a single tile per row turns a short list of
   accessories into a long scroll and hides the rest below the fold. The tiles
   are half as wide, so the wording steps down with them and the gutter closes up
   to buy the pictures the room. The two buttons stack: side by side they want
   more width than half a phone has, and a wrapped button row is worse than a
   stacked one. A lone card goes back to the full width - centring one card in a
   column that is already one card wide achieves nothing, and half of a phone is
   not a card, it is a stamp. */
@media (max-width:${mobileBp}){
.pads-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.pads-one{grid-template-columns:1fr}
.pads-body{padding:0.625rem;gap:0.25rem}
.pads-name{font-size:0.875rem}
.pads-blurb{font-size:0.75rem;-webkit-line-clamp:2}
.pads-price{font-size:0.8125rem}
.pads-actions{flex-direction:column;gap:0.375rem}
.pads-learn,.pads-add{width:100%;padding-left:0.5rem;padding-right:0.5rem;text-align:center}
}
`
}
