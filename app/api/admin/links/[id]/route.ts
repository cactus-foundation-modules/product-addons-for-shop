import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteLink, getLinkById, updateLink } from '@/modules/product-addons-for-shop/lib/db/links'

const MappingSchema = z.object({
  addonOption: z.string().trim().min(1),
  mode: z.enum(['match', 'default', 'choose', 'fixed', 'recommend']),
  mainOption: z.string().trim().optional(),
  valueMap: z.record(z.string()).optional(),
  fixedValueSlug: z.string().trim().optional(),
})

const QuantitySchema = z.object({
  mode: z.enum(['recommended', 'free']),
  base: z.number().int().min(1).max(99).optional(),
  perOption: z.string().trim().optional(),
  perValue: z.record(z.number().min(0).max(99)).optional(),
  note: z.string().trim().max(200).optional(),
})

// Values may be empty - the editor shows a rule the moment an option is picked,
// before any of its values are ticked, and an unfinished rule is ignored by the
// storefront rather than hiding the add-on everywhere.
const ShowWhenSchema = z.object({
  mainOption: z.string().trim().min(1),
  valueSlugs: z.array(z.string().trim().min(1)),
})

const PatchBody = z.object({
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  modelContextKey: z.string().trim().max(60).regex(/^[a-z0-9-]*(:[0-9]+)?$/i, 'Context keys are letters, numbers and dashes').optional(),
  plannerStandalone: z.boolean().optional(),
  config: z.object({
    optionMappings: z.array(MappingSchema),
    quantity: QuantitySchema,
    modelContextOptions: z.array(z.string().trim().min(1)).max(4).optional(),
    showWhen: z.array(ShowWhenSchema).max(8).optional(),
  }).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  if (!(await getLinkById(id))) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  await updateLink(id, parsed.data)
  return NextResponse.json({ link: await getLinkById(id) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteLink(id)
  return NextResponse.json({ ok: true })
}
