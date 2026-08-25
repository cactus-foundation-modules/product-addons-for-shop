// The add-on selection <-> query-string codec, so a shopper's ticked add-ons
// travel with a shared product link the same way the main product's option
// picks do (shop-variations writes those; this module writes its own).
//
// Format: one `pad` parameter per enabled add-on, dot-joined:
//   pad=<addonKey>[.<valueKey>...][.q<qty>]
// - The add-on key names the accessory (its product slug, e.g.
//   `impulse-desk-high-3-drawer-office-pedestal`), the value keys are the
//   shopper's own picks on that add-on's options (value slugs, e.g. `80cm`),
//   and a final `q<digits>` segment carries an overridden quantity. Readable by
//   design: these URLs get shared, pasted into emails and read out over the
//   phone, and a row of uuids helps nobody.
// - Keys fall back to ids where a slug cannot say which thing is meant: two
//   links to the same add-on product on one page, or one value slug appearing
//   on two of an add-on's options. The caller decides that (it is the side
//   holding the payload); this file just carries whatever key it is handed.
// - Links shared before slugs went in carry link ids and value ids in exactly
//   those positions, so they still decode - the reader resolves a key as an id
//   first, then as a slug.
// - Dots are safe separators: slugs and ids are letters, digits and hyphens
//   only.
//
// Decoding is fail-safe by construction: an unknown add-on key, a foreign value
// key or a mangled segment simply restores nothing, never guesses.
export const PAD_URL_PARAM = 'pad'

// A value slug is free to be the word "q" and a number, which is exactly what
// the quantity segment looks like. Where one lands last, the encoder writes
// this sentinel behind it so the reader has something else to take as the
// quantity, and reads it back as "no override".
const QTY_SEGMENT = /^q\d+$/
const QTY_NONE = 'q0'

export type PadUrlEntry = {
  // The add-on: its product slug, or its pad_links row id where the slug is
  // ambiguous (or the link predates slugs).
  addonKey: string
  // The shopper's picks: value slugs, or value ids on the same terms.
  valueKeys: string[]
  // Quantity per main unit the shopper set by hand; null = follow the
  // recommendation (which is not worth writing down - it recomputes).
  qty: number | null
}

export function encodePadParam(entry: PadUrlEntry): string {
  const segments = [entry.addonKey, ...entry.valueKeys]
  if (entry.qty != null && Number.isFinite(entry.qty) && entry.qty >= 1) segments.push(`q${Math.floor(entry.qty)}`)
  else if (QTY_SEGMENT.test(segments[segments.length - 1] ?? '') && segments.length > 1) segments.push(QTY_NONE)
  return segments.join('.')
}

export function decodePadParams(values: string[]): PadUrlEntry[] {
  const entries: PadUrlEntry[] = []
  for (const value of values) {
    const segments = value.split('.').filter(Boolean)
    const addonKey = segments.shift()
    if (!addonKey) continue
    let qty: number | null = null
    const lastSegment = segments[segments.length - 1]
    if (lastSegment && QTY_SEGMENT.test(lastSegment)) {
      const parsed = parseInt(lastSegment.slice(1), 10)
      qty = parsed >= 1 ? parsed : null
      segments.pop()
    }
    entries.push({ addonKey, valueKeys: segments, qty })
  }
  return entries
}
