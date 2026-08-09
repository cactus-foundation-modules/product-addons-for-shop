'use client'

// The tab strip hands its panels a bare `payload` prop across the RSC
// boundary; this thin wrapper types it back into the showcase. Carries its own
// 'use client' because shop passes it down to a client island as a prop.
import { AddonsShowcase, type ShowcasePayload } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'
import type { ShopDetailTabPanelProps } from '@/modules/shop/lib/detail-tabs'

export function AddonsTabPanel({ payload }: ShopDetailTabPanelProps) {
  return <AddonsShowcase payload={payload as ShowcasePayload} />
}
