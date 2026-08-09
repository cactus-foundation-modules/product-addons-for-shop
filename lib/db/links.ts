import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db/prisma'
import type { PadLink, PadLinkConfig } from '@/modules/product-addons-for-shop/lib/types'

// $queryRaw against pad_links, matching the raw-SQL data layers of the other
// shop companions. Config is stored as jsonb and parsed defensively: a corrupt
// blob reads as an empty config (no mappings, free quantity is NOT assumed -
// recommended ×1 is the safer default) rather than breaking the page.

type Row = {
  id: string
  product_id: string
  addon_product_id: string
  enabled: boolean
  position: number
  model_context_key: string
  planner_standalone: boolean
  config: unknown
}

function parseConfig(raw: unknown): PadLinkConfig {
  const fallback: PadLinkConfig = { optionMappings: [], quantity: { mode: 'recommended', base: 1 } }
  if (!raw || typeof raw !== 'object') return fallback
  const cfg = raw as Partial<PadLinkConfig>
  return {
    optionMappings: Array.isArray(cfg.optionMappings) ? cfg.optionMappings : [],
    quantity:
      cfg.quantity && (cfg.quantity.mode === 'recommended' || cfg.quantity.mode === 'free')
        ? cfg.quantity
        : fallback.quantity,
  }
}

function toLink(row: Row): PadLink {
  return {
    id: row.id,
    productId: row.product_id,
    addonProductId: row.addon_product_id,
    enabled: row.enabled,
    position: row.position,
    modelContextKey: row.model_context_key,
    plannerStandalone: row.planner_standalone,
    config: parseConfig(row.config),
  }
}

const SELECT = `"id", "product_id", "addon_product_id", "enabled", "position", "model_context_key", "planner_standalone", "config"`

export async function getLinksForProduct(productId: string, enabledOnly = false): Promise<PadLink[]> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM "pad_links" WHERE "product_id" = $1 ${enabledOnly ? 'AND "enabled" = TRUE' : ''} ORDER BY "position", "created_at"`,
    productId,
  )
  return rows.map(toLink)
}

export async function getLinksForProducts(productIds: string[]): Promise<Map<string, PadLink[]>> {
  const out = new Map<string, PadLink[]>()
  if (productIds.length === 0) return out
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "id", "product_id", "addon_product_id", "enabled", "position", "model_context_key", "planner_standalone", "config"
    FROM "pad_links" WHERE "product_id" = ANY(${productIds}) ORDER BY "position", "created_at"
  `
  for (const row of rows) {
    const link = toLink(row)
    const list = out.get(link.productId)
    if (list) list.push(link)
    else out.set(link.productId, [link])
  }
  return out
}

export async function getLinkById(id: string): Promise<PadLink | null> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "id", "product_id", "addon_product_id", "enabled", "position", "model_context_key", "planner_standalone", "config"
    FROM "pad_links" WHERE "id" = ${id} LIMIT 1
  `
  return rows.length ? toLink(rows[0]!) : null
}

export async function getLinksByIds(ids: string[]): Promise<Map<string, PadLink>> {
  const out = new Map<string, PadLink>()
  if (ids.length === 0) return out
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "id", "product_id", "addon_product_id", "enabled", "position", "model_context_key", "planner_standalone", "config"
    FROM "pad_links" WHERE "id" = ANY(${ids})
  `
  for (const row of rows) out.set(row.id, toLink(row))
  return out
}

/**
 * Whether linking `addonProductId` under `productId` would close a cycle -
 * i.e. `productId` is already reachable FROM `addonProductId` through existing
 * links. Walks the link graph breadth-first with a visited set, so even a
 * pre-existing loop in the data terminates.
 */
export async function wouldCreateCycle(productId: string, addonProductId: string): Promise<boolean> {
  if (productId === addonProductId) return true
  const visited = new Set<string>([addonProductId])
  let frontier = [addonProductId]
  while (frontier.length > 0) {
    const rows = await prisma.$queryRaw<{ addon_product_id: string }[]>`
      SELECT "addon_product_id" FROM "pad_links" WHERE "product_id" = ANY(${frontier})
    `
    frontier = []
    for (const row of rows) {
      if (row.addon_product_id === productId) return true
      if (!visited.has(row.addon_product_id)) {
        visited.add(row.addon_product_id)
        frontier.push(row.addon_product_id)
      }
    }
  }
  return false
}

export async function createLink(fields: {
  productId: string
  addonProductId: string
  modelContextKey?: string
  plannerStandalone?: boolean
  config?: PadLinkConfig
}): Promise<PadLink> {
  const id = randomUUID()
  const config = JSON.stringify(fields.config ?? { optionMappings: [], quantity: { mode: 'recommended', base: 1 } })
  const [row] = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX("position")::int AS "max" FROM "pad_links" WHERE "product_id" = ${fields.productId}
  `
  await prisma.$executeRaw`
    INSERT INTO "pad_links" ("id", "product_id", "addon_product_id", "position", "model_context_key", "planner_standalone", "config")
    VALUES (${id}, ${fields.productId}, ${fields.addonProductId}, ${(row?.max ?? -1) + 1},
            ${fields.modelContextKey ?? ''}, ${fields.plannerStandalone ?? true}, ${config}::jsonb)
  `
  const created = await getLinkById(id)
  if (!created) throw new Error('Link vanished between insert and read')
  return created
}

export async function updateLink(id: string, fields: {
  enabled?: boolean
  position?: number
  modelContextKey?: string
  plannerStandalone?: boolean
  config?: PadLinkConfig
}): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  const push = (sql: string, value: unknown) => { values.push(value); sets.push(`${sql} = $${values.length}`) }
  if (fields.enabled !== undefined) push('"enabled"', fields.enabled)
  if (fields.position !== undefined) push('"position"', fields.position)
  if (fields.modelContextKey !== undefined) push('"model_context_key"', fields.modelContextKey)
  if (fields.plannerStandalone !== undefined) push('"planner_standalone"', fields.plannerStandalone)
  if (fields.config !== undefined) {
    values.push(JSON.stringify(fields.config))
    sets.push(`"config" = $${values.length}::jsonb`)
  }
  if (sets.length === 0) return
  values.push(id)
  await prisma.$executeRawUnsafe(
    `UPDATE "pad_links" SET ${sets.join(', ')}, "updated_at" = NOW() WHERE "id" = $${values.length}`,
    ...values,
  )
}

export async function deleteLink(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "pad_links" WHERE "id" = ${id}`
}

/** Every link in the catalogue, for the admin overview - joined to names there, not here. */
export async function getAllLinks(): Promise<PadLink[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "id", "product_id", "addon_product_id", "enabled", "position", "model_context_key", "planner_standalone", "config"
    FROM "pad_links" ORDER BY "product_id", "position"
  `
  return rows.map(toLink)
}
