// Storefront half of the hand-placed showcase block. Renders only when the
// owner has chosen the BLOCK surface (the automatic tab stands down there and
// this stands down when the tab is on duty - one showcase, never two).
import { currentProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import { getProductBySlug } from '@/modules/shop/lib/db/products'
import { buildShowcasePayload } from '@/modules/product-addons-for-shop/lib/showcase-payload'
import { AddonsShowcase } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'
import { shopAddonsShowcasePuckComponent } from '@/modules/product-addons-for-shop/components/puck/ShopAddonsShowcase'

async function ShopAddonsShowcaseRsc() {
  const slug = currentProductSlug()
  if (!slug) return null
  const product = await getProductBySlug(slug)
  if (!product) return null
  const payload = await buildShowcasePayload(product.id)
  if (!payload || payload.surface !== 'BLOCK' || payload.cards.length === 0) return null
  return <AddonsShowcase payload={payload} />
}

export const shopAddonsShowcasePuckRscComponent = {
  ...shopAddonsShowcasePuckComponent,
  render: ShopAddonsShowcaseRsc,
}
