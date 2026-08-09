// Editor half of the hand-placed showcase block: static sample cards, inert.
import { AddonsShowcase, type ShowcasePayload } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'

const SAMPLE: ShowcasePayload = {
  nounPlural: 'Add-ons',
  cards: [
    { linkId: 's1', name: 'Matching bench screen', slug: '#', shortDescription: 'Keeps calls out and concentration in.', imageUrl: null, fromPriceFormatted: 'From £89.00' },
    { linkId: 's2', name: 'Telescopic cable tray', slug: '#', shortDescription: 'Somewhere respectable for the spaghetti.', imageUrl: null, fromPriceFormatted: 'From £39.00' },
  ],
}

export function ShopAddonsShowcaseEditor() {
  return <AddonsShowcase payload={SAMPLE} preview />
}

export const shopAddonsShowcasePuckComponent = {
  label: 'Shop: Add-ons showcase',
  fields: {},
  defaultProps: {},
  render: ShopAddonsShowcaseEditor,
}
