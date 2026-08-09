'use client'

// The model-context broadcast: which combined 3D model the product page should
// be showing, and which companion option values paint it.
//
//   Event:    'cactus-shop-model-context'
//   Detail:   ModelContextDetail (below), also parked at
//             window.__cactusModelContext for late-mounting consumers.
//
// Same no-import window seam as shop-variations' selection broadcast, and for
// the same reason: the 3D viewer module may not be installed, and it must not
// import from here (nor here from it). Both sides speak this documented shape.
//
// `contextKeys` are the add-ons in play: a plain key ('screens') for an add-on
// at its standard quantity, or 'key:qty' ('shelves:2') where the count itself
// picks the file. The viewer sorts and joins active keys to match a model's
// stored context, longest story short: exact match or the base model, nothing
// clever in between.

export const MODEL_CONTEXT_EVENT = 'cactus-shop-model-context'

export type ModelContextDetail = {
  // The product page's own slug, so a consumer can ignore a page it is not on.
  slug: string
  // The listing (parent) product the announcement is about - the id consumers
  // hold (the 3D payload carries it; the slug it does not).
  parentProductId?: string
  // Sorted-on-consumption list of active context keys. Empty = base model.
  contextKeys: string[]
  // svr option-value ids chosen across the active add-ons (screen fabric,
  // overridden frame colour), for painting companion materials.
  extraValueIds: string[]
}

declare global {
  interface Window {
    __cactusModelContext?: ModelContextDetail
  }
}

let last: string | null = null

export function publishModelContext(detail: ModelContextDetail): void {
  if (typeof window === 'undefined') return
  const encoded = JSON.stringify(detail)
  if (encoded === last) return
  last = encoded
  window.__cactusModelContext = detail
  window.dispatchEvent(new CustomEvent<ModelContextDetail>(MODEL_CONTEXT_EVENT, { detail }))
}
