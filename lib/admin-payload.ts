import { prisma } from '@/lib/db/prisma'
import { getProductsByIds } from '@/modules/shop/lib/db/products'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getAddons } from '@/modules/shop-variations/lib/db/addons'
import { getVariants } from '@/modules/shop-variations/lib/db/variants'
import { getLinksForProduct } from '@/modules/product-addons-for-shop/lib/db/links'
import { contextPart, findOptionByName, mapValue } from '@/modules/product-addons-for-shop/lib/mapping'
import type { PadLink } from '@/modules/product-addons-for-shop/lib/types'
import type { SvrOptionWithValues } from '@/modules/shop-variations/lib/types'

// Everything the product editor's Add-ons section needs, composed server-side:
// the links, both sides' options (names, values, slugs - what the mapping UI
// edits), the automatic-match preview per mapping, the coverage warnings, and
// the 3D context file coverage where the 3D module (with contexts) is present.

export type AdminOptionValue = { label: string; slug: string }
export type AdminOption = { name: string; values: AdminOptionValue[] }

export type AdminLinkView = {
  link: PadLink
  addonName: string
  addonSlug: string
  addonOptions: AdminOption[]
  // Human warnings the storefront would otherwise discover silently.
  warnings: string[]
  // Per context key: how many of the main product's variations carry a model
  // file tagged with it, out of how many variations there are. Null when the 3D
  // module (or its context column) is absent.
  //
  // One row for a plain key; one per combination where the link nominates
  // option suffixes (a pedestal's two widths make two keys, each wanting its
  // own file on every variation).
  modelCoverage: { context: string; tagged: number; variations: number }[] | null
}

export type AdminSectionPayload = {
  mainOptions: AdminOption[]
  links: AdminLinkView[]
}

function toAdminOptions(options: SvrOptionWithValues[]): AdminOption[] {
  return options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ label: v.label, slug: v.slug })) }))
}

// The keys this link can actually announce: the bare one, or - where it
// nominates option suffixes - one per combination of those options' values.
// Capped so a link nominating several many-valued options cannot turn the
// editor into a wall of rows; the cap is the display's business, and the
// storefront still announces whatever the shopper picks.
const MAX_CONTEXT_KEYS = 24

function expectedContextKeys(link: PadLink, addonOptions: SvrOptionWithValues[]): string[] {
  const base = link.modelContextKey.trim()
  if (!base) return []
  let keys = [base]
  for (const name of link.config.modelContextOptions ?? []) {
    const option = findOptionByName(addonOptions, name)
    // A nominated option that has gone (or has no usable values) is warned
    // about separately; the keys stop growing here rather than inventing any.
    if (!option) return keys
    const parts = option.values.map((v) => contextPart(v.slug || v.label)).filter(Boolean)
    if (parts.length === 0) return keys
    keys = keys.flatMap((key) => parts.map((part) => `${key}-${part}`))
    if (keys.length >= MAX_CONTEXT_KEYS) return keys.slice(0, MAX_CONTEXT_KEYS)
  }
  return keys
}

