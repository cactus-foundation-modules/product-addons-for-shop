// Storefront half of the hand-placed showcase block. Renders only when the
// owner has chosen the BLOCK surface (the automatic tab stands down there and
// this stands down when the tab is on duty - one showcase, never two).
import { currentProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import { getProductBySlugCached } from '@/modules/shop/lib/db/products'
import { buildShowcasePayload } from '@/modules/product-addons-for-shop/lib/showcase-payload'
import { AddonsShowcase } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'
import { shopAddonsShowcasePuckComponent, type ShopAddonsShowcaseProps } from '@/modules/product-addons-for-shop/components/puck/ShopAddonsShowcase'

async function ShopAddonsShowcaseRsc(props: ShopAddonsShowcaseProps) {
  const slug = currentProductSlug()
  if (!slug) return null
  const product = await getProductBySlugCached(slug)
  if (!product) return null
  const payload = await buildShowcasePayload(product.id)
  if (!payload || payload.surface !== 'BLOCK' || payload.cards.length === 0) return null
  const heading = props.heading?.trim()
  const cap = Math.max(0, Math.floor(Number(props.maxCards)) || 0)
  return (
    <AddonsShowcase
      // Whether pictures may be asked for at the size they are drawn. A showcase
      // card is about 305px wide and the pictures on it are routinely 1,700px, so
      // this is the difference between 130 KB and a tenth of that per card. Passed
      // down because AddonsShowcase is a client component and the setting lives in
      // the site config - see lib/media/resize-url.ts.
      resizing={props.puck?.metadata?.imageResizing}
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
