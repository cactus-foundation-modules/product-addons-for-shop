import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { AddonsScreen } from '@/modules/product-addons-for-shop/components/admin/AddonsScreen'

export const metadata = { title: 'Product add-ons — Admin' }

export default async function ProductAddonsPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.products', { allowAccess: true })
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to manage product add-ons.</div>

  return <AddonsScreen />
}
