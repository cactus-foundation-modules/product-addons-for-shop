// Pure option-mapping and quantity maths, shared verbatim by the storefront box
// (live, in the browser) and the server (payload building, coverage checks).
// Nothing here touches a database or the DOM - it is all lookups over the
// selector payloads both sides already hold.

import type { SvrOptionWithValues, SvrOptionValue } from '@/modules/shop-variations/lib/types'
import type { PadOptionMapping, PadQuantityRule, PadShowWhenRule } from '@/modules/product-addons-for-shop/lib/types'

const norm = (s: string) => s.trim().toLowerCase()

export function findOptionByName(options: SvrOptionWithValues[], name: string | undefined): SvrOptionWithValues | null {
  if (!name) return null
  const wanted = norm(name)
  return options.find((o) => norm(o.name) === wanted) ?? null
}

/**
 * Translate one chosen value of a main option into the matching value of the
 * add-on's option. The explicit map (by slug) wins; then a shared source_ref
 * (both options fed from the same attribute value - the strongest automatic
 * signal); then equal slug; then equal label, case-insensitive. Null when
 * nothing matches - the add-on simply isn't available for that choice, which
 * the coverage check surfaces to the admin.
 */
export function mapValue(
  mainValue: SvrOptionValue,
  addonOption: SvrOptionWithValues,
  mapping: PadOptionMapping,
): SvrOptionValue | null {
  const explicit = mapping.valueMap?.[mainValue.slug]
  if (explicit) {
    const hit = addonOption.values.find((v) => v.slug === explicit)
    if (hit) return hit
    // An explicit translation pointing at a value that no longer exists is a
    // config error, not a licence to guess: fall through to automatic matching
    // so the storefront still works while the coverage check flags it.
  }
  if (mainValue.sourceRef) {
    const bySource = addonOption.values.find((v) => v.sourceRef && v.sourceRef === mainValue.sourceRef)
    if (bySource) return bySource
  }
  const bySlug = addonOption.values.find((v) => v.slug === mainValue.slug)
  if (bySlug) return bySlug
  const byLabel = addonOption.values.find((v) => norm(v.label) === norm(mainValue.label))
  return byLabel ?? null
}

/**
 * Whether the add-on applies to the main product AS CURRENTLY CONFIGURED.
 *
 * The rule is **offered unless ruled out**. An accessory is a product in its own
 * right and belongs on the page from the off; a condition exists to take it away
 * again when the shopper picks something it cannot work with, not to make them
 * earn it. So a rule passes until its option is settled on a value outside the
 * listed set - a power module is on the desk page from the moment it loads, and
 * leaves only when "Without cable ports" is chosen.
 *
 * Every rule has to pass (they describe separate facts about the product), and
 * any one of a rule's listed values passes it. An unfinished rule - one nobody
 * has ticked a value on yet - is ignored, so half-filling the editor never
 * empties the page.
 *
 * The one deliberate false where nothing incompatible was picked: the named
 * option no longer EXISTS on the main product (a rename, a sheet re-import).
 * That is a broken config rather than a shopper's choice - the condition cannot
 * be tested at all, and offering an accessory that may not fit is the very
 * failure the rule was written to prevent - so it stays hidden and the admin
 * coverage check says so out loud.
 */
export function isAddonApplicable(
  rules: PadShowWhenRule[] | undefined,
  mainOptions: SvrOptionWithValues[],
  mainSelection: Record<string, string>,
): boolean {
  for (const rule of rules ?? []) {
    const wanted = (rule.valueSlugs ?? []).filter((slug) => slug.trim() !== '')
    if (wanted.length === 0) continue
    const option = findOptionByName(mainOptions, rule.mainOption)
    if (!option) return false
    const chosenId = mainSelection[option.id]
    const chosen = chosenId ? option.values.find((v) => v.id === chosenId) : undefined
    // Nothing chosen yet rules nothing out.
    if (!chosen) continue
    if (!wanted.includes(chosen.slug)) return false
  }
  return true
}

export type ResolvedMapping = {
  mapping: PadOptionMapping
  addonOption: SvrOptionWithValues
  // For match/default: the resolved add-on value for the CURRENT main
  // selection, or null while the driving main option is unchosen (or has no
  // translation, where the add-on is unavailable).
  value: SvrOptionValue | null
  // The main option driving it, when there is one.
  mainOption: SvrOptionWithValues | null
}

/**
 * Resolve every mapping against the current main selection (main option NAME ->
 * chosen value id). 'choose' mappings resolve with value null - the shopper's
 * pick lives in the box's own state, not here. Returns null when the config
 * names an add-on option that no longer exists (the coverage check's job to
 * surface; the storefront treats the add-on as unavailable rather than selling
 * a wrong combination).
 */
