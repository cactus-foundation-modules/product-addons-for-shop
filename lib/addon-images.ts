'use client'

// Which picture each add-on is currently showing, published to the whole page.
//
//   Event:    'cactus-shop-addon-images'
//   Detail:   AddonImagesDetail (below), also parked at
//             window.__cactusAddonImages for late-mounting consumers.
//
// The add-ons box works all this out already - it is the island holding the
// shopper's picks, the values matched off the main product and the values the
// shop pinned, and it resolves them into a variation (or the nearest one to
// what is settled) on every change. The showcase renders somewhere else
// entirely - inside shop's tab strip, under the specification, in its own
// island with no access to any of that - and was left showing the listing's own
// photograph while the box beside it showed the right finish.
//
// Rather than have the showcase duplicate the resolution (which would mean
// shipping the whole box payload a second time, and two copies of the maths to
// disagree with each other), the box says what it settled on and the showcase
// repeats it. One source, one answer, no second payload.
//
// Same window-seam shape as shop-variations' selection broadcast and this
// module's own model-context one, for consistency rather than necessity: these
// two components are in the same module and could import each other, but they
// are separate React islands, so they cannot share state any other way.
//
// A showcase on a page with no box block simply hears nothing and keeps its
// server-rendered listing picture, exactly as it always did.

export const ADDON_IMAGES_EVENT = 'cactus-shop-addon-images'

export type AddonImagesDetail = {
  // The listing (parent) product the announcement is about, so a consumer can
  // ignore one that is not its own.
  parentProductId: string
  // Link id -> that add-on's pictures in gallery order, the same list the box's
  // own thumbnail and picture modal use. Chain children are included; a
  // consumer that only knows its top-level links simply never looks them up.
  // An add-on with nothing better than the listing picture is absent, not
  // present-and-empty, so "no opinion" and "no pictures" cannot be confused.
  images: Record<string, string[]>
}

declare global {
  interface Window {
    __cactusAddonImages?: AddonImagesDetail
  }
}

let last: string | null = null

export function publishAddonImages(detail: AddonImagesDetail): void {
  if (typeof window === 'undefined') return
  const encoded = JSON.stringify(detail)
  if (encoded === last) return
  last = encoded
  window.__cactusAddonImages = detail
  window.dispatchEvent(new CustomEvent<AddonImagesDetail>(ADDON_IMAGES_EVENT, { detail }))
}

export function getAddonImages(): AddonImagesDetail | null {
  if (typeof window === 'undefined') return null
  return window.__cactusAddonImages ?? null
}
