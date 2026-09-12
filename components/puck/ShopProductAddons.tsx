// The editor half of the add-ons box block. Static, inert preview - the real
// payload needs the database, and the editor canvas gets none of it. Markup
// mirrors the live box's shell so the layout reads true in the editor.
import { AddonsBox } from '@/modules/product-addons-for-shop/components/public/AddonsBox'
import type { PadBoxPayload, PadSwatchPreviewSetting } from '@/modules/product-addons-for-shop/lib/types'
import { ResponsiveSelectField } from '@/lib/puck/fields/registry'
import type { ImageResizing } from '@/lib/media/resize-url'

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

export type ShopProductAddonsProps = {
  // Blank keeps the heading the module's own settings supply (the add-on noun),
  // which is what the box has always printed. A shop calling them Accessories
  // everywhere but Goes well with here could not say so before.
  heading?: string
  swatchPreview?: PadSwatchPreviewSetting
  // Puck's channel for site-wide values a block cannot fetch itself. Read for
  // `imageResizing`, so the picker's 44px row thumbnails can be asked for at
  // that size rather than at the full storage size.
  puck?: { metadata?: { imageResizing?: ImageResizing } }
}

export function ShopProductAddonsEditor(props: ShopProductAddonsProps) {
  const payload = props.heading?.trim() ? { ...SAMPLE, nounPlural: props.heading.trim() } : SAMPLE
  return <AddonsBox payload={payload} preview swatchPreview={props.swatchPreview} />
}

export const shopProductAddonsPuckComponent = {
  label: 'Shop: Product add-ons',
  fields: {
    heading: { type: 'text' as const, label: 'Heading (blank uses the name from Add-ons settings)' },
    // Per screen size, and set here rather than in Add-ons settings because it is
    // a question about how this page looks, not about what the add-ons are - the
    // same reason and the same control the main product's options carry.
    swatchPreview: {
      type: 'custom' as const,
      label: 'Colour & image previews',
      render: ResponsiveSelectField,
      options: [
        { label: 'Show a bigger look', value: 'show' },
        { label: 'No preview', value: 'hide' },
      ],
    },
  },
  defaultProps: { heading: '', swatchPreview: { desktop: 'show' } } as ShopProductAddonsProps,
  render: ShopProductAddonsEditor,
}
