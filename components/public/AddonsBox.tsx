'use client'

// The add-ons box: the small panel under Add to basket where a shopper ticks
// the accessories they want with the product they are configuring.
//
// It never adds anything itself. It registers a purchase-companion provider
// with shop-variations (see that module's lib/purchase-companions.ts - a
// window seam, no imports either way at runtime beyond the contract types) and
// hands over its lines the moment the shopper presses the ordinary Add to
// basket button. One press, one basket group.
//
// Everything it knows about the main product's selection arrives on the
// variant-selection broadcast; everything the 3D viewer needs to show the
// right combined model leaves on the model-context broadcast. Both are
// documented window events - this component and the viewer never import each
// other.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getVariantSelection,
  VARIANT_SELECTION_EVENT,
  type VariantSelectionDetail,
} from '@/modules/shop-variations/lib/selection-broadcast'
import { registerPurchaseCompanion, type CompanionLineRequest } from '@/modules/shop-variations/lib/purchase-companions'
import { resolveVariant, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'
import type { SvrOptionWithValues, VariantSelectorPayload } from '@/modules/shop-variations/lib/types'
import {
  deterministicGroupKey,
  findOptionByName,
  recommendationNote,
  recommendedQuantityPerUnit,
  resolveMappings,
} from '@/modules/product-addons-for-shop/lib/mapping'
import { publishModelContext } from '@/modules/product-addons-for-shop/lib/model-context'
import { ADDON_FOCUS_EVENT, type AddonFocusDetail } from '@/modules/product-addons-for-shop/lib/accessory-focus'
import { LearnMoreModal } from '@/modules/product-addons-for-shop/components/public/LearnMoreModal'
import { PAD_META_KEY, type PadAddonPayload, type PadBoxPayload } from '@/modules/product-addons-for-shop/lib/types'

// Per-addon UI state, keyed by linkId (chain rows included - link ids are
// unique across the whole tree).
type AddonState = {
  enabled: boolean
  // The shopper's own picks for choose/default options: option id -> value id.
  chosen: Record<string, string>
  // Which default-mode options the shopper has overridden (by option id). An
  // un-overridden default keeps following the main selection live.
  overridden: Record<string, boolean>
  // Quantity per one main unit; null = follow the recommendation (or 1 in free
  // mode until touched).
  qty: number | null
}

type ResolvedAddon = {
  addon: PadAddonPayload
  state: AddonState
  // Option id -> value id for every option, however its value arrives. Null
  // when the combination is not yet complete or not available.
  selection: OptionSelection | null
  // Which options the shopper is shown (choose + default modes).
  shown: Array<{ option: SvrOptionWithValues; mode: 'choose' | 'default'; valueId: string | null; locked: string | null }>
  // Whether the mapping machinery could place every match-mode option (false =
  // unavailable for the current main configuration).
  available: boolean
  // Why not, when not (shopper wording).
  unavailableReason: string | null
  variant: ReturnType<typeof resolveVariant>
  perUnitQty: number
  recommendedPerUnit: number | null
  note: string | null
}

const money = (symbol: string, n: number) => `${symbol}${n.toFixed(2)}`

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

function activeContextKeys(list: ActiveAddon[]): string[] {
  const keys: string[] = []
  for (const r of list) {
    if (!r.state.enabled || !r.variant || !r.available || !r.addon.modelContextKey) continue
    if (r.addon.config.quantity.mode === 'free') {
      keys.push(`${r.addon.modelContextKey}:${r.perUnitQty}`)
    } else if (r.recommendedPerUnit == null || r.perUnitQty === r.recommendedPerUnit) {
      keys.push(r.addon.modelContextKey)
    }
    // Recommended-mode overridden quantity: the key stays out - the preview
    // shows the standard arrangement or none, never a guess.
  }
  return keys
}

function mainModelContext(active: ActiveAddon[]): { contexts: string[]; extraValueIds: string[] } {
  const extraValueIds = active.flatMap((r) => (r.selection ? Object.values(r.selection) : []))
  return { contexts: activeContextKeys(active), extraValueIds }
}

function lineModelContext(r: ActiveAddon): { stage: 'none' | 'self' } {
  const contextActive =
    !!r.addon.modelContextKey &&
    (r.addon.config.quantity.mode === 'free' || r.recommendedPerUnit == null || r.perUnitQty === r.recommendedPerUnit)
  // Inside the combined model when its context is active; its own placeable
  // item when the owner allows it; otherwise list-only (a loose shelf).
  return { stage: contextActive ? 'none' : r.addon.plannerStandalone ? 'self' : 'none' }
}

export function AddonsBox({ payload, preview }: { payload: PadBoxPayload; preview?: boolean }) {
  const [mainSelection, setMainSelection] = useState<VariantSelectionDetail | null>(null)
  const [states, setStates] = useState<Record<string, AddonState>>({})
  const [learnMore, setLearnMore] = useState<PadAddonPayload | null>(null)
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
        [detail.linkId]: { ...(prev[detail.linkId] ?? { enabled: false, chosen: {}, overridden: {}, qty: null }), enabled: true },
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
    states[linkId] ?? { enabled: false, chosen: {}, overridden: {}, qty: null }

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
    let available = resolved !== null
    let unavailableReason: string | null = resolved === null ? 'Not available at the moment' : null

    if (resolved) {
      const mapped = new Map(resolved.map((r) => [r.addonOption.id, r]))
      for (const option of addon.selector.options) {
        const r = mapped.get(option.id)
        const mode = r?.mapping.mode
        if (mode === 'match' || mode === 'fixed') {
          if (r?.value) {
            selection[option.id] = r.value.id
          } else if (mode === 'fixed' || (r?.mainOption && parentSelection[r.mainOption.id])) {
            // A fixed value that no longer exists, or a chosen main value with
            // no translation: this add-on cannot be bought for this
            // configuration.
            available = false
            unavailableReason = `Not available for the chosen ${r?.mainOption?.name.toLowerCase() ?? 'configuration'}`
          }
          continue
        }
        if (mode === 'default') {
          const followed = r?.value?.id ?? null
          const chosen = state.overridden[option.id] ? state.chosen[option.id] ?? null : followed
          if (chosen) selection[option.id] = chosen
          shown.push({ option, mode: 'default', valueId: chosen, locked: null })
          continue
        }
        // choose (explicit or unmapped): the shopper's pick.
        const chosen = state.chosen[option.id] ?? null
        if (chosen) selection[option.id] = chosen
        shown.push({ option, mode: 'choose', valueId: chosen, locked: null })
      }
      // Matched options the shopper should still SEE (locked wording), listed
      // after resolution so width reads "matches your desk".
      for (const r of resolved) {
        if (r.mapping.mode === 'match' && r.value) {
          shown.unshift({ option: r.addonOption, mode: 'choose', valueId: null, locked: `${r.value.label} - matches your ${r.mainOption?.name.toLowerCase() ?? 'choice'}` })
        }
      }
    }

    const complete = addon.selector.options.every((o) => selection[o.id])
    const variant = complete ? resolveVariant(addon.selector, selection) : null
    const recommendedPerUnit = recommendedQuantityPerUnit(addon.config.quantity, parentOptions, parentSelection)
    const perUnitQty = state.qty ?? recommendedPerUnit ?? 1
    const note = recommendationNote(addon.config.quantity, addon.name, parentOptions, parentSelection)

    return {
      addon,
      state,
      selection: complete ? selection : null,
      shown,
      available,
      unavailableReason: available ? null : unavailableReason,
      variant,
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

  // ---- Purchase-companion registration -------------------------------------
  // Refs so collect() - called at add-to-basket time, outside React - always
  // reads the latest resolution without the provider re-registering per
  // render. Updated post-commit, never during render.
  const resolvedRef = useRef(resolvedAll)
  const payloadRef = useRef(payload)
  useEffect(() => {
    resolvedRef.current = resolvedAll
    payloadRef.current = payload
  })

  useEffect(() => {
    if (preview) return
    const slug = mainSelection?.slug
    if (!slug) return
    return registerPurchaseCompanion(`product-addons:${payload.productId}`, {
      slug,
      collect: (ctx) => {
        const active = resolvedRef.current.filter((r) => r.state.enabled && r.variant && r.available)
        if (active.length === 0) return null
        const parts = active.map((r) => `${r.addon.linkId}:${r.variant!.childProductId}:${r.perUnitQty}`)
        const group = deterministicGroupKey(ctx.productId, parts)
        const lines: CompanionLineRequest[] = active.map((r, index) => {
          const forLabel = r.parent ? r.parent.addon.name : payloadRef.current.productName
          const forProductId = r.parent ? r.parent.variant?.childProductId ?? r.parent.addon.addonProductId : ctx.productId
          return {
            productId: r.variant!.childProductId,
            quantity: r.perUnitQty * ctx.quantity,
            lineId: `pad:${group}:${r.addon.linkId}:${r.variant!.childProductId}`,
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
              modelContext: lineModelContext(r),
            },
          }
        })
        return {
          mainMeta: {
            [PAD_META_KEY]: { group, role: 'main' },
            modelContext: mainModelContext(active),
          },
          lines,
        }
      },
    })
  }, [preview, mainSelection?.slug, payload.productId])

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

  function renderOptionPicker(r: ResolvedAddon, entry: ResolvedAddon['shown'][number]) {
    const { option, mode, valueId } = entry
    if (entry.locked) {
      return (
        <div key={option.id} className="pad-locked">
          <span className="pad-optname">{option.name}:</span> {entry.locked}
        </div>
      )
    }
    const isSwatch = option.controlType === 'SWATCH' || option.controlType === 'IMAGE'
    const followedNote = mode === 'default' && !r.state.overridden[option.id]
    return (
      <div key={option.id} className="pad-opt">
        <span className="pad-optname">
          {option.name}
          {followedNote && <em className="pad-follows"> - matching your choice</em>}
        </span>
        <div className={isSwatch ? 'pad-swatches' : 'pad-pills'}>
          {option.values.map((value) => {
            const selected = valueId === value.id
            const pick = () =>
              setState(r.addon.linkId, {
                chosen: { ...r.state.chosen, [option.id]: value.id },
                overridden: mode === 'default' ? { ...r.state.overridden, [option.id]: true } : r.state.overridden,
              })
            if (isSwatch) {
              const swatchUrl = value.swatchSmall || value.swatch
              const isImage = !!swatchUrl && !swatchUrl.startsWith('#')
              return (
                <button
                  key={value.id} type="button" title={value.label} aria-label={`${option.name}: ${value.label}`}
                  aria-pressed={selected} disabled={preview}
                  className={`pad-swatch${selected ? ' pad-on' : ''}`}
                  onClick={pick}
                  style={isImage ? undefined : { background: swatchUrl || 'var(--color-bg-subtle)' }}
                >
                  {isImage && (
                    // eslint-disable-next-line @next/next/no-img-element -- swatch is an absolute media URL
                    <img src={swatchUrl!} alt="" loading="lazy" />
                  )}
                </button>
              )
            }
            return (
              <button
                key={value.id} type="button" aria-pressed={selected} disabled={preview}
                className={`pad-pill${selected ? ' pad-on' : ''}`} onClick={pick}
              >
                {value.label}
              </button>
            )
          })}
        </div>
        {mode === 'default' && r.state.overridden[option.id] && (
          <button
            type="button" className="pad-reset" disabled={preview}
            onClick={() => setState(r.addon.linkId, { overridden: { ...r.state.overridden, [option.id]: false } })}
          >
            Match my choice again
          </button>
        )}
      </div>
    )
  }

  function renderAddonRow(r: ResolvedAddon & { depth: number }) {
    const { addon, state } = r
    const price = r.variant ? r.variant.price * r.perUnitQty : null
    const from = fromPrice(addon.selector)
    const qtyOverridden = r.recommendedPerUnit != null && state.qty != null && state.qty !== r.recommendedPerUnit
    // Only the case we can be CERTAIN the preview dropped this add-on: a
    // recommended-mode override. Free mode may still have a quantity-tagged
    // file - only the viewer knows - so no caption is safer than a wrong one.
    const contextDropped = !!addon.modelContextKey && state.enabled && addon.config.quantity.mode === 'recommended' && qtyOverridden
    return (
      <div key={addon.linkId} className={`pad-row${r.depth > 1 ? ' pad-child' : ''}`} style={r.depth > 1 ? { marginLeft: `${(r.depth - 1) * 1}rem` } : undefined}>
        <label className="pad-head">
          <input
            type="checkbox" checked={state.enabled} disabled={preview || !r.available}
            onChange={(e) => setState(addon.linkId, { enabled: e.target.checked })}
          />
          {addon.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- product media is an absolute storage URL
            <img className="pad-thumb" src={addon.imageUrl} alt="" loading="lazy" />
          ) : (
            <span className="pad-thumb pad-thumb-empty" aria-hidden="true" />
          )}
          <span className="pad-title">
            <span className="pad-name">{addon.name}</span>
            <span className="pad-price">
              {price != null
                ? `+${money(symbol, price)}${suffix}`
                : Number.isFinite(from) ? `from ${money(symbol, from)}${suffix}` : ''}
            </span>
          </span>
        </label>
        <button type="button" className="pad-learn" disabled={preview} onClick={() => setLearnMore(addon)}>
          Learn more
        </button>
        {!r.available && state.enabled && (
          <p className="pad-warn">{r.unavailableReason}</p>
        )}
        {state.enabled && r.available && (
          <div className="pad-body">
            {r.shown.map((entry) => renderOptionPicker(r, entry))}
            <div className="pad-qty">
              <span className="pad-optname">Quantity</span>
              <div className="pad-stepper">
                <button type="button" aria-label={`Fewer ${addon.name}`} disabled={preview || r.perUnitQty <= 1} onClick={() => setState(addon.linkId, { qty: Math.max(1, r.perUnitQty - 1) })}>−</button>
                <span aria-live="polite">{r.perUnitQty}</span>
                <button type="button" aria-label={`More ${addon.name}`} disabled={preview} onClick={() => setState(addon.linkId, { qty: r.perUnitQty + 1 })}>+</button>
              </div>
              {qtyOverridden && r.note && <p className="pad-note">{r.note}</p>}
              {contextDropped && r.variant && (
                <p className="pad-note">3D preview shows the standard arrangement.</p>
              )}
            </div>
            {!r.variant && r.selection == null && (
              <p className="pad-hint">
                {mainSelection?.allOptionsChosen === false && r.shown.length === 0
                  ? 'Choose your options above first.'
                  : 'Pick the options above to include it.'}
              </p>
            )}
            {r.selection && !r.variant && <p className="pad-warn">That combination is not available.</p>}
            {r.variant && !r.variant.inStock && <p className="pad-warn">Out of stock in that combination.</p>}
          </div>
        )}
      </div>
    )
  }

  if (payload.addons.length === 0) return null

  return (
    <div ref={boxRef} className="pad-box">
      <style dangerouslySetInnerHTML={{ __html: PAD_BOX_CSS }} />
      <h3 className="pad-heading">{payload.nounPlural}</h3>
      {resolvedAll.map((r) => renderAddonRow(r))}
      {learnMore && (
        <LearnMoreModal slug={learnMore.slug} name={learnMore.name} onClose={() => setLearnMore(null)} />
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
.pad-head{display:flex;align-items:center;gap:0.625rem;cursor:pointer;min-width:0}
.pad-head input{accent-color:var(--color-primary);width:1.05rem;height:1.05rem;flex-shrink:0}
.pad-thumb{width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--color-bg-subtle)}
.pad-thumb-empty{display:inline-block}
.pad-title{display:grid;min-width:0}
.pad-name{font-weight:600;overflow-wrap:anywhere}
.pad-price{font-size:0.8125rem;color:var(--color-text-muted)}
.pad-learn{position:absolute;top:0.75rem;right:0;background:none;border:none;color:var(--color-primary);cursor:pointer;font-size:0.8125rem;padding:0.125rem}
.pad-row:first-of-type .pad-learn{top:0}
.pad-body{display:grid;gap:0.625rem;padding-left:1.7rem}
.pad-opt,.pad-qty{display:grid;gap:0.3rem}
.pad-optname{font-size:0.8125rem;font-weight:500}
.pad-follows{font-style:normal;font-weight:400;color:var(--color-text-muted)}
.pad-locked{font-size:0.8125rem;color:var(--color-text-muted)}
.pad-swatches{display:flex;flex-wrap:wrap;gap:0.375rem}
.pad-swatch{width:30px;height:30px;border-radius:50%;border:2px solid var(--color-border);padding:0;cursor:pointer;overflow:hidden;flex-shrink:0}
.pad-swatch img{width:100%;height:100%;object-fit:cover;display:block}
.pad-swatch.pad-on{border-color:var(--color-primary);box-shadow:0 0 0 2px var(--color-surface),0 0 0 4px var(--color-primary)}
.pad-pills{display:flex;flex-wrap:wrap;gap:0.375rem}
.pad-pill{border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);border-radius:999px;padding:0.25rem 0.75rem;font-size:0.8125rem;cursor:pointer}
.pad-pill.pad-on{border-color:var(--color-primary);color:var(--color-primary);font-weight:600}
.pad-reset{justify-self:start;background:none;border:none;color:var(--color-primary);cursor:pointer;font-size:0.75rem;padding:0}
.pad-stepper{display:inline-flex;align-items:center;gap:0.75rem;border:1px solid var(--color-border);border-radius:8px;padding:0.2rem 0.6rem;width:max-content}
.pad-stepper button{background:none;border:none;font-size:1rem;cursor:pointer;color:var(--color-text);padding:0 0.25rem}
.pad-stepper button:disabled{opacity:0.4;cursor:default}
.pad-note,.pad-hint{margin:0;font-size:0.75rem;color:var(--color-text-muted)}
.pad-warn{margin:0;font-size:0.8125rem;color:var(--color-danger)}
.pad-child{border-top-style:dashed}
`
