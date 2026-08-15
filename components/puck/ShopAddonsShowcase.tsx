// Editor half of the hand-placed showcase block: static sample cards, inert.
import { AddonsShowcase, type ShowcasePayload } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'

const SAMPLE: ShowcasePayload = {
  nounPlural: 'Add-ons',
  cards: [
    { linkId: 's1', name: 'Matching bench screen', slug: '#', shortDescription: 'Keeps calls out and concentration in.', imageUrl: null, fromPriceFormatted: 'From £89.00' },
    { linkId: 's2', name: 'Telescopic cable tray', slug: '#', shortDescription: 'Somewhere respectable for the spaghetti.', imageUrl: null, fromPriceFormatted: 'From £39.00' },
  ],
}

export type ShopAddonsShowcaseProps = {
  // Blank keeps the name from Add-ons settings, which is what it always used.
  heading?: string
  // 0 or blank means every card the product has, which is the old behaviour.
  // A product with a dozen accessories can otherwise bury the page it is on.
  maxCards?: number
}

export function ShopAddonsShowcaseEditor(props: ShopAddonsShowcaseProps) {
  const cap = Math.max(0, Math.floor(Number(props.maxCards)) || 0)
  const payload: ShowcasePayload = {
    ...SAMPLE,
    ...(props.heading?.trim() ? { nounPlural: props.heading.trim() } : null),
    ...(cap > 0 ? { cards: SAMPLE.cards.slice(0, cap) } : null),
  }
  return <AddonsShowcase payload={payload} preview />
}

export const shopAddonsShowcasePuckComponent = {
  label: 'Shop: Add-ons showcase',
  fields: {
    heading: { type: 'text' as const, label: 'Heading (blank uses the name from Add-ons settings)' },
    maxCards: { type: 'number' as const, label: 'Most cards to show (blank or 0 shows them all)', min: 0, max: 24 },
  },
  defaultProps: { heading: '', maxCards: 0 } as ShopAddonsShowcaseProps,
  render: ShopAddonsShowcaseEditor,
}
