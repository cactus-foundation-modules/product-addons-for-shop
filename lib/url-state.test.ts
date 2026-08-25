import { describe, expect, it } from 'vitest'
import { decodePadParams, encodePadParam } from '@/modules/product-addons-for-shop/lib/url-state'

// The codec that puts a shopper's ticked add-ons into a shareable link. Keys
// are words (product slug, value slugs) so the link reads as English; ids in
// the same positions still decode, which is what keeps links shared before the
// slugs went in working.

describe('encodePadParam', () => {
  it('writes the add-on and its picks as one dot-joined parameter', () => {
    expect(encodePadParam({ addonKey: 'impulse-3-drawer-pedestal', valueKeys: ['80cm', 'maple'], qty: null }))
      .toBe('impulse-3-drawer-pedestal.80cm.maple')
  })

  it('appends a hand-set quantity', () => {
    expect(encodePadParam({ addonKey: 'cable-tray', valueKeys: [], qty: 3 })).toBe('cable-tray.q3')
  })

  it('leaves a followed recommendation out - it recomputes', () => {
    expect(encodePadParam({ addonKey: 'cable-tray', valueKeys: [], qty: null })).toBe('cable-tray')
  })

  it('ignores a nonsense quantity rather than writing one', () => {
    expect(encodePadParam({ addonKey: 'cable-tray', valueKeys: [], qty: 0 })).toBe('cable-tray')
    expect(encodePadParam({ addonKey: 'cable-tray', valueKeys: [], qty: Number.NaN })).toBe('cable-tray')
  })

  it('guards a trailing value slug that looks like a quantity', () => {
    // A value legitimately slugged "q4" would otherwise be eaten as the
    // quantity on the way back in, so a sentinel goes behind it.
    const encoded = encodePadParam({ addonKey: 'pedestal', valueKeys: ['80cm', 'q4'], qty: null })
    expect(encoded).toBe('pedestal.80cm.q4.q0')
    expect(decodePadParams([encoded])).toEqual([{ addonKey: 'pedestal', valueKeys: ['80cm', 'q4'], qty: null }])
  })
})

describe('decodePadParams', () => {
  it('reads back what it wrote', () => {
    const entry = { addonKey: 'impulse-3-drawer-pedestal', valueKeys: ['80cm', 'maple'], qty: 2 }
    expect(decodePadParams([encodePadParam(entry)])).toEqual([entry])
  })

  it('reads a link shared before slugs, ids and all', () => {
    expect(decodePadParams(['f50d3843-d2f6-4333-b2f1-a5041ffe428e.54539bd1-b420-4d2b-bba2-db1c5634df94'])).toEqual([
      { addonKey: 'f50d3843-d2f6-4333-b2f1-a5041ffe428e', valueKeys: ['54539bd1-b420-4d2b-bba2-db1c5634df94'], qty: null },
    ])
  })

  it('takes one parameter per ticked add-on', () => {
    expect(decodePadParams(['pedestal.80cm', 'screen.grey.q2'])).toEqual([
      { addonKey: 'pedestal', valueKeys: ['80cm'], qty: null },
      { addonKey: 'screen', valueKeys: ['grey'], qty: 2 },
    ])
  })

  it('restores nothing from a mangled parameter rather than guessing', () => {
    expect(decodePadParams([''])).toEqual([])
    expect(decodePadParams(['...'])).toEqual([])
  })

  it('reads the sentinel quantity as no override', () => {
    expect(decodePadParams(['pedestal.80cm.q0'])).toEqual([{ addonKey: 'pedestal', valueKeys: ['80cm'], qty: null }])
  })
})
