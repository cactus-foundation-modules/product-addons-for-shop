// Storefront half of the hand-placed showcase block. Renders only when the
// owner has chosen the BLOCK surface (the automatic tab stands down there and
// this stands down when the tab is on duty - one showcase, never two).
import { currentProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import { getProductBySlug } from '@/modules/shop/lib/db/products'
import { buildShowcasePayload } from '@/modules/product-addons-for-shop/lib/showcase-payload'
import { AddonsShowcase } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'
import { shopAddonsShowcasePuckComponent, type ShopAddonsShowcaseProps } from '@/modules/product-addons-for-shop/components/puck/ShopAddonsShowcase'

async function ShopAddonsShowcaseRsc(props: ShopAddonsShowcaseProps) {
  const slug = currentProductSlug()
  if (!slug) return null
  const product = await getProductBySlug(slug)
  if (!product) return null
  const payload = await buildShowcasePayload(product.id)
  if (!payload || payload.surface !== 'BLOCK' || payload.cards.length === 0) return null
  const heading = props.heading?.trim()
  const cap = Math.max(0, Math.floor(Number(props.maxCards)) || 0)
  return (
    <AddonsShowcase
      payload={{
        ...payload,
        ...(heading ? { nounPlural: heading } : null),
        ...(cap > 0 ? { cards: payload.cards.slice(0, cap) } : null),
      }}
    />
  )
}

export const shopAddonsShowcasePuckRscComponent = {
  ...shopAddonsShowcasePuckComponent,
  render: ShopAddonsShowcaseRsc,
}
