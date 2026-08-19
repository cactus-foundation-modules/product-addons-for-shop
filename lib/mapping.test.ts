import { describe, expect, it } from 'vitest'
import { availableAddonValues, composeContextKey, isAddonApplicable, isAddonValueAvailable, narrowedToSingleValue } from '@/modules/product-addons-for-shop/lib/mapping'
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

// ---------------------------------------------------------------------------
// Visibility conditions. Written for the desk sold with OR without cable ports:
// the power module that drops into a port must not be offered on the version
// that has none.
// ---------------------------------------------------------------------------

const MAIN: SvrOptionWithValues[] = [
  {
    id: 'ports',
    name: 'Cable Port',
    values: [value('p-no', 'without-cable-ports', 'Without cable ports'), value('p-yes', 'with-cable-ports', 'With cable ports')],
  },
  { id: 'depth', name: 'Depth', values: [value('d60', '60cm', '60cm'), value('d80', '80cm', '80cm')] },
] as unknown as SvrOptionWithValues[]

const PORTS_ONLY = [{ mainOption: 'Cable Port', valueSlugs: ['with-cable-ports'] }]

describe('isAddonApplicable', () => {
  it('offers an add-on with no conditions whatever is chosen', () => {
    expect(isAddonApplicable(undefined, MAIN, {})).toBe(true)
    expect(isAddonApplicable([], MAIN, { ports: 'p-no' })).toBe(true)
  })

  it('offers it only on a listed value', () => {
    expect(isAddonApplicable(PORTS_ONLY, MAIN, { ports: 'p-yes' })).toBe(true)
    expect(isAddonApplicable(PORTS_ONLY, MAIN, { ports: 'p-no' })).toBe(false)
  })

  it('offers it while the driving option is unchosen - nothing has been ruled out yet', () => {
    expect(isAddonApplicable(PORTS_ONLY, MAIN, {})).toBe(true)
    expect(isAddonApplicable(PORTS_ONLY, MAIN, { depth: 'd60' })).toBe(true)
  })

  it('matches the option by name, case and spacing aside', () => {
    expect(isAddonApplicable([{ mainOption: ' cable port ', valueSlugs: ['with-cable-ports'] }], MAIN, { ports: 'p-yes' })).toBe(true)
  })

  it('ignores a condition nobody has ticked a value on', () => {
    expect(isAddonApplicable([{ mainOption: 'Cable Port', valueSlugs: [] }], MAIN, { ports: 'p-no' })).toBe(true)
    expect(isAddonApplicable([{ mainOption: 'Cable Port', valueSlugs: ['  '] }], MAIN, { ports: 'p-no' })).toBe(true)
  })

  it('holds it back when the named option has gone - a broken condition, not a shopper’s choice', () => {
    expect(isAddonApplicable([{ mainOption: 'Cable Ports', valueSlugs: ['with-cable-ports'] }], MAIN, { ports: 'p-yes' })).toBe(false)
  })

  it('passes any one of a rule’s values, and every rule', () => {
    const either = [{ mainOption: 'Depth', valueSlugs: ['60cm', '80cm'] }]
    expect(isAddonApplicable(either, MAIN, { depth: 'd80' })).toBe(true)
    const both = [...PORTS_ONLY, ...either]
    expect(isAddonApplicable(both, MAIN, { ports: 'p-yes', depth: 'd60' })).toBe(true)
    expect(isAddonApplicable(both, MAIN, { ports: 'p-no', depth: 'd60' })).toBe(false)
    // Half-answered: the port rule passes, the depth rule has ruled nothing out.
    expect(isAddonApplicable(both, MAIN, { ports: 'p-yes' })).toBe(true)
    // One incompatible answer is enough, whatever the other rules say.
    expect(isAddonApplicable(both, MAIN, { ports: 'p-no' })).toBe(false)
  })
})


// ---------------------------------------------------------------------------
// One of the add-on's OWN choices taken off the menu, rather than the whole
// add-on: the 80cm-deep pedestal on a desk with no 800-deep run to butt it to.
// ---------------------------------------------------------------------------

const DESK: SvrOptionWithValues[] = [
  {
    id: 'width',
    name: 'Width',
    values: [value('w120', '120cm', '120cm'), value('w140', '140cm', '140cm'), value('w160', '160cm', '160cm')],
  },
] as unknown as SvrOptionWithValues[]

const PED_DEPTH = {
  id: 'pdepth',
  name: 'Depth',
  values: [value('p60', '60cm', '60cm'), value('p80', '80cm', '80cm')],
} as unknown as SvrOptionWithValues

const BIG_ONLY = [{ addonOption: 'Depth', addonValueSlugs: ['80cm'], mainOption: 'Width', mainValueSlugs: ['140cm', '160cm'] }]

