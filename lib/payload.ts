import { getProductsByIds } from '@/modules/shop/lib/db/products'
import { getPrimaryProductImages } from '@/modules/shop/lib/db/products'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { canSeeStockLevels } from '@/modules/shop/lib/admin-stock'
import { effectivePrice } from '@/modules/shop/lib/pricing'
import { makeDisplayAdjuster, resolveTaxDisplay } from '@/modules/shop/lib/tax-display'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getVariantSelectorPayload } from '@/modules/shop-variations/lib/variants-service'
import { getLinksForProduct } from '@/modules/product-addons-for-shop/lib/db/links'
import { getPadSettings } from '@/modules/product-addons-for-shop/lib/db/settings'
import { isAddonOutOfStock } from '@/modules/product-addons-for-shop/lib/stock'
import type { PadAddonPayload, PadBoxPayload, PadLink } from '@/modules/product-addons-for-shop/lib/types'

// Builds the storefront payload for one main product: its enabled links, each
// add-on's own selector payload (options, values, variant prices - the same
// data its own page runs on), and the chain beneath it. Chains are resolved to
// a fixed depth with a visited set: the save-time cycle guard should make the
// set redundant, but a page render must not be the thing that finds out it was
// not. A link marked `hideChildAddons` ends its branch there by design, which
// is what allows two products to be add-ons of each other.
//
// Returns null when the product has no usable add-ons at all - the tab
// provider reads that as "no tab", the box as "render nothing".

const MAX_CHAIN_DEPTH = 3

async function buildAddon(link: PadLink, visited: Set<string>, depth: number): Promise<PadAddonPayload | null> {
  if (depth > MAX_CHAIN_DEPTH || visited.has(link.addonProductId)) return null

  const [productsById, selector] = await Promise.all([
    getProductsByIds([link.addonProductId]),
    getVariantSelectorPayload(link.addonProductId),
  ])
  const product = productsById.get(link.addonProductId)
  // An add-on must be a live, visible listing to be offered: a draft, archived
  // or hidden product silently drops out, exactly as it would 404 on its own.
  if (!product || product.status !== 'ACTIVE' || product.catalogueHidden) return null
  if (!selector) return null
  // Required personalisation cannot be filled from the box (v1), so a product
  // carrying any is not offered rather than sold incomplete. The admin editor
  // refuses the link too; this is the belt to that brace, for configs that
  // gained a required field after the link was made.
  if (selector.addons.some((a) => a.required)) return null

  const nextVisited = new Set(visited)
  nextVisited.add(link.addonProductId)
  // A link that stops the chain is never asked what the add-on itself offers.
  // That is the whole point of it: a sofa and a coffee table can each be an
  // add-on of the other because neither drags the other's list along behind it.
  const childLinks = link.config.hideChildAddons ? [] : await getLinksForProduct(link.addonProductId, true)
  const children = (
    await Promise.all(childLinks.map((child) => buildAddon(child, nextVisited, depth + 1)))
  ).filter((c): c is PadAddonPayload => c !== null)

  const images = await getPrimaryProductImages([link.addonProductId])
  // An add-on that comes exactly one way has nothing to resolve: no options, no
  // variations. The listing itself is what goes in the basket, priced and
  // stocked from its own row - the same figures its own page prints, tax
  // display and sale price included.
  let plain: PadAddonPayload['plain'] = null
  if (selector.options.length === 0) {
    const [taxDisplay, shopConfig] = await Promise.all([resolveTaxDisplay(), getShopConfigCached()])
    const adjust = makeDisplayAdjuster(taxDisplay, product.taxClassId)
    const price = effectivePrice(product, shopConfig.enabledPriceTypes)
    plain = {
      childProductId: link.addonProductId,
      price: adjust ? adjust(price) : price,
      // Same rule the variant path uses: an untracked line is always buyable,
      // and backorder or pre-order sells past zero deliberately.
      inStock: !product.trackInventory
        || (product.stockCount ?? 0) > 0
        || product.outOfStockBehaviour === 'BACKORDER'
        || product.isPreOrder,
      imageUrls: images[link.addonProductId] ? [images[link.addonProductId]!] : [],
    }
  }
  return {
    linkId: link.id,
    addonProductId: link.addonProductId,
    outOfStock: isAddonOutOfStock({ plain, selector }),
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription ?? null,
    imageUrl: images[link.addonProductId] ?? null,
    modelContextKey: link.modelContextKey,
    plannerStandalone: link.plannerStandalone,
    config: link.config,
    selector,
    plain,
    children,
  }
}

// Sold-out add-ons, and any accessories hanging beneath them, taken out
// altogether - what a shopper is handed. A child of a dropped add-on goes with
// its parent whether it has stock or not: there is nothing left to attach it to.
function withoutSoldOut(list: PadAddonPayload[]): PadAddonPayload[] {
  return list
    .filter((a) => !a.outOfStock)
    .map((a) => ({ ...a, children: withoutSoldOut(a.children) }))
}

export async function buildBoxPayload(productId: string): Promise<PadBoxPayload | null> {
  const links = await getLinksForProduct(productId, true)
  if (links.length === 0) return null

  const visited = new Set<string>([productId])
  const [addons, mainOptions, settings, config, mainProducts, staffView] = await Promise.all([
    Promise.all(links.map((link) => buildAddon(link, visited, 1))),
    getOptionsWithValues(productId),
    getPadSettings(),
    getShopConfigCached(),
    getProductsByIds([productId]),
    canSeeStockLevels(),
  ])
  const built = addons.filter((a): a is PadAddonPayload => a !== null)
  // A shopper is only offered what can actually be sent; staff see the lot, with
  // the sold-out ones badged and their buy buttons shut. Every add-on gone that
  // way is the same as none at all - no box, no tab.
  const usable = staffView ? built : withoutSoldOut(built)
  if (usable.length === 0) return null

  return {
    productId,
    productName: mainProducts.get(productId)?.name ?? '',
    mainOptions,
    nounSingular: settings.nounSingular,
    nounPlural: settings.nounPlural,
    addons: usable,
    priceSuffix: usable[0]?.selector.priceSuffix ?? '',
    currencySymbol: config.currencySymbol,
    staffView,
    // Resolved here because only the server can ask the shop where its product
    // pages live, and the box's own "View product" link would otherwise guess
    // at an address that does not exist on a shop serving products off the root.
    productUrlStyle: config.productUrlStyle,
  }
}
