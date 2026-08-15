// The storefront half of the add-ons box block: resolve the page's product,
// build the payload server-side and hand it to the client island - so the box
// is in the first HTML, exactly like the variation controls beside it.
import { currentProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import { getProductBySlug } from '@/modules/shop/lib/db/products'
import { buildBoxPayload } from '@/modules/product-addons-for-shop/lib/payload'
import { AddonsBox } from '@/modules/product-addons-for-shop/components/public/AddonsBox'
import { shopProductAddonsPuckComponent, type ShopProductAddonsProps } from '@/modules/product-addons-for-shop/components/puck/ShopProductAddons'

async function ShopProductAddonsRsc(props: ShopProductAddonsProps) {
  const slug = currentProductSlug()
  if (!slug) return null
  const product = await getProductBySlug(slug)
  if (!product) return null
  const payload = await buildBoxPayload(product.id)
  // A product with no usable add-ons renders nothing at all - placing this
  // block in the shared product layout costs the other products no markup.
  if (!payload) return null
  // The block's own heading wins where one is set; blank falls through to the
  // noun from Add-ons settings, which is what the box has always printed.
  const heading = props.heading?.trim()
  return <AddonsBox payload={heading ? { ...payload, nounPlural: heading } : payload} />
}

export const shopProductAddonsPuckRscComponent = {
  ...shopProductAddonsPuckComponent,
  render: ShopProductAddonsRsc,
}
