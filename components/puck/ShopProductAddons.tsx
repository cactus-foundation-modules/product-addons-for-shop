// The editor half of the add-ons box block. Static, inert preview - the real
// payload needs the database, and the editor canvas gets none of it. Markup
// mirrors the live box's shell so the layout reads true in the editor.
import { AddonsBox } from '@/modules/product-addons-for-shop/components/public/AddonsBox'
import type { PadBoxPayload } from '@/modules/product-addons-for-shop/lib/types'

const SAMPLE: PadBoxPayload = {
  productId: 'sample',
  productName: 'Sample product',
  mainOptions: [],
  nounSingular: 'Add-on',
  nounPlural: 'Add-ons',
  priceSuffix: '',
  currencySymbol: '£',
  staffView: false,
  addons: [
    {
      linkId: 'sample-1',
      addonProductId: 'sample-1',
      name: 'Matching bench screen',
      slug: '#',
      shortDescription: null,
      imageUrl: null,
      modelContextKey: '',
      plannerStandalone: true,
      config: { optionMappings: [], quantity: { mode: 'recommended', base: 1 } },
      selector: {
        productId: 'sample-1', productName: 'Matching bench screen', basePrice: 89,
        baseImages: [], options: [], variants: [], addons: [],
      },
      plain: null,
      outOfStock: false,
      children: [],
    },
  ],
}

export function ShopProductAddonsEditor() {
  return <AddonsBox payload={SAMPLE} preview />
}

export const shopProductAddonsPuckComponent = {
  label: 'Shop: Product add-ons',
  fields: {},
  defaultProps: {},
  render: ShopProductAddonsEditor,
}