async function contextModelCounts(mainProductId: string, contextKeys: string[]): Promise<{ context: string; tagged: number; variations: number }[] | null> {
  try {
    const [probe] = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT (to_regclass('public.p3d_models') IS NOT NULL)
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'p3d_models' AND column_name = 'context'
         ) AS "ok"
    `
    if (!probe?.ok) return null
    const variants = await getVariants(mainProductId)
    const childIds = variants.map((v) => v.childProductId)
    if (childIds.length === 0) return contextKeys.map((context) => ({ context, tagged: 0, variations: 0 }))
    // Every tagged file on the range in one read, counted per key here. A file
    // counts for a context whether it is the plain key or a quantity-tagged
    // variant of it ('screens' matches 'screens' and a stored 'screens:2'
    // counts toward the same story).
    const rows = await prisma.$queryRaw<{ product_id: string; context: string }[]>`
      SELECT DISTINCT "product_id", "context" FROM "p3d_models"
      WHERE "product_id" = ANY(${childIds}) AND "context" <> ''
    `
    return contextKeys.map((context) => {
      const tagged = new Set(
        rows.filter((r) => r.context === context || r.context.startsWith(`${context}:`)).map((r) => r.product_id),
      )
      return { context, tagged: tagged.size, variations: childIds.length }
    })
  } catch {
    return null
  }
}

async function buildLinkView(link: PadLink, mainOptions: SvrOptionWithValues[]): Promise<AdminLinkView | null> {
  const [products, addonOptions, personalisation] = await Promise.all([
    getProductsByIds([link.addonProductId]),
    getOptionsWithValues(link.addonProductId),
    getAddons(link.addonProductId),
  ])
  const product = products.get(link.addonProductId)
  if (!product) return null

  const warnings: string[] = []
  if (product.status !== 'ACTIVE') warnings.push('The linked product is not live, so it is not being offered.')
  if (product.catalogueHidden) warnings.push('The linked product is hidden from the catalogue, so it is not being offered.')
  if (personalisation.some((a) => a.required)) {
    warnings.push('The linked product has a required personalisation field, which the add-on box cannot collect - it is not being offered until that field is optional or removed.')
  }

  // Mapping health: every add-on option should be handled somewhere, and every
  // match/default translation should land for every main value.
  const mappedNames = new Set(link.config.optionMappings.map((m) => m.addonOption.trim().toLowerCase()))
  for (const option of addonOptions) {
    if (!mappedNames.has(option.name.trim().toLowerCase())) {
      warnings.push(`Option "${option.name}" has no rule yet - shoppers will be asked to choose it.`)
    }
  }
  for (const mapping of link.config.optionMappings) {
    const addonOption = findOptionByName(addonOptions, mapping.addonOption)
    if (!addonOption) {
      warnings.push(`The rule for "${mapping.addonOption}" points at an option that no longer exists on the linked product.`)
      continue
    }
    if (mapping.mode === 'match' || mapping.mode === 'default') {
      const mainOption = findOptionByName(mainOptions, mapping.mainOption)
      if (!mainOption) {
        warnings.push(`The rule for "${mapping.addonOption}" follows "${mapping.mainOption ?? ''}", which no longer exists on this product.`)
        continue
      }
      const missing = mainOption.values.filter((v) => !mapValue(v, addonOption, mapping))
      if (missing.length > 0) {
        warnings.push(
          `"${mapping.addonOption}" has no match for ${mainOption.name}: ${missing.map((v) => v.label).join(', ')} - the add-on will not be offered for ${missing.length === 1 ? 'that choice' : 'those choices'}.`,
        )
      }
    }
    if (mapping.mode === 'fixed' && !addonOption.values.some((v) => v.slug === mapping.fixedValueSlug)) {
      warnings.push(`The pinned value for "${mapping.addonOption}" no longer exists on the linked product.`)
    }
    if (mapping.mode === 'recommend' && !addonOption.values.some((v) => v.slug === mapping.fixedValueSlug)) {
      warnings.push(`The recommended value for "${mapping.addonOption}" no longer exists on the linked product - shoppers are asked to choose instead.`)
    }
  }

  // Visibility conditions: an option that has gone means the add-on is offered
  // NOWHERE (the storefront cannot test a condition it cannot find, and guessing
  // yes is the failure the condition was written to prevent), so it is said in
  // as many words rather than left to be discovered as a missing accessory.
  for (const rule of link.config.showWhen ?? []) {
    const mainOption = findOptionByName(mainOptions, rule.mainOption)
    if (!mainOption) {
      warnings.push(`The condition on "${rule.mainOption}" points at an option this product no longer has, so the add-on is not being offered at all.`)
      continue
    }
    const known = new Set(mainOption.values.map((v) => v.slug))
    const gone = (rule.valueSlugs ?? []).filter((slug) => !known.has(slug))
    if (gone.length > 0) {
      warnings.push(`The condition on "${mainOption.name}" names ${gone.length === 1 ? 'a choice' : 'choices'} that no longer exist: ${gone.join(', ')}.`)
    }
    if ((rule.valueSlugs ?? []).length === 0) {
      warnings.push(`The condition on "${mainOption.name}" has no choices ticked, so it is being ignored - the add-on is offered whatever is picked.`)
    }
  }

  for (const name of link.config.modelContextOptions ?? []) {
    if (!findOptionByName(addonOptions, name)) {
      warnings.push(`The 3D context key follows "${name}", which is not an option on the linked product - the combined model will not be shown until that is put right.`)
    }
  }

  const contextKeys = expectedContextKeys(link, addonOptions)
  const modelCoverage = contextKeys.length > 0 ? await contextModelCounts(link.productId, contextKeys) : null

  return {
    link,
    addonName: product.name,
    addonSlug: product.slug,
    addonOptions: toAdminOptions(addonOptions),
    warnings,
    modelCoverage,
  }
}

export async function buildAdminSectionPayload(productId: string): Promise<AdminSectionPayload> {
  const [links, mainOptions] = await Promise.all([
    getLinksForProduct(productId),
    getOptionsWithValues(productId),
  ])
  const views = (
    await Promise.all(links.map((link) => buildLinkView(link, mainOptions)))
  ).filter((v): v is AdminLinkView => v !== null)
  return { mainOptions: toAdminOptions(mainOptions), links: views }
}
