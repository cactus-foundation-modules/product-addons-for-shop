// Domain types for product-addons-for-shop. The stored config references
// shop-variations options and values BY SLUG (and option NAME), never by id: a
// catalogue re-import (the Google Sheet pull, a CSV round-trip) regenerates ids
// wholesale, and a config keyed on them would break silently. Slugs and names
// survive those; where they too have changed, the admin coverage check says so
// out loud instead of the storefront guessing.

import type { SvrOptionWithValues, VariantSelectorPayload } from '@/modules/shop-variations/lib/types'
import type { ProductUrlStyle } from '@/modules/shop/lib/product-url'

// How one of the add-on product's options gets its value when the add-on is
// bought from the main product's page:
//   'match'  - derived from a main option, hidden from the shopper (a screen's
//              width follows the desk's width).
//   'default'- pre-selected from a main option, shown and overridable (a
//              screen's frame colour defaults to the desk's).
//   'choose' - the shopper picks in the add-on's own row (the screen's fabric).
//   'fixed'  - pinned to one value by the admin, hidden.
//   'recommend' - pre-selected to one value by the admin, shown and overridable
//              (the admin's pick rather than a main option's; a recommendation,
//              not a rule). A recommended value that has since vanished from
//              the product degrades to a plain shopper choice.
export type PadMappingMode = 'match' | 'default' | 'choose' | 'fixed' | 'recommend'

export type PadOptionMapping = {
  // The add-on product's option, by NAME (unique per product in shop-variations).
  addonOption: string
  mode: PadMappingMode
  // For match/default: the main product's option name the value derives from.
  mainOption?: string
  // For match/default: explicit value translations, main value slug -> add-on
  // value slug, for the cases automatic matching gets wrong. Consulted first;
  // anything not listed falls back to automatic matching (shared source_ref,
  // then equal slug, then equal label, case-insensitive).
  valueMap?: Record<string, string>
  // For fixed/recommend: the admin-picked value's slug. Shared so switching a
  // rule between the two modes keeps the picked value.
  fixedValueSlug?: string
}

// How many of the add-on one main unit wants.
//   'recommended' - base × (per-main-value multiplier) × main quantity, offered
//                   as the pre-filled quantity with a gentle note when changed.
//   'free'        - the shopper decides outright; the stepper starts at 1 and
//                   no recommendation is voiced.
export type PadQuantityRule = {
  mode: 'recommended' | 'free'
  base?: number
  // Option NAME on the main product whose chosen value scales the count
  // (e.g. Seats), with per-value-slug multipliers (e.g. {'2-person':1,
  // '4-person':2,'6-person':3}). Both optional; absent means base alone.
  perOption?: string
  perValue?: Record<string, number>
  // Optional owner wording replacing the auto-built recommendation note.
  note?: string
}

// A condition on the MAIN product's options that has to hold before the add-on
// is offered at all. A desk sold with OR without cable ports has nothing to put
// a power module into when the shopper picks "without": the module is not the
// wrong colour there, it is not applicable, and an accessory that cannot be
// used should not be on the page tempting anyone.
//
// This is deliberately not another mapping mode. A mapping decides what an
// add-on's own option settles on once the add-on is being offered; this decides
// whether it is offered, which is a question about the main product alone.
export type PadShowWhenRule = {
  // The main product's option, by NAME (as everywhere else in this config).
  mainOption: string
  // The value SLUGS on that option that make the add-on applicable. Empty means
  // the rule was never finished in the editor, and it is ignored rather than
  // quietly hiding the add-on everywhere.
  valueSlugs: string[]
}

// A condition on the MAIN product's options that decides whether ONE OF THE
// ADD-ON'S OWN VALUES is on the menu, rather than whether the add-on is.
//
// An 80cm-deep pedestal butts the end of an 800-deep desk run. On a 120cm square
// corner desk both arms are 600 deep, so there is nothing for it to butt - but the
// 60cm one is fine there, and the pedestal itself is very much wanted. Hiding the
// whole accessory would be wrong and offering a size that cannot be fitted would be
// worse, so the size alone comes off the menu.
//
// Same polarity as `showWhen`, and for the same reason: the value is offered UNLESS
// RULED OUT. A rule whose main option is still unchosen has ruled nothing out.
export type PadValueShowWhenRule = {
  // The add-on product's option, by NAME.
  addonOption: string
  // The value SLUGS on that option this rule governs. Empty means the rule was
  // never finished in the editor, and it is ignored.
  addonValueSlugs: string[]
  // The main product's option, by NAME.
  mainOption: string
  // The value SLUGS on the main option that keep those add-on values on offer.
  // Empty is likewise an unfinished rule.
  mainValueSlugs: string[]
}