describe('isAddonValueAvailable', () => {
  it('offers every value when nothing governs it', () => {
    expect(isAddonValueAvailable(undefined, 'Depth', '80cm', DESK, { width: 'w120' })).toBe(true)
    expect(isAddonValueAvailable([], 'Depth', '80cm', DESK, { width: 'w120' })).toBe(true)
  })

  it('rules a value out only on a main value outside the list', () => {
    expect(isAddonValueAvailable(BIG_ONLY, 'Depth', '80cm', DESK, { width: 'w140' })).toBe(true)
    expect(isAddonValueAvailable(BIG_ONLY, 'Depth', '80cm', DESK, { width: 'w120' })).toBe(false)
  })

  it('leaves the values it does not name alone', () => {
    expect(isAddonValueAvailable(BIG_ONLY, 'Depth', '60cm', DESK, { width: 'w120' })).toBe(true)
  })

  it('rules nothing out while the driving option is unchosen', () => {
    expect(isAddonValueAvailable(BIG_ONLY, 'Depth', '80cm', DESK, {})).toBe(true)
  })

  it('ignores a half-filled rule', () => {
    const empty = [{ addonOption: 'Depth', addonValueSlugs: ['80cm'], mainOption: 'Width', mainValueSlugs: [] }]
    expect(isAddonValueAvailable(empty, 'Depth', '80cm', DESK, { width: 'w120' })).toBe(true)
    const noValues = [{ addonOption: 'Depth', addonValueSlugs: [], mainOption: 'Width', mainValueSlugs: ['140cm'] }]
    expect(isAddonValueAvailable(noValues, 'Depth', '80cm', DESK, { width: 'w120' })).toBe(true)
  })

  it('holds the value back when the named main option has gone', () => {
    const broken = [{ addonOption: 'Depth', addonValueSlugs: ['80cm'], mainOption: 'Widths', mainValueSlugs: ['140cm'] }]
    expect(isAddonValueAvailable(broken, 'Depth', '80cm', DESK, { width: 'w140' })).toBe(false)
  })

  it('matches both option names by name, case and spacing aside', () => {
    const loose = [{ addonOption: ' depth ', addonValueSlugs: ['80cm'], mainOption: ' width ', mainValueSlugs: ['140cm'] }]
    expect(isAddonValueAvailable(loose, 'Depth', '80cm', DESK, { width: 'w120' })).toBe(false)
    expect(isAddonValueAvailable(loose, 'Depth', '80cm', DESK, { width: 'w140' })).toBe(true)
  })

  it('leaves an option of a different name untouched', () => {
    expect(isAddonValueAvailable(BIG_ONLY, 'Finish', '80cm', DESK, { width: 'w120' })).toBe(true)
  })
})

describe('availableAddonValues', () => {
  it('hands back the option’s own list when no rule applies', () => {
    expect(availableAddonValues(undefined, PED_DEPTH, DESK, { width: 'w120' })).toBe(PED_DEPTH.values)
  })

  it('drops only the ruled-out value', () => {
    expect(availableAddonValues(BIG_ONLY, PED_DEPTH, DESK, { width: 'w120' }).map((v) => v.slug)).toEqual(['60cm'])
    expect(availableAddonValues(BIG_ONLY, PED_DEPTH, DESK, { width: 'w160' }).map((v) => v.slug)).toEqual(['60cm', '80cm'])
  })

  it('can empty an option outright, which the box reads as unavailable', () => {
    const none = [{ addonOption: 'Depth', addonValueSlugs: ['60cm', '80cm'], mainOption: 'Width', mainValueSlugs: ['140cm'] }]
    expect(availableAddonValues(none, PED_DEPTH, DESK, { width: 'w120' })).toEqual([])
  })
})

describe('narrowedToSingleValue', () => {
  it('names the last choice standing, so the box can settle it', () => {
    expect(narrowedToSingleValue(BIG_ONLY, PED_DEPTH, DESK, { width: 'w120' })?.slug).toBe('60cm')
  })

  it('settles nothing while more than one choice is left', () => {
    expect(narrowedToSingleValue(BIG_ONLY, PED_DEPTH, DESK, { width: 'w140' })).toBeNull()
    expect(narrowedToSingleValue(BIG_ONLY, PED_DEPTH, DESK, {})).toBeNull()
  })

  it('settles nothing when no rule applies at all', () => {
    expect(narrowedToSingleValue(undefined, PED_DEPTH, DESK, { width: 'w120' })).toBeNull()
    expect(narrowedToSingleValue([], PED_DEPTH, DESK, { width: 'w120' })).toBeNull()
  })

  it('leaves an option that always had one value exactly as it was', () => {
    const single = { id: 'only', name: 'Depth', values: [value('p60', '60cm', '60cm')] } as unknown as SvrOptionWithValues
    expect(narrowedToSingleValue(BIG_ONLY, single, DESK, { width: 'w120' })).toBeNull()
  })

  it('settles nothing when the rules have ruled every choice out', () => {
    const none = [{ addonOption: 'Depth', addonValueSlugs: ['60cm', '80cm'], mainOption: 'Width', mainValueSlugs: ['140cm'] }]
    expect(narrowedToSingleValue(none, PED_DEPTH, DESK, { width: 'w120' })).toBeNull()
  })
})
