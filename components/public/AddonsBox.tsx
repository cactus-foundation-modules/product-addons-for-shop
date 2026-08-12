'use client'

// The add-ons box: the small panel under Add to basket where a shopper ticks
// the accessories they want with the product they are configuring.
//
// Each add-on row carries its OWN add-to-basket button (styled to match the
// main product's): an add-on goes in the basket when its button is pressed and
// never rides along on the main product's add. The two purchases stay related,
// not joined - a purchase-companion provider stamps the main line with the
// group only when related add-on lines are already in the basket, and adding
// an add-on retro-stamps a main line already there, so the basket still nests
// the set together whichever order the shopper buys in.
//
// Everything it knows about the main product's selection arrives on the
// variant-selection broadcast; everything the 3D viewer needs to show the
// right combined model leaves on the model-context broadcast. Both are
// documented window events - this component and the viewer never import each
// other.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  getVariantSelection,
  VARIANT_SELECTION_EVENT,
  type VariantSelectionDetail,
} from '@/modules/shop-variations/lib/selection-broadcast'
import { registerPurchaseCompanion } from '@/modules/shop-variations/lib/purchase-companions'
import { GALLERY_HOLD_ATTR } from '@/modules/shop-variations/lib/use-sticky-mobile-gallery'
import {
  resolveVariant,
  valueToOptionMap,
  variantAnswersTo,
  type OptionSelection,
} from '@/modules/shop-variations/lib/selection-logic'
import { addToCart, cartLineKey, getCart, setLineMeta } from '@/modules/shop/components/public/cart'
import type { SvrOptionValue, SvrOptionWithValues, VariantSelectorPayload, VariantSelectorVariant } from '@/modules/shop-variations/lib/types'
import {
  composeContextKey,
  deterministicGroupKey,
  findOptionByName,
  recommendationNote,
  recommendedQuantityPerUnit,
  resolveMappings,
} from '@/modules/product-addons-for-shop/lib/mapping'
import { isValueOutOfStock } from '@/modules/product-addons-for-shop/lib/stock'
import { publishModelContext } from '@/modules/product-addons-for-shop/lib/model-context'
import { publishAddonImages } from '@/modules/product-addons-for-shop/lib/addon-images'
import { ADDON_FOCUS_EVENT, type AddonFocusDetail } from '@/modules/product-addons-for-shop/lib/accessory-focus'
import { LearnMoreModal } from '@/modules/product-addons-for-shop/components/public/LearnMoreModal'
import {
  AddonImageModal,
  dedupeGalleryImages,
  type PadGalleryImage,
} from '@/modules/product-addons-for-shop/components/public/AddonImageModal'
import { PAD_META_KEY, type PadAddonPayload, type PadBoxPayload } from '@/modules/product-addons-for-shop/lib/types'

// Per-addon UI state, keyed by linkId (chain rows included - link ids are
// unique across the whole tree).
type AddonState = {
  enabled: boolean
  // The shopper's own picks for choose/default/recommend options: option id ->
  // value id.
  chosen: Record<string, string>
  // Which default/recommend-mode options the shopper has overridden (by option
  // id). An un-overridden default keeps following the main selection live; an
  // un-overridden recommend keeps the admin's pick.
  overridden: Record<string, boolean>
  // Quantity per one main unit; null = follow the recommendation (or 1 in free
  // mode until touched).
  qty: number | null
  // Flash state for this row's own add-to-basket button.
  added: boolean
}

type ResolvedAddon = {
  addon: PadAddonPayload
  state: AddonState
  // Option id -> value id for every option, however its value arrives. Null
  // when the combination is not yet complete or not available.
  selection: OptionSelection | null
  // The same map WITHOUT the completeness gate - everything settled so far,
  // however far that goes. What the stock question is asked against: a fabric's
  // availability depends on the width already matched off the desk, whether or
  // not the rest of the row has been filled in.
  settled: OptionSelection
  // The options whose value is not the shopper's to change (matched off the main
  // product, or pinned by the shop). They constrain every other option's stock
  // regardless of where they sit in display order - a locked value is settled by
  // definition, so it cannot be the "later pick" the directional rule protects
  // against.
  lockedOptionIds: string[]
  // Which options the shopper is shown (choose + default + recommend modes).
  // `followed` is the value this option would take on its own (the main
  // selection's translation for a default, the shop's pick for a recommend);
  // `overridden` says the shopper has moved off it - and goes false again the
  // moment they land back on it, so the provenance note returns and the
  // put-it-back button leaves.
  shown: Array<{
    option: SvrOptionWithValues
    mode: 'choose' | 'default' | 'recommend'
    valueId: string | null
    locked: string | null
    // The value behind a locked line, so a colour or picture option can show
    // the swatch it settled on rather than only naming it.
    lockedValue: SvrOptionValue | null
    followed: string | null
    overridden: boolean
  }>
  // Names of the main product's options this add-on follows that have not been
  // chosen yet. While any are outstanding the add-on's own choices are held
  // shut: picking a colour to go with a desk nobody has configured yet only
  // gets quietly overwritten later.
  blockedBy: string[]
  // Whether the mapping machinery could place every match-mode option (false =
  // unavailable for the current main configuration).
  available: boolean
  // Why not, when not (shopper wording).
  unavailableReason: string | null
  variant: ReturnType<typeof resolveVariant>
  // The pictures to show for this add-on right now, in gallery order. The
  // resolved variation's own once the combination is complete, and BEFORE that
  // the first variation agreeing with whatever is already settled - see
  // settledVariantImages. Empty means there is nothing better than the
  // listing's own picture.
  displayImages: string[]
  perUnitQty: number
  recommendedPerUnit: number | null
  note: string | null
}

const money = (symbol: string, n: number) => `${symbol}${n.toFixed(2)}`

// The fields a variation carries that an option-less add-on has no answer for.
// The server's `plain` block supplies the rest (id of the product being bought,
// its price, its stock, its picture), and the two together let one add path
// serve both kinds of add-on.
const PLAIN_VARIANT_SHELL: Omit<VariantSelectorVariant, 'childProductId' | 'price' | 'inStock' | 'imageUrls'> = {
  id: 'plain',
  optionValueIds: [],
  aliasValueIds: [],
  enabled: true,
  compareAtPrice: null,
  stockCount: null,
  sku: null,
  supplier: null,
}

