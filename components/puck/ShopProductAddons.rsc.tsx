// The storefront half of the add-ons box block: resolve the page's product,
// build the payload server-side and hand it to the client island - so the box
// is in the first HTML, exactly like the variation controls beside it.
import { currentProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import { getProductBySlug } from '@/modules/shop/lib/db/products'
import { buildBoxPayload } from '@/modules/product-addons-for-shop/lib/payload'
import { AddonsBox } from '@/modules/product-addons-for-shop/components/public/AddonsBox'
import { shopProductAddonsPuckComponent } from '@/modules/product-addons-for-shop/components/puck/ShopProductAddons'

async function ShopProductAddonsRsc() {
  const slug = currentProductSlug()
  if (!slug) return null
  const product = await getProductBySlug(slug)
  if (!product) return null
  const payload = await buildBoxPayload(product.id)
  // A product with no usable add-ons renders nothing at all - placing this
  // block in the shared product layout costs the other products no markup.
  if (!payload) return null
  return <AddonsBox payload={payload} />
}

export const shopProductAddonsPuckRscComponent = {
  ...shopProductAddonsPuckComponent,
  render: ShopProductAddonsRsc,
}
