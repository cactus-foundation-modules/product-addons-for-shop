import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getProductsByIds } from '@/modules/shop/lib/db/products'
import { getAddons } from '@/modules/shop-variations/lib/db/addons'
import { buildAdminSectionPayload } from '@/modules/product-addons-for-shop/lib/admin-payload'
import { createLink, wouldCreateCycle } from '@/modules/product-addons-for-shop/lib/db/links'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  return NextResponse.json(await buildAdminSectionPayload(id))
}

// `hideChildAddons` is offered at creation because the loop refusal is the only
// time anybody finds out they wanted it: the editor shows the way out with the
// refusal and posts again with this set.
const CreateBody = z.object({ addonProductId: z.string().min(1), hideChildAddons: z.boolean().optional() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = CreateBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const addonProductId = parsed.data.addonProductId
  const hideChildAddons = parsed.data.hideChildAddons === true

  const products = await getProductsByIds([id, addonProductId])
  if (!products.get(id) || !products.get(addonProductId)) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
  // The two refusals that keep the storefront honest: a loop of add-ons, and a
  // product whose required personalisation the box cannot collect. The loop is
  // the softer of the two - `loop: true` tells the editor to offer the way out
  // (add it without its own add-ons) rather than leave the owner stuck.
  if (await wouldCreateCycle(id, addonProductId, hideChildAddons)) {
    return NextResponse.json({
      error: 'That would make these products add-ons of each other in a loop. Add it without its own add-ons and they can sit alongside each other.',
      loop: true,
    }, { status: 400 })
  }
  const personalisation = await getAddons(addonProductId)
  if (personalisation.some((a) => a.required)) {
    return NextResponse.json(
      { error: 'That product has a required personalisation field, which the add-on box cannot collect. Make the field optional (or remove it) first.' },
      { status: 400 },
    )
  }

  try {
    const link = await createLink({
      productId: id,
      addonProductId,
      ...(hideChildAddons
        ? { config: { optionMappings: [], quantity: { mode: 'recommended' as const, base: 1 }, hideChildAddons: true } }
        : {}),
    })
    return NextResponse.json({ link })
  } catch (error) {
    const message = error instanceof Error && /unique/i.test(error.message)
      ? 'That product is already an add-on here.'
      : 'Could not create the link'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