export type PadLinkConfig = {
  optionMappings: PadOptionMapping[]
  quantity: PadQuantityRule
  // Add-on option NAMES whose chosen value extends the 3D context key, in the
  // order they should appear. A pedestal linked with the key `pedestal` and
  // this set to ['Width'] announces `pedestal-30cm` or `pedestal-39cm`, so the
  // desk's combined model can change with the width the shopper picks - one
  // key could only ever show one size, whichever one was modelled.
  //
  // Empty (the usual case) keeps the bare key, exactly as before. Matching
  // stays exact-or-base at the far end: a width nobody has built a file for
  // falls back to the plain desk rather than showing the wrong size.
  modelContextOptions?: string[]
  // Conditions on the main product's options that all have to pass for the
  // add-on to be offered. Rules are ANDed; the values inside one rule are ORed.
  //
  // Offered UNLESS RULED OUT: an accessory belongs on the page from the off,
  // and a condition is there to take it away again when the shopper picks
  // something it cannot work with. A rule whose option is still unchosen has
  // ruled nothing out, so it passes. Absent (the usual case) means the add-on
  // is offered unconditionally, exactly as before conditions existed.
  showWhen?: PadShowWhenRule[]
  // Conditions on the main product's options that decide which of the ADD-ON'S OWN
  // values are on the menu. `showWhen` takes the whole accessory away; this takes
  // one of its sizes away and leaves the rest, for the case where the accessory
  // fits perfectly well - just not in that size.
  //
  // Rules are ANDed per value, the main values inside one rule are ORed, and a
  // value nobody has written a rule about is always offered. An option every one
  // of whose values is ruled out makes the add-on unavailable for that
  // configuration, said out loud, rather than silently emptying the row.
  valueShowWhen?: PadValueShowWhenRule[]
}

export type PadLink = {
  id: string
  productId: string
  addonProductId: string
  enabled: boolean
  position: number
  modelContextKey: string
  plannerStandalone: boolean
  config: PadLinkConfig
}

export type PadSettings = {
  nounSingular: string
  nounPlural: string
  showcaseSurface: 'TAB' | 'BLOCK' | 'NONE'
}

export const PAD_DEFAULT_SETTINGS: PadSettings = {
  nounSingular: 'Add-on',
  nounPlural: 'Add-ons',
  showcaseSurface: 'TAB',
}

// ---------------------------------------------------------------------------
// The storefront payload: everything the add-ons box (and the showcase) needs
// about one main product's add-ons, resolved server-side in one go.
// ---------------------------------------------------------------------------

export type PadAddonPayload = {
  linkId: string
  addonProductId: string
  name: string
  slug: string
  shortDescription: string | null
  imageUrl: string | null
  modelContextKey: string
  plannerStandalone: boolean
  config: PadLinkConfig
  // The add-on's own selector payload - options, values (with swatches), the
  // variant price matrix, personalisation fields - exactly what its own page
  // uses, so the box resolves combinations and prices with the same maths.
  selector: VariantSelectorPayload
  // The listing itself as the thing bought, for an add-on with no options at
  // all - a cable tray that comes one way. There is no combination to resolve
  // on such a product (the selector has no options and no variations, so the
  // selection maths correctly resolves nothing), and without this the box could
  // only ever say the combination was unavailable. Null whenever the add-on has
  // options, where a variation is what gets bought.
  plain: { childProductId: string; price: number; inStock: boolean; imageUrls: string[] } | null
  // Whether the add-on has run dry altogether - nothing of it left to sell (see
  // lib/stock.ts). A shopper never sees one of these at all: the server drops it
  // from the payload before it leaves. Staff do, badged and unbuyable, so the
  // owner can see the sold-out accessory rather than wonder where it went.
  outOfStock: boolean
  // Nested add-ons of this add-on (an accessory's own accessories), one level
  // per hop. Cycle-guarded at link save AND at read (belt and braces), so a
  // malicious row cannot hang the page.
  children: PadAddonPayload[]
}

export type PadBoxPayload = {
  // The main (parent) product the links hang off.
  productId: string
  // Its display name - what add-on lines say they are "for".
  productName: string
  // The main product's own options, for mapping resolution in the browser.
  mainOptions: SvrOptionWithValues[]
  // The owner's noun for the whole surface ("Accessories").
  nounSingular: string
  nounPlural: string
  addons: PadAddonPayload[]
  // Price display suffix, mirrored from the selector payloads ("inc. VAT").
  priceSuffix: string
  currencySymbol: string
  // Whether the person looking is staff (shop's own canSeeStockLevels). Decides
  // whether sold-out add-ons appear at all and whether a sold-out choice can be
  // clicked - resolved per request on the server, so it cannot be forged from
  // the browser or served to a shopper out of a shared cache.
  staffView: boolean
  // Where the shop's product pages live, so the box can link to an add-on's own
  // page. Optional: a payload serialised before this shipped carries no such
  // key, which reads as the default /shop/products/<slug> style.
  productUrlStyle?: ProductUrlStyle
}

// ---------------------------------------------------------------------------
// Cart-line meta shapes. `productAddons` is this module's namespaced key in the
// line meta bag (svr's personalisation uses `addons`; the two never collide).
// ---------------------------------------------------------------------------

export type PadMainLineMeta = {
  group: string
  role: 'main'
}

export type PadAddonLineMeta = {
  group: string
  role: 'addon'
  linkId: string
  // The main line's product (the exact variant child added), for validation.
  forProductId: string
  // What the add-on is attached to, as the shopper should read it.
  forLabel: string
  // Chain depth: 1 = attached to the main product, 2 = attached to an add-on.
  depth: number
  // Display order within the group (link position, chain-major).
  order: number
  // The recommended quantity per one main line unit at add time, and which rule
  // produced it - so the cart resolver can restate the recommendation when the
  // quantities drift. Absent for a free-quantity add-on, which recommends nothing.
  recommendedPerUnit?: number
  recommendedNote?: string
}

export type PadLineMeta = PadMainLineMeta | PadAddonLineMeta

export const PAD_META_KEY = 'productAddons'
