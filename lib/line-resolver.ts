// The shop.cart-line-resolver for product add-ons.
//
// Money never moves here: an add-on line IS its product, priced by shop like
// any other line - this resolver only declares grouping (so every basket
// surface keeps the set together), prints the "Accessory for" field, restates
// the quantity recommendation when the numbers drift, and validates that the
// stamped link still exists and still points at the product on the line.
//
// Orphans degrade, never fail: an add-on whose main line has left the basket
// (the shopper answered "keep them") is a perfectly good product on its own,
// so its group and caption are simply dropped and the line renders flat.
//
// The per-line resolve is handed only (product, meta) - deliberately blind to
// its neighbours and to the line's own quantity - so everything cross-line
// (is the main still here? do the quantities still match the recommendation?)
// is worked out in the PREFETCHER, which sees the whole basket, and parked in
// the request store for the per-line pass to read back.
import { cache } from 'react'
import type { CartLinePrefetchLine, CartLineResolution, CartLineResolver, CartLineResolverPrefetch } from '@/modules/shop/lib/line-meta'
import type { LineMetaField, ShpProduct } from '@/modules/shop/lib/types'
import { getVariantParentsByChild } from '@/modules/shop-variations/lib/db/variants'
import { getLinksByIds } from '@/modules/product-addons-for-shop/lib/db/links'
import { getPadSettings } from '@/modules/product-addons-for-shop/lib/db/settings'
import { PAD_DEFAULT_SETTINGS, PAD_META_KEY, type PadAddonLineMeta, type PadLineMeta, type PadLink, type PadSettings } from '@/modules/product-addons-for-shop/lib/types'

function readPadMeta(meta: Record<string, unknown> | undefined): PadLineMeta | null {
  const raw = meta?.[PAD_META_KEY]
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<PadLineMeta> & { role?: string }
  if (typeof m.group !== 'string' || !m.group) return null
  if (m.role === 'main') return { group: m.group, role: 'main' }
  if (m.role === 'addon') {
    const a = m as Partial<PadAddonLineMeta>
    if (typeof a.linkId !== 'string' || typeof a.forLabel !== 'string') return null
    return {
      group: m.group,
      role: 'addon',
      linkId: a.linkId,
      forProductId: typeof a.forProductId === 'string' ? a.forProductId : '',
      forLabel: a.forLabel,
      depth: typeof a.depth === 'number' && a.depth > 0 ? a.depth : 1,
      order: typeof a.order === 'number' ? a.order : 0,
      ...(typeof a.recommendedPerUnit === 'number' ? { recommendedPerUnit: a.recommendedPerUnit } : {}),
      ...(typeof a.recommendedNote === 'string' ? { recommendedNote: a.recommendedNote } : {}),
    }
  }
  return null
}

// Identity for one add-on line in the store: the same key the per-line pass can
// rebuild from what it is handed. Two truly identical lines share an advisory,
// which is exactly right.
function lineKeyOf(productId: string, pad: PadAddonLineMeta): string {
  return `${pad.group}|${pad.linkId}|${productId}`
}

type PadStore = {
  mainsByGroup: Map<string, { productId: string; quantity: number }>
  linksById: Map<string, PadLink>
  parentByChild: Map<string, string>
  advisoryByLine: Map<string, string>
  settings: PadSettings
  prefetched: boolean
}

const requestStore = cache((): PadStore => ({
  mainsByGroup: new Map(),
  linksById: new Map(),
  parentByChild: new Map(),
  advisoryByLine: new Map(),
  settings: PAD_DEFAULT_SETTINGS,
  prefetched: false,
}))