// "Frame Colour", "Frame Colour and Size", "Frame Colour, Size and Depth" - a
// sentence a shopper reads, not a comma-separated list.
function listPhrase(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'options'
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// A swatch picture fetched in CORS mode, for the same reason the main product's
// swatches are: on a product with a 3D view the viewer paints this very picture
// onto the model, and WebGL only accepts a cross-origin image fetched WITH
// CORS. Asking for it the same way here makes the two one download. A host that
// answers without the header gets a plain retry rather than a broken picture -
// and the element is remounted rather than edited, because the attribute only
// counts if it is set before the load starts.
function PadSwatchImg({ src, className }: { src: string; className?: string }) {
  const [refused, setRefused] = useState<string | null>(null)
  const cors = refused !== src
  return (
    // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
    <img
      key={cors ? 'cors' : 'plain'}
      crossOrigin={cors ? 'anonymous' : undefined}
      src={src}
      onError={() => setRefused(src)}
      alt=""
      aria-hidden
      loading="lazy"
      className={className}
    />
  )
}

// The hover chip the main product's colour choices carry, in the box's own
// markup: a bordered card above the swatch with a proper look at the value (the
// full picture, or a block of colour big enough to judge) and its name beneath.
// The name also rides the button's `title` and `aria-label`, so it is never
// hover-only for a keyboard or screen reader shopper.
function PadPeek({ label, preview, children }: { label: string; preview: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="pad-peek" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <span role="tooltip" className="pad-chip">
          {preview}
          <span>{label}</span>
        </span>
      )}
    </span>
  )
}

// The variation whose pictures should stand in while the combination is still
// incomplete: the first enabled one that carries pictures and agrees with every
// value settled so far, however it was settled - the shopper's own pick, a
// value matched off the main product, or one the shop pinned.
//
// This matters most in the case it was written for: an add-on whose colour is
// locked to the desk's and whose fabric is still to choose. Nothing resolves to
// a variation yet, so the row used to fall back to the listing's own
// photograph - which is very often a different finish entirely, and a picture
// of the wrong colour beside a colour you cannot change is a small lie.
//
// Empty when nothing is settled yet, or when no variation agrees - the caller
// falls back to the listing picture, which is the honest answer then.
function settledVariantImages(selector: VariantSelectorPayload, selection: OptionSelection): string[] {
  const settled = Object.entries(selection)
  if (settled.length === 0) return []
  const valueToOption = valueToOptionMap(selector)
  const match = selector.variants.find((variant) =>
    variant.enabled
    && variant.imageUrls.length > 0
    // Aliases counted the same way the real selection maths counts them, so a
    // variation standing in for a value is not passed over here alone.
    && settled.every(([optionId, valueId]) => variantAnswersTo(variant, optionId, valueId, valueToOption)),
  )
  return match?.imageUrls ?? []
}

function fromPrice(selector: VariantSelectorPayload): number {
  if (selector.variants.length === 0) return selector.basePrice
  return selector.variants.reduce((min, v) => (v.enabled && v.price < min ? v.price : min), Infinity)
}

// ---- Model-context derivation (pure - shared by publish and collect) --------
// An add-on contributes its context key only while its quantity equals the
// recommendation (or, in free mode, always as key:qty - the viewer matches a
// quantity-tagged file or nothing). Extra value ids carry every add-on option
// value in play so the viewer can paint companion materials.
type ActiveAddon = ResolvedAddon & { depth: number }

/**
 * The context key one add-on contributes right now, or null for none.
 *
 * The key is the link's own plus any option suffixes it nominates (a pedestal's
 * width, say - see composeContextKey), so an accessory that comes in sizes can
 * change the combined model rather than being stuck with one of them.
 *
 * Recommended-mode with an overridden quantity contributes nothing - the
 * preview shows the standard arrangement or none, never a guess.
 */
function addonContextKey(r: ResolvedAddon): string | null {
  if (!r.state.enabled || !r.variant || !r.available || !r.addon.modelContextKey) return null
  const key = composeContextKey(
    r.addon.modelContextKey,
    r.addon.config.modelContextOptions,
    r.addon.selector.options,
    r.selection ?? {},
  )
  if (!key) return null
  if (r.addon.config.quantity.mode === 'free') return `${key}:${r.perUnitQty}`
  if (r.recommendedPerUnit == null || r.perUnitQty === r.recommendedPerUnit) return key
  return null
}

function activeContextKeys(list: ActiveAddon[]): string[] {
  const keys: string[] = []
  for (const r of list) {
    const key = addonContextKey(r)
    if (key) keys.push(key)
  }
  return keys
}

// `bundleOf` ties an add-on line to its group INSIDE the modelContext bag - the
// space planner's documented meta contract - so a saved plan can keep the set
// together without ever reading this module's own meta.
//
// `contextKey`/`valueIds` are this line's OWN contribution to the group's
// combined model, and they live on the add-on line rather than only on the
// main one deliberately: an add-on is bought by its own button, in any order,
// and the shopper can take one back out from the basket page long after this
// component has gone. The truth about which screens a desk was bought with is
// therefore the set of add-on lines actually sitting in the basket, and this is
// where each of them states its piece of it. The main line still carries the
// merged bag (see mainModelContext) so a consumer that reads only the main line
// gets an answer, but it is a summary, not the source.
//
// An add-on contributing a context is already inside the combined model, so it
// stages nothing of its own - otherwise the same screens both ride on the desk
// and lean against the wall as loose panels.
function lineModelContext(
  r: ResolvedAddon,
  group: string,
  qty: number,
): { stage: 'none' | 'self'; bundleOf: string; qtyPerMain: number; contextKey?: string; valueIds?: string[] } {
  const contextKey = addonContextKey(r)
  return {
    stage: contextKey ? 'none' : r.addon.plannerStandalone ? 'self' : 'none',
    bundleOf: group,
    qtyPerMain: qty,
    ...(contextKey ? { contextKey, valueIds: r.selection ? Object.values(r.selection) : [] } : {}),
  }
}

/**
 * The group's combined-model bag, read back off the basket.
 *
 * Derived from the add-on lines present RIGHT NOW rather than from this
 * component's tick state: the shopper may have bought one add-on before a page
 * reload and another after it, and only the basket knows about both.
 */
