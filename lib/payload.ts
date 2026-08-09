import { getProductsByIds } from '@/modules/shop/lib/db/products'
import { getPrimaryProductImages } from '@/modules/shop/lib/db/products'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getVariantSelectorPayload } from '@/modules/shop-variations/lib/variants-service'
import { getLinksForProduct } from '@/modules/product-addons-for-shop/lib/db/links'
import { getPadSettings } from '@/modules/product-addons-for-shop/lib/db/settings'
import type { PadAddonPayload, PadBoxPayload, PadLink } from '@/modules/product-addons-for-shop/lib/types'

// Builds the storefront payload for one main product: its enabled links, each
// add-on's own selector payload (options, values, variant prices - the same
// data its own page runs on), and the chain beneath it. Chains are resolved to
// a fixed depth with a visited set: the save-time cycle guard should make the
// set redundant, but a page render must not be the thing that finds out it was
// not.
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
  const childLinks = await getLinksForProduct(link.addonProductId, true)
  const children = (
    await Promise.all(childLinks.map((child) => buildAddon(child, nextVisited, depth + 1)))
  ).filter((c): c is PadAddonPayload => c !== null)

  const images = await getPrimaryProductImages([link.addonProductId])
  return {
    linkId: link.id,
    addonProductId: link.addonProductId,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription ?? null,
    imageUrl: images[link.addonProductId] ?? null,
    modelContextKey: link.modelContextKey,
    plannerStandalone: link.plannerStandalone,
    config: link.config,
    selector,
    children,
  }
}

export async function buildBoxPayload(productId: string): Promise<PadBoxPayload | null> {
  const links = await getLinksForProduct(productId, true)
  if (links.length === 0) return null

  const visited = new Set<string>([productId])
  const [addons, mainOptions, settings, config, mainProducts] = await Promise.all([
    Promise.all(links.map((link) => buildAddon(link, visited, 1))),
    getOptionsWithValues(productId),
    getPadSettings(),
    getShopConfigCached(),
    getProductsByIds([productId]),
  ])
  const usable = addons.filter((a): a is PadAddonPayload => a !== null)
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
  }
}
