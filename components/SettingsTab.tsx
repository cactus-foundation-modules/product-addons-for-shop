'use client'

// The module's tab in Shop settings: what add-ons are called on the storefront
// (the noun every heading, caption and prompt uses - "Accessories" on a
// furniture shop) and where the showcase appears.
import { useEffect, useState } from 'react'

type Settings = {
  nounSingular: string
  nounPlural: string
  showcaseSurface: 'TAB' | 'BLOCK' | 'NONE'
}

const field: React.CSSProperties = { padding: '0.375rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.875rem' }

export function ProductAddonsSettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/m/product-addons-for-shop/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSettings(d?.settings ?? null))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setMessage(null)
    const res = await fetch('/api/m/product-addons-for-shop/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    })
    setMessage(res.ok ? 'Saved.' : (await res.json()).error ?? 'Could not save')
  }

  if (!settings) return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: '1rem', maxWidth: 480 }}>
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>What add-ons are called (singular)</label>
        <input style={field} value={settings.nounSingular} maxLength={40}
          onChange={(e) => setSettings({ ...settings, nounSingular: e.target.value })} />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Used in wording like “Accessory for Impulse Desk”.</span>
      </div>
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>And in the plural</label>
        <input style={field} value={settings.nounPlural} maxLength={40}
          onChange={(e) => setSettings({ ...settings, nounPlural: e.target.value })} />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>The box heading, the product-page tab and prompts like “Remove its accessories too?”.</span>
      </div>
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Where the showcase appears</label>
        <select style={field} value={settings.showcaseSurface}
          onChange={(e) => setSettings({ ...settings, showcaseSurface: e.target.value as Settings['showcaseSurface'] })}>
          <option value="TAB">A tab on the product page (automatic)</option>
          <option value="BLOCK">Only where the showcase block is placed</option>
          <option value="NONE">Nowhere</option>
        </select>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>The panel of cards with Learn more and Add. The box under Add to basket appears either way.</span>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button type="submit" style={{ ...field, background: 'var(--color-primary)', color: 'var(--color-on-primary)', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
          Save
        </button>
        {message && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{message}</span>}
      </div>
    </form>
  )
}