function mainModelContext(group: string): {
  contexts: string[]
  extraValueIds: string[]
  bundleKey: string
  contextsFrom: 'bundle'
} {
  const contexts: string[] = []
  const extraValueIds: string[] = []
  for (const line of getCart()) {
    const bag = line.meta?.modelContext
    if (!bag || typeof bag !== 'object') continue
    const read = bag as { bundleOf?: unknown; contextKey?: unknown; valueIds?: unknown }
    if (read.bundleOf !== group) continue
    if (typeof read.contextKey === 'string' && read.contextKey) contexts.push(read.contextKey)
    if (Array.isArray(read.valueIds)) extraValueIds.push(...read.valueIds.filter((v): v is string => typeof v === 'string'))
  }
  // `contextsFrom: 'bundle'` tells a reader these contexts were derived from the
  // group's own lines and can be re-derived the same way - which is what lets a
  // consumer notice that the shopper has since taken the screens back out of the
  // basket, where a bare stored list would go on claiming them forever.
  return { contexts, extraValueIds, bundleKey: group, contextsFrom: 'bundle' }
}

// Every picture worth showing for one add-on, in the order a shopper should
// meet them: the variation's own photographs first, then the listing's own
// behind them. "The variation" is whatever the row itself is picturing - the
// resolved combination, or the nearest one to what is settled so far - so the
// big view can never disagree with the thumbnail that opened it. An add-on
// that comes exactly one way has no combination to photograph, so its listing
// pictures stand alone. Duplicates collapse to their earliest position, which
// keeps a picture filed under both from appearing twice.
function galleryImages(r: ResolvedAddon): PadGalleryImage[] {
  return dedupeGalleryImages([
    // Wording that stays true whether the combination is fully settled or only
    // part way there - the pictures are of the variation being SHOWN, which is
    // not always one the shopper has finished choosing.
    ...r.displayImages.map((url) => ({ url, alt: `${r.addon.name} - the variation shown`, group: 'variant' as const })),
    ...r.addon.selector.baseImages.map((image) => ({ url: image.url, alt: image.alt || r.addon.name, group: 'product' as const })),
  ])
}