export function resolveMappings(
  mappings: PadOptionMapping[],
  mainOptions: SvrOptionWithValues[],
  addonOptions: SvrOptionWithValues[],
  mainSelection: Record<string, string>,
): ResolvedMapping[] | null {
  const out: ResolvedMapping[] = []
  for (const mapping of mappings) {
    const addonOption = findOptionByName(addonOptions, mapping.addonOption)
    if (!addonOption) return null
    if (mapping.mode === 'choose') {
      out.push({ mapping, addonOption, value: null, mainOption: null })
      continue
    }
    if (mapping.mode === 'fixed' || mapping.mode === 'recommend') {
      // Both read the admin-picked value. Fixed treats a vanished value as
      // unavailability (the box's business); recommend degrades to a plain
      // choice there, so null is simply "nothing to pre-select".
      const picked = addonOption.values.find((v) => v.slug === mapping.fixedValueSlug) ?? null
      out.push({ mapping, addonOption, value: picked, mainOption: null })
      continue
    }
    const mainOption = findOptionByName(mainOptions, mapping.mainOption)
    if (!mainOption) return null
    const chosenId = mainSelection[mainOption.id]
    const mainValue = chosenId ? mainOption.values.find((v) => v.id === chosenId) ?? null : null
    out.push({
      mapping,
      addonOption,
      value: mainValue ? mapValue(mainValue, addonOption, mapping) : null,
      mainOption,
    })
  }
  return out
}

/**
 * The recommended add-on quantity for ONE unit of the main product, given the
 * current main selection - or null for a free-quantity rule, which recommends
 * nothing. The per-value multiplier consults the chosen value of the named
 * main option by SLUG; unchosen (or unmatched) falls back to the base alone.
 */
export function recommendedQuantityPerUnit(
  rule: PadQuantityRule,
  mainOptions: SvrOptionWithValues[],
  mainSelection: Record<string, string>,
): number | null {
  if (rule.mode !== 'recommended') return null
  const base = rule.base && rule.base > 0 ? rule.base : 1
  const option = findOptionByName(mainOptions, rule.perOption)
  if (!option || !rule.perValue) return base
  const chosenId = mainSelection[option.id]
  const chosen = chosenId ? option.values.find((v) => v.id === chosenId) : undefined
  const multiplier = chosen ? rule.perValue[chosen.slug] : undefined
  return base * (typeof multiplier === 'number' && multiplier > 0 ? multiplier : 1)
}

/**
 * The auto-built recommendation wording: "We'd recommend 3 × Bench Screens for
 * a 6 Person desk." - or the owner's own note verbatim when the rule carries
 * one. Null when there is nothing to recommend (free mode, or nothing chosen).
 */
export function recommendationNote(
  rule: PadQuantityRule,
  addonName: string,
  mainOptions: SvrOptionWithValues[],
  mainSelection: Record<string, string>,
): string | null {
  const perUnit = recommendedQuantityPerUnit(rule, mainOptions, mainSelection)
  if (perUnit == null) return null
  if (rule.note?.trim()) return rule.note.trim()
  const option = findOptionByName(mainOptions, rule.perOption)
  const chosenId = option ? mainSelection[option.id] : undefined
  const chosen = option && chosenId ? option.values.find((v) => v.id === chosenId) : undefined
  return chosen
    ? `We'd recommend ${perUnit} × ${addonName} for a ${chosen.label} configuration.`
    : `We'd recommend ${perUnit} × ${addonName}.`
}

/**
 * The deterministic group key for one add: same main variant + same add-on
 * lines = same key, so an identical re-add merges into the existing group
 * instead of stacking a twin beside it. Plain djb2 over a canonical string -
 * this is an identity, not a security boundary.
 */
export function deterministicGroupKey(mainProductId: string, parts: string[]): string {
  const canonical = `${mainProductId}|${[...parts].sort().join('|')}`
  let hash = 5381
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) | 0
  }
  return `pad_${(hash >>> 0).toString(36)}`
}

/**
 * The 3D context key one add-on announces, with any option suffixes composed in.
 *
 * The bare key ('pedestal') says only "this accessory is in shot", which is all
 * a one-way accessory needs. An accessory that comes in sizes needs more: a
 * 30cm pedestal and a 39cm one are different objects, and one key could only
 * ever show whichever of them somebody had modelled. So a link may nominate
 * add-on options (`config.modelContextOptions`, by NAME) whose chosen value
 * slug is appended in turn - 'pedestal-30cm', 'pedestal-39cm' - and the
 * combined file is picked per choice.
 *
 * Null when a nominated option has no value settled, or its value has no usable
 * slug: matching is exact-or-base at the far end, and announcing the bare key
 * there would show the shopper a size they had not asked for.
 */
export function composeContextKey(
  baseKey: string,
  optionNames: string[] | undefined,
  addonOptions: SvrOptionWithValues[],
  selection: Record<string, string>,
): string | null {
  const base = baseKey.trim()
  if (!base) return null
  const parts = [base]
  for (const name of optionNames ?? []) {
    const option = findOptionByName(addonOptions, name)
    const valueId = option ? selection[option.id] : undefined
    const value = valueId ? option?.values.find((v) => v.id === valueId) : undefined
    const part = value ? contextPart(value.slug || value.label) : ''
    if (!part) return null
    parts.push(part)
  }
  return parts.join('-')
}

// A value slug reduced to what a context key may hold (letters, numbers and
// dashes), so a label-derived part cannot produce a key nobody can type into
// the model's context field.
export function contextPart(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
