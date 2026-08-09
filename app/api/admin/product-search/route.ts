import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'
import { searchTerms } from '@/modules/shop/lib/db/products'

// Picker search for the Add-ons section: live, visible listings by name or
// SKU. Catalogue-hidden rows are variant children and can never be linked -
// links point at listings, whose variants the box resolves at buy time.
//
// Every WORD has to appear somewhere in the name or the SKU, in any order -
// the same rule the shop's own product list search follows. One ILIKE over the
// whole phrase meant "cable tray" found nothing at all on a product called
// "Oslo Back-to-Back Cable Management Tray", so the admin had to type the name
// exactly to link anything.
export async function GET(request: NextRequest) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  const exclude = request.nextUrl.searchParams.get('exclude') ?? ''
  if (q.length < 2) return NextResponse.json({ products: [] })
  const terms = searchTerms(q)
  if (terms.length === 0) return NextResponse.json({ products: [] })
  const match = Prisma.join(
    terms.map((t) => Prisma.sql`("name" ILIKE ${`%${t}%`} OR "sku" ILIKE ${`%${t}%`})`),
    ' AND ',
  )
  const rows = await prisma.$queryRaw<{ id: string; name: string; sku: string | null }[]>`
    SELECT "id", "name", "sku" FROM "shp_products"
    WHERE "status" = 'ACTIVE' AND "catalogue_hidden" = FALSE AND "id" <> ${exclude}
      AND (${match})
    ORDER BY "name" LIMIT 12
  `
  return NextResponse.json({ products: rows })
}
