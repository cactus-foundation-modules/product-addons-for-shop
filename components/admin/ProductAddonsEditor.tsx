'use client'

// The Add-ons panel on a product's edit screen: link products, set each
// option's rule (match / default / choose / fixed), the quantity rule and the
// 3D context key, with the coverage warnings the storefront would otherwise
// discover silently. Saves per link via PATCH; the section payload is
// re-fetched after every write so the warnings always describe what is saved.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminOption, AdminSectionPayload } from '@/modules/product-addons-for-shop/lib/admin-payload'
import type { PadLinkConfig, PadOptionMapping } from '@/modules/product-addons-for-shop/lib/types'

const API = '/api/m/product-addons-for-shop/admin'

type SearchHit = { id: string; name: string; sku: string | null }

const field: React.CSSProperties = { padding: '0.375rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.8125rem' }
const label: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }
const btn: React.CSSProperties = { ...field, cursor: 'pointer' }

export function ProductAddonsEditor({ productId }: { productId: string }) {
  const [payload, setPayload] = useState<AdminSectionPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const searchSeq = useRef(0)

  const reload = useCallback(async () => {
    const res = await fetch(`${API}/products/${productId}/links`)
    if (res.ok) setPayload(await res.json())
  }, [productId])

  useEffect(() => {
    // Fired through the microtask queue so the effect body itself sets no
    // state; the fetch's own await does the real deferring anyway.
    void Promise.resolve().then(reload)
  }, [reload])

  useEffect(() => {
    const q = query.trim()
    const seq = ++searchSeq.current
    // The empty answer goes through the same debounce as a real search, so
    // this effect never sets state synchronously and quick typing coalesces.
    const timer = setTimeout(async () => {
      if (seq !== searchSeq.current) return
      if (q.length < 2) { setHits([]); return }
      const res = await fetch(`${API}/product-search?q=${encodeURIComponent(q)}&exclude=${productId}`)
      if (!res.ok || seq !== searchSeq.current) return
      const data = await res.json()
      setHits(data.products ?? [])
    }, 250)
    return () => clearTimeout(timer)
  }, [query, productId])

  async function addLink(addonProductId: string) {
    setError(null)
    const res = await fetch(`${API}/products/${productId}/links`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addonProductId }),
    })
    if (!res.ok) { setError((await res.json()).error ?? 'Could not add that product'); return }
    setQuery(''); setHits([])
    await reload()
  }

  async function patchLink(linkId: string, body: Record<string, unknown>) {
    setError(null)
    const res = await fetch(`${API}/links/${linkId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) { setError((await res.json()).error ?? 'Could not save'); return }
    await reload()
  }

  async function removeLink(linkId: string) {
    await fetch(`${API}/links/${linkId}`, { method: 'DELETE' })
    await reload()
  }

  if (!payload) return <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Loading add-ons…</p>

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
        Products offered alongside this one, bought together as one grouped basket. Each add-on
        keeps its own price, stock and delivery rules.
      </p>

      {error && <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: '0.8125rem' }}>{error}</p>}

      {payload.links.map((view) => (
        <LinkEditor
          key={view.link.id}
          view={view}
          mainOptions={payload.mainOptions}
          onPatch={(body) => patchLink(view.link.id, body)}
          onRemove={() => removeLink(view.link.id)}
        />
      ))}

      <div style={{ display: 'grid', gap: '0.375rem', position: 'relative' }}>
        <span style={label}>Add a product as an add-on</span>
        <input
          style={field} placeholder="Search by name or SKU…" value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hits.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)', display: 'grid', gap: '0.125rem', maxHeight: 220, overflowY: 'auto' }}>
            {hits.map((hit) => (
              <li key={hit.id}>
                <button type="button" style={{ ...btn, width: '100%', textAlign: 'left', border: 'none' }} onClick={() => addLink(hit.id)}>
                  {hit.name}{hit.sku ? ` · ${hit.sku}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function LinkEditor({ view, mainOptions, onPatch, onRemove }: {
  view: AdminSectionPayload['links'][number]
  mainOptions: AdminOption[]
  onPatch: (body: Record<string, unknown>) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const { link } = view
  // Local drafts for the free-typed fields; selects and toggles save at once.
  const [contextKey, setContextKey] = useState(link.modelContextKey)
  const [config, setConfig] = useState<PadLinkConfig>(link.config)
  const [dirty, setDirty] = useState(false)
  // Fresh server truth resets the drafts - done as a render-phase adjustment
  // against the previous prop (the React docs' derive-from-props pattern)
  // rather than an effect, so there is no post-render second pass.
  const [seenLink, setSeenLink] = useState(link)
  if (seenLink !== link) {
    setSeenLink(link)
    setConfig(link.config)
    setContextKey(link.modelContextKey)
    setDirty(false)
  }

  function patchConfig(next: PadLinkConfig) { setConfig(next); setDirty(true) }

  function mappingFor(optionName: string): PadOptionMapping {
    return (
      config.optionMappings.find((m) => m.addonOption.trim().toLowerCase() === optionName.trim().toLowerCase()) ?? {
        addonOption: optionName,
        mode: 'choose',
      }
    )
  }

  function setMapping(optionName: string, patch: Partial<PadOptionMapping>) {
    const current = mappingFor(optionName)
    const next = { ...current, ...patch }
    const rest = config.optionMappings.filter((m) => m.addonOption.trim().toLowerCase() !== optionName.trim().toLowerCase())
    patchConfig({ ...config, optionMappings: [...rest, next] })
  }

  const quantity = config.quantity
  const perOption = mainOptions.find((o) => o.name === quantity.perOption)

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.75rem', display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.9375rem' }}>{view.addonName}</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
          <input type="checkbox" checked={link.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} />
          Offered on the product page
        </label>
        <button type="button" style={{ ...btn, marginLeft: 'auto', color: 'var(--color-danger)' }} onClick={onRemove}>Remove</button>
      </div>

      {view.warnings.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.25rem' }}>
          {view.warnings.map((w, i) => (
            <li key={i} style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>{w}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'grid', gap: '0.625rem' }}>
        <span style={label}>How each of its options is decided</span>
        {view.addonOptions.length === 0 && (
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>No options on this product - the add-on is a single item.</p>
        )}
        {view.addonOptions.map((option) => {
          const mapping = mappingFor(option.name)
          const mainOption = mainOptions.find((o) => o.name === mapping.mainOption)
          return (
            <div key={option.name} style={{ display: 'grid', gap: '0.375rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--color-border)' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
                <strong>{option.name}</strong>
                <select style={field} value={mapping.mode} onChange={(e) => setMapping(option.name, { mode: e.target.value as PadOptionMapping['mode'] })}>
                  <option value="match">Matches a main option (hidden)</option>
                  <option value="default">Follows a main option, changeable</option>
                  <option value="choose">Shopper chooses</option>
                  <option value="fixed">Always one value</option>
                </select>
                {(mapping.mode === 'match' || mapping.mode === 'default') && (
                  <select style={field} value={mapping.mainOption ?? ''} onChange={(e) => setMapping(option.name, { mainOption: e.target.value })}>
                    <option value="">Pick the main option…</option>
                    {mainOptions.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                  </select>
                )}
                {mapping.mode === 'fixed' && (
                  <select style={field} value={mapping.fixedValueSlug ?? ''} onChange={(e) => setMapping(option.name, { fixedValueSlug: e.target.value })}>
                    <option value="">Pick the value…</option>
                    {option.values.map((v) => <option key={v.slug} value={v.slug}>{v.label}</option>)}
                  </select>
                )}
              </div>
              {(mapping.mode === 'match' || mapping.mode === 'default') && mainOption && (
                <details>
                  <summary style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                    Value translations (automatic where left blank)
                  </summary>
                  <div style={{ display: 'grid', gap: '0.25rem', paddingTop: '0.375rem' }}>
                    {mainOption.values.map((mv) => (
                      <label key={mv.slug} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.75rem' }}>
                        <span style={{ minWidth: 120 }}>{mv.label} →</span>
                        <select
                          style={field}
                          value={mapping.valueMap?.[mv.slug] ?? ''}
                          onChange={(e) => {
                            const valueMap = { ...(mapping.valueMap ?? {}) }
                            if (e.target.value) valueMap[mv.slug] = e.target.value
                            else delete valueMap[mv.slug]
                            setMapping(option.name, { valueMap })
                          }}
                        >
                          <option value="">Automatic</option>
                          {option.values.map((v) => <option key={v.slug} value={v.slug}>{v.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gap: '0.375rem' }}>
        <span style={label}>Quantity</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
          <select style={field} value={quantity.mode} onChange={(e) => patchConfig({ ...config, quantity: { ...quantity, mode: e.target.value as 'recommended' | 'free' } })}>
            <option value="recommended">Recommended count (gentle note if changed)</option>
            <option value="free">Shopper decides, no recommendation</option>
          </select>
          {quantity.mode === 'recommended' && (
            <>
              <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                Base
                <input
                  type="number" min={1} max={99} style={{ ...field, width: 64 }} value={quantity.base ?? 1}
                  onChange={(e) => patchConfig({ ...config, quantity: { ...quantity, base: Math.max(1, Number(e.target.value) || 1) } })}
                />
              </label>
              <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                scaled by
                <select
                  style={field} value={quantity.perOption ?? ''}
                  onChange={(e) => patchConfig({ ...config, quantity: { ...quantity, perOption: e.target.value || undefined, perValue: e.target.value ? quantity.perValue : undefined } })}
                >
                  <option value="">nothing</option>
                  {mainOptions.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        {quantity.mode === 'recommended' && perOption && (
          <div style={{ display: 'grid', gap: '0.25rem', paddingLeft: '0.5rem' }}>
            {perOption.values.map((v) => (
              <label key={v.slug} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.75rem' }}>
                <span style={{ minWidth: 120 }}>{v.label}</span>
                <input
                  type="number" min={0} max={99} style={{ ...field, width: 64 }}
                  value={quantity.perValue?.[v.slug] ?? 1}
                  onChange={(e) => patchConfig({
                    ...config,
                    quantity: { ...quantity, perValue: { ...(quantity.perValue ?? {}), [v.slug]: Math.max(0, Number(e.target.value) || 0) } },
                  })}
                />
                <span style={{ color: 'var(--color-text-muted)' }}>× base</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8125rem' }}>
          <span style={label}>3D context key</span>
          <input style={{ ...field, width: 160 }} placeholder="e.g. screens" value={contextKey} onChange={(e) => { setContextKey(e.target.value); setDirty(true) }} />
        </label>
        <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: '0.8125rem', paddingBottom: '0.375rem' }}>
          <input type="checkbox" checked={link.plannerStandalone} onChange={(e) => onPatch({ plannerStandalone: e.target.checked })} />
          Can be placed on its own in the space planner
        </label>
        {view.modelCoverage && (
          <span style={{ fontSize: '0.75rem', color: view.modelCoverage.tagged < view.modelCoverage.variations ? 'var(--color-danger)' : 'var(--color-text-muted)', paddingBottom: '0.45rem' }}>
            3D files tagged “{view.modelCoverage.context}”: {view.modelCoverage.tagged} of {view.modelCoverage.variations} variations
          </span>
        )}
      </div>

      {dirty && (
        <div>
          <button
            type="button"
            style={{ ...btn, background: 'var(--color-primary)', color: 'var(--color-on-primary)', border: 'none', fontWeight: 600 }}
            onClick={() => onPatch({ config, modelContextKey: contextKey })}
          >
            Save add-on rules
          </button>
        </div>
      )}
    </div>
  )
}
