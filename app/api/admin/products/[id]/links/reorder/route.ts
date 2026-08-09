import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getLinksForProduct, reorderLinks } from '@/modules/product-addons-for-shop/lib/db/links'

// The order add-ons are offered in, on the product page and in the showcase
// alike (both read `position`). Takes the whole list rather than a from/to pair
// so the server never has to guess what the editor was looking at.

const Body = z.object({ orderedIds: z.array(z.string().min(1)).min(1).max(200) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // Refuse a list that is not exactly this product's links. A partial list would
  // renumber some rows and leave others on stale positions, which reads as a
  // random order rather than an error; better to say so.
  const existing = await getLinksForProduct(id)
  const known = new Set(existing.map((link) => link.id))
  const sent = new Set(parsed.data.orderedIds)
  if (sent.size !== parsed.data.orderedIds.length || sent.size !== known.size || [...sent].some((linkId) => !known.has(linkId))) {
    return NextResponse.json({ error: 'The add-ons changed while you were reordering them - reload and try again.' }, { status: 409 })
  }

  await reorderLinks(id, parsed.data.orderedIds)
  return NextResponse.json({ links: await getLinksForProduct(id) })
}
