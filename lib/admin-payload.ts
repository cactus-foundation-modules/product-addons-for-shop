import { prisma } from '@/lib/db/prisma'
import { getProductsByIds } from '@/modules/shop/lib/db/products'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getAddons } from '@/modules/shop-variations/lib/db/addons'
import { getVariants } from '@/modules/shop-variations/lib/db/variants'
import { getLinksForProduct } from '@/modules/product-addons-for-shop/lib/db/links'
import { findOptionByName, mapValue } from '@/modules/product-addons-for-shop/lib/mapping'
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
  modelCoverage: { context: string; tagged: number; variations: number } | null
}

export type AdminSectionPayload = {
  mainOptions: AdminOption[]
  links: AdminLinkView[]
}

function toAdminOptions(options: SvrOptionWithValues[]): AdminOption[] {
  return options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ label: v.label, slug: v.slug })) }))
}

async function contextModelCounts(mainProductId: string, contextKey: string): Promise<{ tagged: number; variations: number } | null> {
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
    if (childIds.length === 0) return { tagged: 0, variations: 0 }
    // A file counts for a context whether it is the plain key or a
    // quantity-tagged variant of it ('screens' matches 'screens' and a stored
    // 'screens:2' counts toward the same story).
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT "product_id")::bigint AS "n" FROM "p3d_models"
      WHERE "product_id" = ANY(${childIds})
        AND ("context" = ${contextKey} OR "context" LIKE ${`${contextKey}:%`})
    `
    return { tagged: Number(rows[0]?.n ?? 0), variations: childIds.length }
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

  const modelCoverage = link.modelContextKey
    ? await contextModelCounts(link.productId, link.modelContextKey).then((counts) =>
        counts ? { context: link.modelContextKey, ...counts } : null,
      )
    : null

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
