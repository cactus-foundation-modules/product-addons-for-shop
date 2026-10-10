'use client'

// The module's tab in Shop settings: what add-ons are called on the storefront
// (the noun every heading, caption and prompt uses - "Accessories" on a
// furniture shop) and where the showcase appears.
import { useEffect, useState } from 'react'
import { SettingsHeaderActions, SettingsHeaderStatus } from '@/components/admin/SettingsHeaderActions'

type Settings = {
  nounSingular: string
  nounPlural: string
  showcaseSurface: 'TAB' | 'BLOCK' | 'NONE'
}


export function ProductAddonsSettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/m/product-addons-for-shop/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSettings(d?.settings ?? null))
  }, [])

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    if (!settings) return
    setMessage(null)
    const res = await fetch('/api/m/product-addons-for-shop/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    })
    setMessage(res.ok ? 'Saved.' : (await res.json()).error ?? 'Could not save')
  }

  if (!settings) return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>

  return (
    <form onSubmit={save} className="settings-cols">
      <div className="card settings-fields">
        <h3 className="card-title">Wording</h3>
        <div className="settings-fields">
          <div className="field">
            <label htmlFor="pa-noun-singular">What add-ons are called (singular)</label>
            <input id="pa-noun-singular" value={settings.nounSingular} maxLength={40}
              onChange={(e) => setSettings({ ...settings, nounSingular: e.target.value })} />
            <span className="field-hint">Used in wording like &ldquo;Accessory for Impulse Desk&rdquo;.</span>
          </div>
          <div className="field">
            <label htmlFor="pa-noun-plural">And in the plural</label>
            <input id="pa-noun-plural" value={settings.nounPlural} maxLength={40}
              onChange={(e) => setSettings({ ...settings, nounPlural: e.target.value })} />
            <span className="field-hint">The box heading, the product-page tab and prompts like &ldquo;Remove its accessories too?&rdquo;.</span>
          </div>
        </div>
      </div>
      <div className="card settings-fields">
        <h3 className="card-title">Product page</h3>
        <div className="field">
          <label htmlFor="pa-showcase">Where the showcase appears</label>
          <select id="pa-showcase" value={settings.showcaseSurface}
            onChange={(e) => setSettings({ ...settings, showcaseSurface: e.target.value as Settings['showcaseSurface'] })}>
            <option value="TAB">A tab on the product page (automatic)</option>
            <option value="BLOCK">Only where the showcase block is placed</option>
            <option value="NONE">Nowhere</option>
          </select>
          <span className="field-hint">The panel of cards with Learn more and Add. The box under Add to basket appears either way.</span>
        </div>
      </div>
      <SettingsHeaderActions>
        <SettingsHeaderStatus message={message === 'Saved.' ? message : null} error={message && message !== 'Saved.' ? message : null} />
        <button type="button" className="btn btn-primary" onClick={() => save()}>
          Save changes
        </button>
      </SettingsHeaderActions>
    </form>
  )
}
