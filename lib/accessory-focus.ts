'use client'

// The showcase's "Add" button and the purchase box live in different islands
// (and the showcase may render inside shop's tab strip, which knows nothing of
// either). One window event carries the intent: open this add-on in the box,
// ready for its choices. Fired by the showcase, heard by the box.

export const ADDON_FOCUS_EVENT = 'cactus-shop-accessory-focus'

export type AddonFocusDetail = {
  linkId: string
}

export function focusAddon(linkId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AddonFocusDetail>(ADDON_FOCUS_EVENT, { detail: { linkId } }))
}
