import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getProductsByIds } from '@/modules/shop/lib/db/products'
import { getAllLinks } from '@/modules/product-addons-for-shop/lib/db/links'
import { prisma } from '@/lib/db/prisma'
import { getVariantsForProducts } from '@/modules/shop-variations/lib/db/variants'

// Attach rate, from the orders themselves: for each link, how many orders
// contained the main product, how many of those carried this add-on attached
// (the linkId persisted in the order item's line meta - an orphaned or
// separately-bought add-on deliberately never counts), and what the attached
// lines took. Cancelled orders are left out; everything else was a real intent
// to buy.
export async function GET(request: NextRequest) {
  const gate = await requireShopUser('shop.reports', { allowAccess: true })
  if (gate.error) return gate.error

  const from = request.nextUrl.searchParams.get('from')
  const to = request.nextUrl.searchParams.get('to')
  const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date()

  const links = await getAllLinks()
  if (links.length === 0) return NextResponse.json({ rows: [], from: fromDate, to: toDate })

  const mainIds = [...new Set(links.map((l) => l.productId))]
  const variantsByParent = await getVariantsForProducts(mainIds)
  const products = await getProductsByIds([...new Set(links.flatMap((l) => [l.productId, l.addonProductId]))])

  // Orders per main product: an order "contains" the main when any item's
  // product is the listing or one of its variant children.
  const ordersByMain = new Map<string, Set<string>>()
  for (const mainId of mainIds) {
    const family = [mainId, ...(variantsByParent.get(mainId) ?? []).map((v) => v.childProductId)]
    const rows = await prisma.$queryRaw<{ order_id: string }[]>`
      SELECT DISTINCT i."order_id" FROM "shp_order_items" i
      JOIN "shp_orders" o ON o."id" = i."order_id"
      WHERE i."product_id" = ANY(${family})
        AND o."status" <> 'CANCELLED'
        AND o."created_at" >= ${fromDate} AND o."created_at" <= ${toDate}
    `
    ordersByMain.set(mainId, new Set(rows.map((r) => r.order_id)))
  }

  // Attached add-on items, by the linkId the resolver persisted.
  const attached = await prisma.$queryRaw<{ link_id: string; order_id: string; qty: number; total: number }[]>`
    SELECT i."line_meta"->'data'->'productAddons'->>'linkId' AS "link_id",
           i."order_id",
           SUM(i."quantity")::int AS "qty",
           SUM(i."total")::float AS "total"
    FROM "shp_order_items" i
    JOIN "shp_orders" o ON o."id" = i."order_id"
    WHERE i."line_meta"->'data'->'productAddons'->>'role' = 'addon'
      AND o."status" <> 'CANCELLED'
      AND o."created_at" >= ${fromDate} AND o."created_at" <= ${toDate}
    GROUP BY 1, 2
  `
  const byLink = new Map<string, { orders: Set<string>; qty: number; revenue: number }>()
  for (const row of attached) {
    if (!row.link_id) continue
    const entry = byLink.get(row.link_id) ?? { orders: new Set<string>(), qty: 0, revenue: 0 }
    entry.orders.add(row.order_id)
    entry.qty += row.qty
    entry.revenue += row.total
    byLink.set(row.link_id, entry)
  }

  const rows = links.map((link) => {
    const mainOrders = ordersByMain.get(link.productId)?.size ?? 0
    const stats = byLink.get(link.id)
    const attachedOrders = stats?.orders.size ?? 0
    return {
      linkId: link.id,
      productName: products.get(link.productId)?.name ?? '(deleted product)',
      addonName: products.get(link.addonProductId)?.name ?? '(deleted product)',
      mainOrders,
      attachedOrders,
      attachRate: mainOrders > 0 ? attachedOrders / mainOrders : 0,
      unitsSold: stats?.qty ?? 0,
      revenue: stats?.revenue ?? 0,
    }
  })

  return NextResponse.json({ rows, from: fromDate, to: toDate })
}
