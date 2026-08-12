import { describe, expect, it } from 'vitest'
import { composeContextKey } from '@/modules/product-addons-for-shop/lib/mapping'
import type { SvrOptionWithValues } from '@/modules/shop-variations/lib/types'

// The 3D context key an add-on announces. The case this was written for is a
// pedestal offered in two widths under one desk: one key could only ever show
// whichever width somebody had modelled, so the chosen value extends it.

const value = (id: string, slug: string, label: string) =>
  ({ id, slug, label, optionId: 'width', position: 0, swatch: null, sourceRef: null }) as unknown as SvrOptionWithValues['values'][number]

const OPTIONS: SvrOptionWithValues[] = [
  { id: 'width', name: 'Width', values: [value('w30', '30cm', '30cm'), value('w39', '39cm', '39cm')] },
  { id: 'finish', name: 'Finish', values: [value('f1', 'white', 'White')] },
] as unknown as SvrOptionWithValues[]

describe('composeContextKey', () => {
  it('leaves a key alone when no options extend it', () => {
    expect(composeContextKey('pedestal', undefined, OPTIONS, { width: 'w30' })).toBe('pedestal')
    expect(composeContextKey('pedestal', [], OPTIONS, { width: 'w30' })).toBe('pedestal')
  })

  it('appends the chosen value of each nominated option, in the order given', () => {
    expect(composeContextKey('pedestal', ['Width'], OPTIONS, { width: 'w39' })).toBe('pedestal-39cm')
    expect(composeContextKey('pedestal', ['Width', 'Finish'], OPTIONS, { width: 'w30', finish: 'f1' }))
      .toBe('pedestal-30cm-white')
  })

  it('matches the option by name, case and spacing aside', () => {
    expect(composeContextKey('pedestal', [' width '], OPTIONS, { width: 'w30' })).toBe('pedestal-30cm')
  })

  it('announces nothing when a nominated option is unsettled or has gone', () => {
    // Nothing is better than the bare key here: matching is exact-or-base at the
    // far end, so the bare key would show a size the shopper did not ask for.
    expect(composeContextKey('pedestal', ['Width'], OPTIONS, {})).toBeNull()
    expect(composeContextKey('pedestal', ['Depth'], OPTIONS, { width: 'w30' })).toBeNull()
  })

  it('announces nothing without a key of its own', () => {
    expect(composeContextKey('', ['Width'], OPTIONS, { width: 'w30' })).toBeNull()
    expect(composeContextKey('  ', undefined, OPTIONS, {})).toBeNull()
  })

  it('reduces a value to what a context key may hold', () => {
    const odd = [{ id: 'width', name: 'Width', values: [value('w1', 'Two Drawer / Deep', 'Two Drawer / Deep')] }] as unknown as SvrOptionWithValues[]
    expect(composeContextKey('ped', ['Width'], odd, { width: 'w1' })).toBe('ped-two-drawer-deep')
  })
})
