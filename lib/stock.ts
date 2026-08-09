// Stock questions the add-ons surfaces ask, in one place so the box, the
// showcase and the server payload can never disagree about what is buyable.
//
// The shop's own rule throughout: a shopper is offered what the warehouse can
// actually send, staff are offered everything and stopped at the basket. An
// accessory nobody can buy is noise on a product page, so it is dropped for
// shoppers entirely - but the owner still needs to see it sitting there, or the
// first they hear of a sold-out accessory is a customer asking where it went.
import { valueToOptionMap, variantAnswersTo, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'
import type { PadAddonPayload } from '@/modules/product-addons-for-shop/lib/types'

// Whether an add-on has run dry altogether - no variation of it left to sell.
//
// An add-on that comes exactly one way answers from its own listing row. One
// with variations is out of stock only when EVERY switched-on variation is:
// a single dead colour is a value-level problem (see below), not a reason to
// take the whole accessory off the page.
//
// A product with no switched-on variations at all is not a stock question - the
// owner has switched the combinations off themselves - so it is left alone and
// behaves exactly as it did.
export function isAddonOutOfStock(addon: Pick<PadAddonPayload, 'plain' | 'selector'>): boolean {
  if (addon.plain) return !addon.plain.inStock
  const enabled = addon.selector.variants.filter((v) => v.enabled)
  if (enabled.length === 0) return false
  return enabled.every((v) => !v.inStock)
}

// Whether one value of one of the add-on's own options is out of stock given
// what is already settled around it - the desk's width it matched, the colour
// the shop pinned, the picks made above it.
//
// `constraints` is what the caller counts as settled: the box passes every
// locked value (a matched width, a fixed finish - those are not the shopper's to
// change) plus the picks made ABOVE this option in display order. Picks BELOW it
// are deliberately left out, the same directional rule shop-variations' own
// picker follows, so a later choice can never grey out an earlier option's
// values and strand the shopper.
//
// False when nothing carries the value in that context: there is no stock to be
// out of, and the box's existing "that combination is not available" wording is
// the honest answer. False too for a value carried only by switched-off
// variations - that is the owner's doing, not the warehouse's.
export function isValueOutOfStock(
  selector: VariantSelectorPayload,
  constraints: OptionSelection,
  optionId: string,
  valueId: string,
): boolean {
  const v2o = valueToOptionMap(selector)
  const carriers = selector.variants.filter((variant) => {
    if (!variant.enabled) return false
    if (!variantAnswersTo(variant, optionId, valueId, v2o)) return false
    return Object.entries(constraints).every(([oid, vid]) =>
      oid === optionId || variantAnswersTo(variant, oid, vid, v2o))
  })
  if (carriers.length === 0) return false
  return carriers.every((variant) => !variant.inStock)
}
