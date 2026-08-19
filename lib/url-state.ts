// The add-on selection <-> query-string codec, so a shopper's ticked add-ons
// travel with a shared product link the same way the main product's option
// picks do (shop-variations writes those; this module writes its own).
//
// Format: one `pad` parameter per enabled add-on, dot-joined:
//   pad=<linkId>[.<valueId>...][.q<qty>]
// - linkId names the pad_links row (unique across the whole chain, children
//   included), value ids are the shopper's own picks on that add-on's options,
//   and a final `q<digits>` segment carries an overridden quantity. All three
//   are ids rather than slugs because an add-on's option values are resolved
//   against ITS product's options, and only ids are unambiguous there.
// - Dots are safe separators: link and value ids are cuids (letters and
//   digits only), and `q<digits>` can never be one.
//
// Decoding is fail-safe by construction: an unknown link id, a foreign value
// id or a mangled segment simply restores nothing, never guesses.
export const PAD_URL_PARAM = 'pad'

export type PadUrlEntry = {
  linkId: string
  valueIds: string[]
  // Quantity per main unit the shopper set by hand; null = follow the
  // recommendation (which is not worth writing down - it recomputes).
  qty: number | null
}

export function encodePadParam(entry: PadUrlEntry): string {
  const segments = [entry.linkId, ...entry.valueIds]
  if (entry.qty != null && Number.isFinite(entry.qty) && entry.qty >= 1) segments.push(`q${Math.floor(entry.qty)}`)
  return segments.join('.')
}

export function decodePadParams(values: string[]): PadUrlEntry[] {
  const entries: PadUrlEntry[] = []
  for (const value of values) {
    const segments = value.split('.').filter(Boolean)
    const linkId = segments.shift()
    if (!linkId) continue
    let qty: number | null = null
    const lastSegment = segments[segments.length - 1]
    if (lastSegment && /^q\d+$/.test(lastSegment)) {
      qty = Math.max(1, parseInt(lastSegment.slice(1), 10))
      segments.pop()
    }
    entries.push({ linkId, valueIds: segments, qty })
  }
  return entries
}
