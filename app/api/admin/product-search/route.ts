import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'

// Picker search for the Add-ons section: live, visible listings by name or
// SKU. Catalogue-hidden rows are variant children and can never be linked -
// links point at listings, whose variants the box resolves at buy time.
export async function GET(request: NextRequest) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  const exclude = request.nextUrl.searchParams.get('exclude') ?? ''
  if (q.length < 2) return NextResponse.json({ products: [] })
  const like = `%${q}%`
  const rows = await prisma.$queryRaw<{ id: string; name: string; sku: string | null }[]>`
    SELECT "id", "name", "sku" FROM "shp_products"
    WHERE "status" = 'ACTIVE' AND "catalogue_hidden" = FALSE AND "id" <> ${exclude}
      AND ("name" ILIKE ${like} OR "sku" ILIKE ${like})
    ORDER BY "name" LIMIT 12
  `
  return NextResponse.json({ products: rows })
}
