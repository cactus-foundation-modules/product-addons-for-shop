import { AddonsTabPanel } from '@/modules/product-addons-for-shop/components/public/AddonsTabPanel'
import { buildShowcasePayload } from '@/modules/product-addons-for-shop/lib/showcase-payload'
import type { ShopDetailTabProvider } from '@/modules/shop/lib/detail-tabs'

// The automatic showcase: an "Accessories" tab (the owner's own noun) in the
// product page's strip, directly after Description, on every product that has
// add-ons configured - no layout editing anywhere. The owner who would rather
// place the block by hand flips the surface setting and this stands down,
// mirroring reviews-for-shop's tab/block choice.
export const productAddonsTabProvider: ShopDetailTabProvider = {
  // Fallback name only - labelFor below names the tab from the owner's setting.
  label: 'Add-ons',

  // After Specification (20): the strip reads Description, Specification, then
  // what goes WITH the product.
  order: 25,

  load: async (productId: string) => {
    const payload = await buildShowcasePayload(productId)
    if (!payload || payload.surface !== 'TAB' || payload.cards.length === 0) return null
    return payload
  },

  labelFor: (payload) => (payload as { nounPlural?: string })?.nounPlural ?? null,

  Panel: AddonsTabPanel,
}
