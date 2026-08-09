import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getPadSettings, savePadSettings } from '@/modules/product-addons-for-shop/lib/db/settings'

const Body = z.object({
  nounSingular: z.string().trim().min(1).max(40),
  nounPlural: z.string().trim().min(1).max(40),
  showcaseSurface: z.enum(['TAB', 'BLOCK', 'NONE']),
})

export async function GET() {
  const gate = await requireShopUser('shop.manage', { allowAccess: true })
  if (gate.error) return gate.error
  return NextResponse.json({ settings: await getPadSettings() })
}

export async function PUT(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid settings' }, { status: 400 })
  await savePadSettings(parsed.data)
  return NextResponse.json({ settings: await getPadSettings() })
}
