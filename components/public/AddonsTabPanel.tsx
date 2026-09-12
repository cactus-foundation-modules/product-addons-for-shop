'use client'

// The tab strip hands its panels a bare `payload` prop across the RSC
// boundary; this thin wrapper types it back into the showcase. Carries its own
// 'use client' because shop passes it down to a client island as a prop.
import { AddonsShowcase, type ShowcasePayload } from '@/modules/product-addons-for-shop/components/public/AddonsShowcase'
import type { ShopDetailTabPanelProps } from '@/modules/shop/lib/detail-tabs'
import type { ImageResizing } from '@/lib/media/resize-url'

// `resizing` is spelled out here as well as in shop's own contract so this
// builds against either side of shop's release - the build gate composes this
// module against the shop version core currently pins, which may predate the
// field. It is the same optional prop, not a second one.
export function AddonsTabPanel({ payload, resizing }: ShopDetailTabPanelProps & { resizing?: ImageResizing }) {
  // The BLOCK surface has read the picture-resizing setting off Puck's metadata
  // since it was added; this, the TAB surface, is the one most shops actually
  // use, and it had no way to reach the site config - so the switch did nothing
  // on the very cards it was measured against. Shop hands it down now.
  return <AddonsShowcase payload={payload as ShowcasePayload} resizing={resizing} />
}
