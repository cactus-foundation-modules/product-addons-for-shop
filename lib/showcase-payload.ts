import { getShopConfigCached } from '@/modules/shop/lib/config'
import { buildBoxPayload } from '@/modules/product-addons-for-shop/lib/payload'
import { getPadSettings } from '@/modules/product-addons-for-shop/lib/db/settings'
import type { ShowcasePayload } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'
import type { PadBoxPayload } from '@/modules/product-addons-for-shop/lib/types'

// The showcase's card data, derived from the same box payload so the two
// surfaces can never disagree about which add-ons a product offers. From-price
// is the cheapest buyable combination, formatted here once (the selector's
// prices are already on the shop's display side of tax).

function fromPrice(addon: PadBoxPayload['addons'][number]): number {
  const enabled = addon.selector.variants.filter((v) => v.enabled)
  if (enabled.length === 0) return addon.selector.basePrice
  return enabled.reduce((min, v) => Math.min(min, v.price), Infinity)
}

export async function buildShowcasePayload(productId: string): Promise<(ShowcasePayload & { surface: 'TAB' | 'BLOCK' | 'NONE' }) | null> {
  const [box, settings, config] = await Promise.all([
    buildBoxPayload(productId),
    getPadSettings(),
    getShopConfigCached(),
  ])
  if (!box) return null
  const suffix = box.priceSuffix ? ` ${box.priceSuffix}` : ''
  return {
    surface: settings.showcaseSurface,
    nounPlural: box.nounPlural,
    cards: box.addons.map((addon) => {
      const from = fromPrice(addon)
      return {
        linkId: addon.linkId,
        name: addon.name,
        slug: addon.slug,
        shortDescription: addon.shortDescription,
        imageUrl: addon.imageUrl,
        fromPriceFormatted: Number.isFinite(from) ? `From ${config.currencySymbol}${from.toFixed(2)}${suffix}` : '',
      }
    }),
  }
}
