import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getProductsByIds } from '@/modules/shop/lib/db/products'
import { getAllLinks } from '@/modules/product-addons-for-shop/lib/db/links'

// The admin Overview tab: every link in the catalogue, named at both ends.
export async function GET() {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const links = await getAllLinks()
  const ids = [...new Set(links.flatMap((l) => [l.productId, l.addonProductId]))]
  const products = await getProductsByIds(ids)
  return NextResponse.json({
    links: links.map((link) => ({
      id: link.id,
      enabled: link.enabled,
      modelContextKey: link.modelContextKey,
      productId: link.productId,
      productName: products.get(link.productId)?.name ?? '(deleted product)',
      addonProductId: link.addonProductId,
      addonName: products.get(link.addonProductId)?.name ?? '(deleted product)',
      quantityMode: link.config.quantity.mode,
      mappings: link.config.optionMappings.length,
    })),
  })
}