export const prefetchProductAddonLines: CartLineResolverPrefetch = async (
  _products: ShpProduct[],
  lines?: CartLinePrefetchLine[],
) => {
  const store = requestStore()
  store.settings = await getPadSettings()
  if (!lines?.length) { store.prefetched = true; return }

  const linkIds = new Set<string>()
  const childIds = new Set<string>()
  const addonLines: Array<{ productId: string; quantity: number; pad: PadAddonLineMeta }> = []
  for (const line of lines) {
    const pad = readPadMeta(line.meta)
    if (!pad) continue
    if (pad.role === 'main') {
      store.mainsByGroup.set(pad.group, { productId: line.product.id, quantity: line.quantity })
    } else {
      linkIds.add(pad.linkId)
      childIds.add(line.product.id)
      addonLines.push({ productId: line.product.id, quantity: line.quantity, pad })
    }
  }
  const [links, parents] = await Promise.all([
    getLinksByIds([...linkIds]),
    getVariantParentsByChild([...childIds]),
  ])
  store.linksById = links
  store.parentByChild = parents

  // The drift advisory, computed here because only this pass knows both
  // quantities. Silent while the numbers agree - the note exists to do the
  // arithmetic out loud when they stop agreeing, not to nag.
  for (const { productId, quantity, pad } of addonLines) {
    if (pad.recommendedPerUnit == null) continue
    const main = store.mainsByGroup.get(pad.group)
    if (!main) continue
    const expected = pad.recommendedPerUnit * main.quantity
    if (expected > 0 && expected !== quantity) {
      store.advisoryByLine.set(
        lineKeyOf(productId, pad),
        pad.recommendedNote ?? `We'd recommend ${expected} for the ${main.quantity} in your basket`,
      )
    }
  }
  store.prefetched = true
}

const VALID: CartLineResolution = { valid: true, priceAdjust: 0, persistMeta: null }

export const resolveProductAddonLineMeta: CartLineResolver = async (
  product: ShpProduct,
  meta: Record<string, unknown> | undefined,
): Promise<CartLineResolution> => {
  const pad = readPadMeta(meta)
  if (!pad) return VALID

  const store = requestStore()
  const settings = store.settings
  const collective = settings.nounPlural.toLowerCase()

  if (pad.role === 'main') {
    return {
      ...VALID,
      // The data bag is what the attach-rate report reads off order items long
      // after this ran; the group is what every basket surface renders from.
      persistMeta: { fields: [], data: { [PAD_META_KEY]: { group: pad.group, role: 'main' } } },
      group: { key: pad.group, role: 'main', collectiveLabel: collective },
    }
  }

  // Link validation only bites when the prefetch ran and the link is genuinely
  // gone or points elsewhere - a config change since the add.
  if (store.prefetched) {
    const link = store.linksById.get(pad.linkId)
    if (!link) {
      // Deleted link: the product is still real and still priced right, so the
      // line survives - just no longer as an attachment.
      return VALID
    }
    const owner = store.parentByChild.get(product.id) ?? product.id
    if (owner !== link.addonProductId) {
      return {
        valid: false,
        priceAdjust: 0,
        persistMeta: null,
        reason: `This line no longer matches the ${settings.nounSingular.toLowerCase()} it was added as - please remove it and add it again`,
      }
    }
  }

  const main = store.prefetched ? store.mainsByGroup.get(pad.group) : undefined
  const fields: LineMetaField[] = [{ label: `${settings.nounSingular} for`, value: pad.forLabel }]

  // Orphan: the main has left the basket. Flat line, the field kept - it still
  // says what the thing was bought for.
  if (store.prefetched && !main) {
    return { ...VALID, persistMeta: { fields } }
  }

  const advisory = store.advisoryByLine.get(lineKeyOf(product.id, pad))
  if (advisory) fields.push({ label: 'Recommended', value: advisory })

  return {
    ...VALID,
    persistMeta: {
      fields,
      // linkId is what ties an order item back to the link for the attach-rate
      // report. Only stamped while the set is genuinely together - an orphan
      // (above) persists no link, so the report counts attached sales alone.
      data: { [PAD_META_KEY]: { group: pad.group, role: 'addon', linkId: pad.linkId } },
    },
    group: {
      key: pad.group,
      role: 'attachment',
      caption: `${settings.nounSingular} for ${pad.forLabel}`,
      depth: pad.depth,
      order: pad.order,
    },
  }
}
