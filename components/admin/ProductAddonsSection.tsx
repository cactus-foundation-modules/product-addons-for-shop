import { ProductAddonsEditor } from '@/modules/product-addons-for-shop/components/admin/ProductAddonsEditor'

// The shop.product-editor-sections entry: the Add-ons panel on a product's
// edit screen. Thin server shell - the editor is a client island that owns its
// own fetching, so this section costs the page nothing until it is opened.
export function ProductAddonsSection({ productId }: { productId: string }) {
  return <ProductAddonsEditor productId={productId} />
}
