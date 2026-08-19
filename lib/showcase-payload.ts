import { getShopConfigCached } from '@/modules/shop/lib/config'
import { getShopBreakpoints } from '@/modules/shop/lib/breakpoints'
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
  const [box, settings, config, breakpoints] = await Promise.all([
    buildBoxPayload(productId),
    getPadSettings(),
    getShopConfigCached(),
    // Resolved here rather than in the component: the widths come from the site's
    // Styles setting, which is a database read, and the cards are a client island.
    getShopBreakpoints(),
  ])
  if (!box) return null
  const suffix = box.priceSuffix ? ` ${box.priceSuffix}` : ''
  return {
    surface: settings.showcaseSurface,
    nounPlural: box.nounPlural,
    breakpoints,
    // Carried so the cards can answer to the shopper's live choices: an
    // accessory that only applies to some configurations must not be offered
    // here when the box below would not offer it.
    mainOptions: box.mainOptions,
    productUrlStyle: config.productUrlStyle,
    cards: box.addons.map((addon) => {
      const from = fromPrice(addon)
      return {
        linkId: addon.linkId,
        name: addon.name,
        slug: addon.slug,
        shortDescription: addon.shortDescription,
        imageUrl: addon.imageUrl,
        // The listing's own gallery, in its own order, so clicking the card's
        // picture opens the lot rather than the one thumbnail.
        images: addon.selector.baseImages.map((image) => ({ url: image.url, alt: image.alt })),
        // Only ever true on a staff copy: the box payload this is built from has
        // already dropped the sold-out add-ons for everybody else.
        outOfStock: addon.outOfStock,
        ...(addon.config.showWhen?.length ? { showWhen: addon.config.showWhen } : {}),
        fromPriceFormatted: Number.isFinite(from) ? `From ${config.currencySymbol}${from.toFixed(2)}${suffix}` : '',
      }
    }),
  }
}