export function AddonsBox({ payload, preview }: { payload: PadBoxPayload; preview?: boolean }) {
  const [mainSelection, setMainSelection] = useState<VariantSelectionDetail | null>(null)
  const [states, setStates] = useState<Record<string, AddonState>>({})
  const [learnMore, setLearnMore] = useState<PadAddonPayload | null>(null)
  const [gallery, setGallery] = useState<{ name: string; images: PadGalleryImage[] } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // The main product's live selection, from the broadcast (snapshot on mount,
  // event afterwards). Preview renders inert with nothing chosen.
  useEffect(() => {
    if (preview) return
    // The snapshot read is deferred a tick so this effect sets no state
    // synchronously; the page's islands publish within the same frame anyway.
    const initial = getVariantSelection()
    if (initial) queueMicrotask(() => setMainSelection((current) => current ?? initial))
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<VariantSelectionDetail>).detail
      if (detail.parentProductId && detail.parentProductId !== payload.productId) return
      setMainSelection(detail)
    }
    window.addEventListener(VARIANT_SELECTION_EVENT, onChange)
    return () => window.removeEventListener(VARIANT_SELECTION_EVENT, onChange)
  }, [preview, payload.productId])

  // The showcase tab's Add button lands here: tick that add-on open and bring
  // the box into view, ready for its choices.
  useEffect(() => {
    if (preview) return
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<AddonFocusDetail>).detail
      if (!detail?.linkId) return
      setStates((prev) => ({
        ...prev,
        [detail.linkId]: { ...(prev[detail.linkId] ?? { enabled: false, chosen: {}, overridden: {}, qty: null, added: false }), enabled: true },
      }))
      boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener(ADDON_FOCUS_EVENT, onFocus)
    return () => window.removeEventListener(ADDON_FOCUS_EVENT, onFocus)
  }, [preview])

  // The main selection as option id -> value id, order-independent: each
  // chosen value id belongs to exactly one option.
  const mainSelectionMap: OptionSelection = useMemo(() => {
    const map: OptionSelection = {}
    if (!mainSelection) return map
    const valueToOption = new Map<string, string>()
    for (const option of payload.mainOptions) {
      for (const value of option.values) valueToOption.set(value.id, option.id)
    }
    for (const valueId of mainSelection.chosenValueIds) {
      const optionId = valueToOption.get(valueId)
      if (optionId) map[optionId] = valueId
    }
    return map
  }, [mainSelection, payload.mainOptions])

  const stateFor = (linkId: string): AddonState =>
    states[linkId] ?? { enabled: false, chosen: {}, overridden: {}, qty: null, added: false }

  // Resolve one add-on (and, on recursion, a chain child) against its parent's
  // options and selection.
  function resolveAddon(
    addon: PadAddonPayload,
    parentOptions: SvrOptionWithValues[],
    parentSelection: OptionSelection,
  ): ResolvedAddon {
    const state = stateFor(addon.linkId)
    const resolved = resolveMappings(addon.config.optionMappings, parentOptions, addon.selector.options, parentSelection)

    const selection: OptionSelection = {}
    const shown: ResolvedAddon['shown'] = []
    const blockedBy: string[] = []
    const lockedOptionIds: string[] = []
    let available = resolved !== null
    let unavailableReason: string | null = resolved === null ? 'Not available at the moment' : null

    if (resolved) {
      const mapped = new Map(resolved.map((r) => [r.addonOption.id, r]))
      // Every main option this add-on takes a lead from that is still unchosen.
      // Both following modes count: a match has nothing to lock to, and a
      // default has nothing to default TO - a pick made now would be silently
      // replaced the moment the main option is settled.
      for (const r of resolved) {
        if (r.mapping.mode !== 'match' && r.mapping.mode !== 'default') continue
        if (!r.mainOption || parentSelection[r.mainOption.id]) continue
        if (!blockedBy.includes(r.mainOption.name)) blockedBy.push(r.mainOption.name)
      }
      for (const option of addon.selector.options) {
        const r = mapped.get(option.id)
        const mode = r?.mapping.mode
        if (mode === 'match' || mode === 'fixed') {
          if (r?.value) {
            selection[option.id] = r.value.id
            lockedOptionIds.push(option.id)
          } else if (mode === 'fixed' || (r?.mainOption && parentSelection[r.mainOption.id])) {
            // A fixed value that no longer exists, or a chosen main value with
            // no translation: this add-on cannot be bought for this
            // configuration.
            available = false
            unavailableReason = `Not available for the chosen ${r?.mainOption?.name.toLowerCase() ?? 'configuration'}`
          }
          continue
        }
        if (mode === 'default' || mode === 'recommend') {
          // Followed value: the main selection's translation (default) or the
          // admin's pick (recommend). A recommend whose picked value has
          // vanished follows nothing and reads as a plain choice.
          const followed = r?.value?.id ?? null
          // Landing back on the followed value is not an override, however the
          // shopper got there: the option starts following again, so a main
          // change still carries it and the note reads plainly.
          const overridden = !!state.overridden[option.id] && (state.chosen[option.id] ?? null) !== followed
          const chosen = overridden ? state.chosen[option.id] ?? null : followed
          if (chosen) selection[option.id] = chosen
          shown.push({ option, mode, valueId: chosen, locked: null, lockedValue: null, followed, overridden })
          continue
        }
        // choose (explicit or unmapped): the shopper's pick.
        const chosen = state.chosen[option.id] ?? null
        if (chosen) selection[option.id] = chosen
        shown.push({ option, mode: 'choose', valueId: chosen, locked: null, lockedValue: null, followed: null, overridden: false })
      }
      // Options the shopper does not choose but should still SEE, listed after
      // resolution so a matched width reads "matches your desk". A fixed value
      // is stated plainly - it comes one way, and an add-on that quietly ships
      // in a colour nobody was told about is worse than one extra line.
      for (const r of resolved) {
        if (!r.value) continue
        if (r.mapping.mode === 'match') {
          shown.unshift({
            option: r.addonOption, mode: 'choose', valueId: null, followed: null, overridden: false,
            lockedValue: r.value,
            locked: `${r.value.label} - matches your ${r.mainOption?.name.toLowerCase() ?? 'choice'}`,
          })
        } else if (r.mapping.mode === 'fixed') {
          shown.unshift({
            option: r.addonOption, mode: 'choose', valueId: null, followed: null, overridden: false,
            lockedValue: r.value,
            locked: r.value.label,
          })
        }
      }
    }

    const complete = addon.selector.options.every((o) => selection[o.id])
    // An add-on with no options at all is bought as the listing itself: the
    // selection maths has nothing to resolve on such a product and correctly
    // returns nothing, which the box must not read as "unavailable".
    const variant = addon.plain
      ? { ...PLAIN_VARIANT_SHELL, ...addon.plain }
      : complete ? resolveVariant(addon.selector, selection) : null
    // An option-less add-on has no variations to picture - the listing's own
    // photograph IS the product. Otherwise the resolved variation's pictures,
    // and until there is one, the closest variation to what is settled so far.
    const displayImages = addon.plain
      ? []
      : variant?.imageUrls?.length ? variant.imageUrls : settledVariantImages(addon.selector, selection)
    const recommendedPerUnit = recommendedQuantityPerUnit(addon.config.quantity, parentOptions, parentSelection)
    const perUnitQty = state.qty ?? recommendedPerUnit ?? 1
    const note = recommendationNote(addon.config.quantity, addon.name, parentOptions, parentSelection)

    return {
      addon,
      state,
      selection: complete ? selection : null,
      settled: selection,
      lockedOptionIds,
      shown,
      blockedBy,
      available,
      unavailableReason: available ? null : unavailableReason,
      variant,
      displayImages,
      perUnitQty: Math.max(1, perUnitQty),
      recommendedPerUnit,
      note,
    }
  }

  const resolvedTop = useMemo(
    () => payload.addons.map((addon) => resolveAddon(addon, payload.mainOptions, mainSelectionMap)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveAddon reads only states/payload/mainSelectionMap, all listed
    [payload, states, mainSelectionMap],
  )

  // Chain children of ENABLED, complete parents, resolved against the parent's
  // own selection. Depth-first, so the collect below emits parents before
  // children and order follows the tree.
  const resolvedAll = useMemo(() => {
    const out: Array<ResolvedAddon & { depth: number; parent: ResolvedAddon | null }> = []
    const walk = (list: ResolvedAddon[], depth: number, parent: ResolvedAddon | null) => {
      for (const r of list) {
        out.push({ ...r, depth, parent })
        if (r.state.enabled && r.selection && r.addon.children.length > 0) {
          const children = r.addon.children.map((child) => resolveAddon(child, r.addon.selector.options, r.selection!))
          walk(children, depth + 1, r)
        }
      }
    }
    walk(resolvedTop, 1, null)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same inputs as resolvedTop
  }, [resolvedTop])

  // ---- Group stamping ------------------------------------------------------
  // An add-on line is added by its own button, never by the main add - but the
  // basket should still nest the set whichever order the shopper buys in. The
  // group key is deterministic from the main product being bought (the exact
  // variation once resolved, the listing itself for an option-less product), so
  // both sides mint the same key without talking to each other:
  //
  //   add-on first, main second - the companion provider below stamps the main
  //   line as the group's main at its add, because related add-on lines are
  //   already in the basket.
  //   main first, add-on second - addAddonToBasket retro-stamps the main line
  //   already in the basket.
  //   add-on alone - no main line ever appears; the cart resolver renders the
  //   line flat with its "Accessory for" field, which is already its orphan
  //   behaviour.
  useEffect(() => {
    if (preview) return
    const slug = mainSelection?.slug
    if (!slug) return
    return registerPurchaseCompanion(`product-addons:${payload.productId}`, {
      slug,
      collect: (ctx) => {
        const group = deterministicGroupKey(ctx.productId, [])
        const related = getCart().some((line) => {
          const pad = line.meta?.[PAD_META_KEY] as { group?: string; role?: string } | undefined
          return pad?.role === 'addon' && pad.group === group
        })
        // Nothing of this group in the basket: stay out of the add entirely, so
        // a product bought without accessories keeps its plain, mergeable line.
        //
        // The other buying order - accessories first, main product after - and
        // the combined-model bag has to be stamped here too, or a desk bought
        // last arrives in the space planner without the screens already sitting
        // in the basket waiting for it.
        return related
          ? { mainMeta: { [PAD_META_KEY]: { group, role: 'main' }, modelContext: mainModelContext(group) }, lines: [] }
          : null
      },
    })
  }, [preview, mainSelection?.slug, payload.productId])

  // The exact main product an add-on bought NOW would be for: the resolved
  // variation, or the listing itself while options are unsettled (matching what
  // the main add-to-basket would add for an option-less product; a half-chosen
  // configuration groups with nothing, and the add-on line renders flat).
  const mainTargetId = mainSelection?.productId ?? payload.productId

  function addAddonToBasket(r: ResolvedAddon & { depth: number; parent: ResolvedAddon | null }, index: number) {
    if (!r.variant) return
    const group = deterministicGroupKey(mainTargetId, [])
    const qty = r.perUnitQty
    const forLabel = r.parent ? r.parent.addon.name : payload.productName
    const forProductId = r.parent ? r.parent.variant?.childProductId ?? r.parent.addon.addonProductId : mainTargetId
    addToCart(r.variant.childProductId, qty, {
      // Stable id: re-adding the same add-on for the same main merges quantity
      // into the existing line instead of stacking a twin.
      lineId: `pad:${group}:${r.addon.linkId}:${r.variant.childProductId}`,
      meta: {
        [PAD_META_KEY]: {
          group,
          role: 'addon',
          linkId: r.addon.linkId,
          forProductId,
          forLabel,
          depth: r.depth,
          order: index,
          ...(r.recommendedPerUnit != null ? { recommendedPerUnit: r.recommendedPerUnit } : {}),
          ...(r.note ? { recommendedNote: r.note } : {}),
        },
        modelContext: lineModelContext(r, group, qty),
      },
    })
    // A main line already in the basket joins the group now, so the nesting
    // works in this buying order too, and its combined-model bag is refreshed
    // to match what the group now holds. The group's own main line is preferred
    // over an unstamped candidate: from the second add-on on, the main line is
    // already stamped, and the old lookup simply found nothing and left the
    // model context a version behind.
    //
    // One write, not two: setLineMeta gives a plain line a lineId on its first
    // meta, which changes the very key a second call would have to target.
    const cart = getCart()
    const stampedMain = cart.find((line) => {
      const bag = line.meta?.[PAD_META_KEY]
      if (!bag || typeof bag !== 'object') return false
      const read = bag as { group?: unknown; role?: unknown }
      return read.group === group && read.role === 'main'
    })
    const mainLine = stampedMain ?? cart.find((line) => line.productId === mainTargetId && !line.meta?.[PAD_META_KEY])
    if (mainLine) {
      setLineMeta(cartLineKey(mainLine), {
        ...(stampedMain ? {} : { [PAD_META_KEY]: { group, role: 'main' } }),
        modelContext: mainModelContext(group),
      })
    }
    setState(r.addon.linkId, { added: true })
    window.setTimeout(() => setState(r.addon.linkId, { added: false }), 2000)
  }

  // What each add-on is picturing, for the showcase to repeat. Published for
  // EVERY add-on, ticked or not - the showcase card is a shop window, and its
  // picture should show the right finish whether or not the shopper has taken
  // the thing up yet. Add-ons with nothing better than their listing picture
  // stay out of the bag entirely, so the showcase keeps the server's answer
  // rather than being told to show nothing.
  useEffect(() => {
    if (preview) return
    const images: Record<string, string[]> = {}
    for (const r of resolvedAll) {
      if (r.displayImages.length > 0) images[r.addon.linkId] = r.displayImages
    }
    publishAddonImages({ parentProductId: payload.productId, images })
  }, [preview, payload.productId, resolvedAll])

  useEffect(() => {
    if (preview || !mainSelection?.slug) return
    const active = resolvedAll.filter((r) => r.state.enabled && r.variant && r.available)
    publishModelContext({
      slug: mainSelection.slug,
      parentProductId: payload.productId,
      contextKeys: activeContextKeys(active),
      extraValueIds: active.flatMap((r) => (r.selection ? Object.values(r.selection) : [])),
    })
  }, [preview, mainSelection?.slug, payload.productId, resolvedAll])

  // ---- Rendering -----------------------------------------------------------
  const symbol = payload.currencySymbol
  const suffix = payload.priceSuffix ? ` ${payload.priceSuffix}` : ''

  function setState(linkId: string, patch: Partial<AddonState>) {
    setStates((prev) => ({ ...prev, [linkId]: { ...stateFor(linkId), ...patch } }))
  }

  function renderOptionPicker(r: ResolvedAddon, entry: ResolvedAddon['shown'][number], blocked: boolean) {
    const { option, mode, valueId } = entry
    if (entry.locked) {
      // A colour or picture option shows the swatch it settled on, with the same
      // hover look the pickable ones have. It is not a button - there is nothing
      // to pick - but a shopper should still be able to see the colour they are
      // about to buy rather than only read its name.
      const lockedSwatch = entry.lockedValue
        && (option.controlType === 'SWATCH' || option.controlType === 'IMAGE')
        ? entry.lockedValue.swatchSmall || entry.lockedValue.swatch
        : null
      const lockedIsImage = !!lockedSwatch && !lockedSwatch.startsWith('#')
      return (
        <div key={option.id} className="pad-locked">
          {lockedSwatch && (
            <PadPeek
              label={entry.lockedValue!.label}
              preview={lockedIsImage
                ? <PadSwatchImg src={lockedSwatch} className="pad-peekimg" />
                : <span aria-hidden className="pad-peekcolour" style={{ background: lockedSwatch }} />}
            >
              <span
                className="pad-swatch pad-swatch-static"
                style={lockedIsImage ? undefined : { background: lockedSwatch }}
              >
                {lockedIsImage && <PadSwatchImg src={lockedSwatch} />}
              </span>
            </PadPeek>
          )}
          <span className="pad-optname">{option.name}:</span> {entry.locked}
        </div>
      )
    }
    const isSwatch = option.controlType === 'SWATCH' || option.controlType === 'IMAGE'
    // What this option's stock question is asked against: every locked value
    // (matched, pinned - not the shopper's to change) plus the picks made ABOVE
    // it in the add-on's own display order. Picks below are left out so a later
    // choice can never grey out an earlier row and strand the shopper - the same
    // directional rule the main product's picker follows.
    const optionIndex = new Map(r.addon.selector.options.map((o, i) => [o.id, i]))
    const targetIndex = optionIndex.get(option.id) ?? 0
    const constraints: OptionSelection = {}
    for (const [optionId, valueId] of Object.entries(r.settled)) {
      if (optionId === option.id) continue
      if (r.lockedOptionIds.includes(optionId) || (optionIndex.get(optionId) ?? 0) < targetIndex) {
        constraints[optionId] = valueId
      }
    }
    // The name carries the pick, exactly as the main product's own options do:
    // "Frame Colour - White". A followed value adds where it came from - the
    // shopper's main choice, or the shop's recommendation - and loses it the
    // moment they move off, so the note never claims something that is no
    // longer true.
    const selectedLabel = valueId ? option.values.find((v) => v.id === valueId)?.label ?? null : null
    const provenance = !entry.overridden && entry.followed != null && valueId === entry.followed
      ? mode === 'default' ? 'matching your choice' : mode === 'recommend' ? 'recommended' : null
      : null
    return (
      <div key={option.id} className="pad-opt">
        <span className="pad-optname">
          {option.name}
          {selectedLabel && (
            <em className="pad-follows"> - {selectedLabel}{provenance ? ` (${provenance})` : ''}</em>
          )}
        </span>
        <div className={`pad-choices ${isSwatch ? 'pad-swatches' : 'pad-pills'}`}>
          {option.values.map((value) => {
            const selected = valueId === value.id
            // A choice the warehouse has run dry on says so and cannot be picked.
            // Staff may still pick it - the point of the storefront for them is to
            // check and demonstrate the product - and the add button below stays
            // shut regardless, so a sold-out combination can be looked at and
            // never bought.
            const outOfStock = isValueOutOfStock(r.addon.selector, constraints, option.id, value.id)
            const unpickable = preview || blocked || (outOfStock && !payload.staffView)
            const valueLabel = outOfStock ? `${value.label} - out of stock` : value.label
            const pick = () =>
              setState(r.addon.linkId, {
                chosen: { ...r.state.chosen, [option.id]: value.id },
                // Picking the followed value back is a return to following, not
                // another override: the note comes back and the put-it-back
                // button goes away.
                overridden: mode === 'default' || mode === 'recommend'
                  ? { ...r.state.overridden, [option.id]: value.id !== entry.followed }
                  : r.state.overridden,
              })
            if (isSwatch) {
              const swatchUrl = value.swatchSmall || value.swatch
              const isImage = !!swatchUrl && !swatchUrl.startsWith('#')
              return (
                // Same hover affordance the main product's colour choices have:
                // a chip above the swatch with a proper look at the picture (or
                // a usable block of the colour) and the value's name under it.
                <PadPeek
                  key={value.id} label={valueLabel}
                  preview={isImage
                    ? <PadSwatchImg src={swatchUrl!} className="pad-peekimg" />
                    : swatchUrl ? <span aria-hidden className="pad-peekcolour" style={{ background: swatchUrl }} /> : null}
                >
                  <button
                    type="button" title={valueLabel} aria-label={`${option.name}: ${valueLabel}`}
                    aria-pressed={selected} disabled={unpickable}
                    className={`pad-swatch${selected ? ' pad-on' : ''}${outOfStock ? ' pad-oos' : ''}`}
                    onClick={pick}
                    style={isImage ? undefined : { background: swatchUrl || 'var(--color-bg-subtle)' }}
                  >
                    {isImage && <PadSwatchImg src={swatchUrl!} />}
                  </button>
                </PadPeek>
              )
            }
            return (
              <button
                key={value.id} type="button" aria-pressed={selected} disabled={unpickable}
                title={outOfStock ? valueLabel : undefined} aria-label={outOfStock ? valueLabel : undefined}
                className={`pad-pill${selected ? ' pad-on' : ''}${outOfStock ? ' pad-oos' : ''}`} onClick={pick}
              >
                {/* The strike belongs to the value's name alone: text-decoration
                    inherits and cannot be cancelled by a descendant, so putting
                    it on the button would score through the reason as well. */}
                {outOfStock ? <span className="pad-oosname">{value.label}</span> : value.label}
                {outOfStock && <span className="pad-oosnote">Out of stock</span>}
              </button>
            )
          })}
        </div>
        {(mode === 'default' || mode === 'recommend') && entry.overridden && (
          <button
            type="button" className="pad-reset" disabled={preview || blocked}
            onClick={() => setState(r.addon.linkId, { overridden: { ...r.state.overridden, [option.id]: false } })}
          >
            {mode === 'default' ? 'Match my choice again' : 'Back to the recommendation'}
          </button>
        )}
      </div>
    )
  }

  function renderAddonRow(r: ResolvedAddon & { depth: number; parent: ResolvedAddon | null }, index: number) {
    const { addon, state } = r
    const blocked = r.blockedBy.length > 0
    const price = r.variant ? r.variant.price * r.perUnitQty : null
    const from = fromPrice(addon.selector)
    const qtyOverridden = r.recommendedPerUnit != null && state.qty != null && state.qty !== r.recommendedPerUnit
    // Only the case we can be CERTAIN the preview dropped this add-on: a
    // recommended-mode override. Free mode may still have a quantity-tagged
    // file - only the viewer knows - so no caption is safer than a wrong one.
    const contextDropped = !!addon.modelContextKey && state.enabled && addon.config.quantity.mode === 'recommended' && qtyOverridden
    // The chosen variation's own picture the moment there is one, and before
    // that the nearest variation to what is already settled (see
    // settledVariantImages); the listing picture only when neither exists.
    const thumbUrl = r.displayImages[0] ?? addon.imageUrl
    // Every picture behind that thumbnail, for the modal the shopper opens by
    // clicking it.
    const images = galleryImages(r)
    // The tick box is no longer wrapping the whole head (the picture inside it
    // is now a button of its own, and interactive content does not belong in a
    // label), so the name is tied to it by id instead.
    const checkboxId = `pad-cb-${addon.linkId}`
    return (
      <div key={addon.linkId} className={`pad-row${r.depth > 1 ? ' pad-child' : ''}`} style={r.depth > 1 ? { marginLeft: `${(r.depth - 1) * 1}rem` } : undefined}>
        <div className="pad-head">
          <input
            id={checkboxId} type="checkbox" checked={state.enabled} disabled={preview || !r.available}
            onChange={(e) => setState(addon.linkId, { enabled: e.target.checked })}
          />
          {thumbUrl && images.length > 0 ? (
            <button
              type="button" className="pad-thumbbtn" disabled={preview}
              aria-label={`See pictures of ${addon.name}`}
              onClick={() => setGallery({ name: addon.name, images })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- product media is an absolute storage URL */}
              <img className="pad-thumb" src={thumbUrl} alt="" loading="lazy" />
              <span className="pad-thumbzoom" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6" />
                </svg>
              </span>
            </button>
          ) : thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- product media is an absolute storage URL
            <img className="pad-thumb" src={thumbUrl} alt="" loading="lazy" />
          ) : (
            <span className="pad-thumb pad-thumb-empty" aria-hidden="true" />
          )}
          {/* Name and price are two labels rather than one wrapping both, so the
              head can lay them out as its own grid rows and Learn more can take a
              column of its own beside the price. Two labels pointing at one tick
              box is ordinary HTML, so clicking either still ticks it. The button
              stays OUT of both: interactive content in a label would tick the box
              on its way to opening the description. */}
          <label className="pad-title" htmlFor={checkboxId}>
            <span className="pad-name">
              {addon.name}
              {/* Only ever reached on a staff copy - a sold-out add-on is not in
                  a shopper's payload at all. */}
              {addon.outOfStock && <span className="pad-oosbadge">Out of stock</span>}
            </span>
          </label>
          <label className="pad-price" htmlFor={checkboxId}>
            {price != null
              ? `+${money(symbol, price)}${suffix}`
              : Number.isFinite(from) ? `from ${money(symbol, from)}${suffix}` : ''}
          </label>
          <button type="button" className="pad-learn" disabled={preview} onClick={() => setLearnMore(addon)}>
            Learn more
          </button>
        </div>
        {addon.outOfStock && (
          <p className="pad-staffnote">Shoppers cannot see this {payload.nounSingular.toLowerCase()} while it is out of stock.</p>
        )}
        {!r.available && state.enabled && (
          <p className="pad-warn">{r.unavailableReason}</p>
        )}
        {state.enabled && r.available && (
          <div className="pad-body">
            {/* Nothing here can be settled until the main product's own choices
                are: the pickers stay visible so the shopper can see what is
                coming, but they are held shut until then. */}
            {blocked && (
              <p className="pad-hint">Choose your {listPhrase(r.blockedBy)} above first.</p>
            )}
            {r.shown.map((entry) => renderOptionPicker(r, entry, blocked))}
            <div className="pad-qty">
              <span className="pad-optname">Quantity</span>
              {/* Quantity input + the add-on's own add button, deliberately the
                  same shapes as the main product's purchase row (shop-variations'
                  add-to-cart part) so the two read as one system. */}
              <div className="pad-buyrow">
                <input
                  type="number" min={1} value={r.perUnitQty} aria-label={`Quantity of ${addon.name}`}
                  className="pad-qtyinput" disabled={preview || blocked}
                  onChange={(e) => setState(addon.linkId, { qty: Math.max(1, Number(e.target.value) || 1) })}
                />
                <button
                  type="button" className="pad-addbtn"
                  disabled={preview || !r.variant || !r.variant.inStock}
                  onClick={() => addAddonToBasket(r, index)}
                >
                  {state.added ? 'Added ✓' : 'Add to cart'}
                </button>
              </div>
              {qtyOverridden && r.note && <p className="pad-note">{r.note}</p>}
              {contextDropped && r.variant && (
                <p className="pad-note">3D preview shows the standard arrangement.</p>
              )}
            </div>
            {!blocked && !r.variant && r.selection == null && (
              <p className="pad-hint">
                {mainSelection?.allOptionsChosen === false && r.shown.length === 0
                  ? 'Choose your options above first.'
                  : 'Pick the options above to include it.'}
              </p>
            )}
            {r.selection && !r.variant && <p className="pad-warn">That combination is not available.</p>}
            {/* An add-on that comes exactly one way has no combination to blame -
                the thing itself is out of stock. */}
            {r.variant && !r.variant.inStock && (
              <p className="pad-warn">{addon.plain ? 'Out of stock.' : 'Out of stock in that combination.'}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  if (payload.addons.length === 0) return null

  // Configuring an add-on is still configuring the purchase, so the phone's
  // pinned gallery strip stays up while the shopper is in here rather than
  // letting go at the end of the main product's own options - the picture (or 3D
  // model) they are changing has to stay in sight while they change it.
  // GALLERY_HOLD_ATTR is shop-variations' published seam for exactly that.
  return (
    <div ref={boxRef} className="pad-box" {...{ [GALLERY_HOLD_ATTR]: '' }}>
      <style dangerouslySetInnerHTML={{ __html: PAD_BOX_CSS }} />
      <h3 className="pad-heading">{payload.nounPlural}</h3>
      {resolvedAll.map((r, index) => renderAddonRow(r, index))}
      {learnMore && (
        <LearnMoreModal slug={learnMore.slug} name={learnMore.name} onClose={() => setLearnMore(null)} />
      )}
      {gallery && (
        <AddonImageModal name={gallery.name} images={gallery.images} onClose={() => setGallery(null)} />
      )}
    </div>
  )
}

// Colours are theme tokens throughout - the box must sit in any palette.
const PAD_BOX_CSS = `
.pad-box{border:1px solid var(--color-border);border-radius:12px;padding:1rem;display:grid;gap:0.75rem;background:var(--color-surface)}
.pad-heading{margin:0;font-size:1.0625rem}
.pad-row{display:grid;gap:0.5rem;border-top:1px solid var(--color-border);padding-top:0.75rem;position:relative}
.pad-row:first-of-type{border-top:none;padding-top:0}
/* Four columns - tick box, picture, words, Learn more - and two rows, the name
   over the price. The tick box and the picture stand down both rows; the name
   takes the whole width of the words column AND the button's on a phone, with
   the button dropping to the price's row beside it, so nothing has to squeeze
   the name to make room. A column of its own is also why the button cannot land
   on the name at any width: there is no overlapping to be done in a grid. */
.pad-head{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;column-gap:0.625rem;min-width:0}
.pad-head input{grid-row:1/3;accent-color:var(--color-primary);width:1.05rem;height:1.05rem;cursor:pointer}
.pad-head>.pad-thumb,.pad-head>.pad-thumbbtn{grid-row:1/3}
.pad-title{grid-column:3/5;grid-row:1}
.pad-price{grid-column:3;grid-row:2}
.pad-thumb{width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--color-bg-subtle);display:block}
.pad-thumb-empty{display:inline-block}
/* The picture is its own control now - it opens the add-on's pictures rather
   than ticking the box - so it says so on hover, and carries a small magnifier
   badge for the shoppers who never hover anything. */
.pad-thumbbtn{position:relative;padding:0;border:none;background:none;border-radius:8px;cursor:zoom-in;flex-shrink:0;line-height:0}
.pad-thumbbtn:disabled{cursor:default}
.pad-thumbbtn:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
.pad-thumbzoom{position:absolute;right:-3px;bottom:-3px;width:17px;height:17px;border-radius:50%;background:var(--color-surface);color:var(--color-text-muted);border:1px solid var(--color-border);display:grid;place-items:center}
.pad-thumbbtn:hover .pad-thumbzoom{color:var(--color-primary);border-color:var(--color-primary)}
.pad-title{min-width:0;cursor:pointer}
.pad-name{font-weight:600;overflow-wrap:anywhere}
/* Staff-only chrome: a shopper is never handed a sold-out add-on to badge. */
.pad-oosbadge{margin-left:0.5rem;font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:var(--color-danger);border:1px solid var(--color-danger);border-radius:999px;padding:0.05rem 0.4rem;vertical-align:middle;white-space:nowrap}
.pad-staffnote{margin:0;font-size:0.75rem;color:var(--color-text-muted);padding-left:1.7rem}
.pad-price{font-size:0.8125rem;color:var(--color-text-muted);min-width:0;cursor:pointer}
/* Beside the price on a phone, where the name has already had the full width
   above it. It used to be lifted out of the flow and parked in the row's corner
   at every width, which on a phone put it straight on top of a name long enough
   to wrap - and most of them are. The negative right margin hangs the button's
   own padding off the edge, so its wording lines up with the row rather than
   sitting a few pixels short of it. */
.pad-learn{grid-column:4;grid-row:2;justify-self:end;background:none;border:1px solid transparent;border-radius:8px;color:var(--color-primary);cursor:pointer;font-size:0.8125rem;padding:0.25rem 0.5rem;margin-right:-0.5rem;white-space:nowrap}
/* !important for the same reason shop's stepper needs one: the site's Styles >
   Buttons settings emit a blanket main button:hover rule, carrying a background
   and an !important of its own (core's lib/design/tokens.ts), that cannot tell a
   call to action from a quiet text button - so without this the site's button
   fill lands on Learn more instead of the subtle tint meant for it. */
.pad-learn:hover{background:var(--color-bg-subtle) !important}
@media (min-width:640px){
  /* Wide enough for the corner it always wanted: up on the name's line, with the
     name stopping at its own column rather than running under it. */
  .pad-title{grid-column:3}
  .pad-learn{grid-row:1;padding:0.375rem 0.75rem}
}
.pad-body{display:grid;gap:0.625rem;padding-left:1.7rem}
.pad-qty{display:grid;gap:0.3rem}
/* The choices sit AFTER the option's name, wrapping around it, exactly as the
   main product's options do. The name is floated rather than a flex item: a
   float only shortens the line boxes beside it, so the first row of choices
   clears the name and every row after it runs the full width. That also means
   the choices cannot be a flex container (a block formatting context is pushed
   aside by a float whole), so they stay inline and space themselves with
   margins. Containment is flow-root, never overflow:hidden - the swatch's hover
   chip escapes its button and hidden would slice it off. */
.pad-opt{display:flow-root}
.pad-optname{font-size:0.8125rem;font-weight:500}
.pad-opt>.pad-optname{float:left;margin-right:0.5rem;padding-top:0.35rem}
.pad-choices{margin-bottom:-0.375rem}
.pad-follows{font-style:normal;font-weight:400;color:var(--color-text-muted)}
.pad-locked{font-size:0.8125rem;color:var(--color-text-muted);display:flex;align-items:center;gap:0.375rem;flex-wrap:wrap}
.pad-locked .pad-peek{margin:0}
/* Sized against the locked line's own text rather than the pickable rows: it is
   a statement of what arrives, not a target to hit. */
.pad-swatch-static{display:inline-block;cursor:default;width:22px;height:22px;border-width:1px}
.pad-peek{position:relative;display:inline-flex;vertical-align:top;margin:0 0.375rem 0.375rem 0}
.pad-chip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:20;white-space:nowrap;pointer-events:none;display:grid;justify-items:center;gap:4px;background:var(--color-surface);color:var(--color-text);border:1px solid var(--color-border);border-radius:8px;box-shadow:var(--shadow-lg);padding:4px 6px 3px;font-size:0.75rem;line-height:1.3}
.pad-peekimg{width:200px;height:200px;object-fit:contain;display:block;border-radius:4px}
.pad-peekcolour{width:160px;height:90px;display:block;border-radius:4px;border:1px solid var(--color-border)}
.pad-swatch{width:30px;height:30px;border-radius:50%;border:2px solid var(--color-border);padding:0;cursor:pointer;overflow:hidden;flex-shrink:0}
.pad-swatch img{width:100%;height:100%;object-fit:cover;display:block}
.pad-swatch.pad-on{border-color:var(--color-primary);box-shadow:0 0 0 2px var(--color-surface),0 0 0 4px var(--color-primary)}
.pad-swatch:disabled{cursor:not-allowed;opacity:0.55}
.pad-pill{border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);border-radius:999px;padding:0.25rem 0.75rem;font-size:0.8125rem;cursor:pointer;vertical-align:top;margin:0 0.375rem 0.375rem 0}
.pad-pill.pad-on{border-color:var(--color-primary);color:var(--color-primary);font-weight:600}
.pad-pill:disabled{cursor:not-allowed;color:var(--color-text-muted)}
/* A choice the warehouse has run dry on: struck through with the reason under
   it, the same look the main product's options wear. Staff can still click it -
   the strike says what it is, the add button says what it is not. */
.pad-pill.pad-oos{color:var(--color-text-muted);line-height:1.25}
.pad-oosname{text-decoration:line-through}
.pad-oosnote{display:block;font-size:0.6875rem;line-height:1.2;color:var(--color-text-muted)}
.pad-swatch.pad-oos{opacity:0.45}
.pad-reset{clear:left;display:block;justify-self:start;background:none;border:none;color:var(--color-primary);cursor:pointer;font-size:0.75rem;padding:0.25rem 0 0}
.pad-buyrow{display:flex;gap:0.75rem;align-items:center}
/* Mirrors shop-variations' add-to-cart part: the same 64px numeric quantity
   field and the same primary-filled button, so an add-on's purchase row reads
   exactly like the main product's above it. */
.pad-qtyinput{width:64px;padding:0.5rem;border-radius:6px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font:inherit}
.pad-addbtn{flex:1;background:var(--color-primary);color:var(--color-on-primary);border:none;border-radius:8px;padding:0.75rem 1.25rem;font:inherit;font-weight:600;cursor:pointer}
.pad-addbtn:disabled{background:var(--color-bg-subtle);color:var(--color-text-muted);cursor:not-allowed}
.pad-note,.pad-hint{margin:0;font-size:0.75rem;color:var(--color-text-muted)}
.pad-warn{margin:0;font-size:0.8125rem;color:var(--color-danger)}
.pad-child{border-top-style:dashed}
`
