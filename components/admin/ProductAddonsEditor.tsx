'use client'

// The Add-ons panel on a product's edit screen: link products, set each
// option's rule (match / default / choose / fixed), the quantity rule and the
// 3D context key, with the coverage warnings the storefront would otherwise
// discover silently. Saves per link via PATCH; the section payload is
// re-fetched after every write so the warnings always describe what is saved.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminOption, AdminSectionPayload } from '@/modules/product-addons-for-shop/lib/admin-payload'
import type { PadLinkConfig, PadOptionMapping, PadShowWhenRule, PadValueShowWhenRule } from '@/modules/product-addons-for-shop/lib/types'

const API = '/api/m/product-addons-for-shop/admin'

type SearchHit = { id: string; name: string; sku: string | null }

const field: React.CSSProperties = { padding: '0.375rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.8125rem' }
const label: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }
const btn: React.CSSProperties = { ...field, cursor: 'pointer' }

export function ProductAddonsEditor({ productId }: { productId: string }) {
  const [payload, setPayload] = useState<AdminSectionPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  // The product a loop refusal was about, so the way out can be offered by name
  // rather than as an abstract second chance.
  const [loopOffer, setLoopOffer] = useState<SearchHit | null>(null)
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

  async function addLink(hit: SearchHit, hideChildAddons = false) {
    setError(null)
    setLoopOffer(null)
    const res = await fetch(`${API}/products/${productId}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addonProductId: hit.id, ...(hideChildAddons ? { hideChildAddons: true } : {}) }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Could not add that product')
      // A loop is the one refusal with a way out, so it is offered here instead
      // of leaving the owner to work out that the chain is what is in the way.
      if (data.loop) setLoopOffer(hit)
      return
    }
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

  // Swap an add-on with its neighbour and persist the whole new order. Two
  // deliberate choices: the swap shows at once (a list that only moves after a
  // round trip feels broken), and there is NO reload afterwards - a reload
  // hands every LinkEditor a fresh `link` object, which resets its unsaved
  // drafts, and reordering must not cost somebody the rules they were half way
  // through writing. React keeps each editor's state across the move because
  // the rows are keyed by link id. Only a refusal reloads, to show the truth.
  async function moveLink(linkId: string, direction: -1 | 1) {
    if (!payload) return
    const index = payload.links.findIndex((v) => v.link.id === linkId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= payload.links.length) return
    const reordered = [...payload.links]
    const moved = reordered[index]!
    reordered[index] = reordered[target]!
    reordered[target] = moved
    setPayload({ ...payload, links: reordered })
    setError(null)
    const res = await fetch(`${API}/products/${productId}/links/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: reordered.map((v) => v.link.id) }),
    })
    if (!res.ok) {
      setError((await res.json()).error ?? 'Could not save the new order')
      await reload()
    }
  }

  async function removeLink(linkId: string) {
    await fetch(`${API}/links/${linkId}`, { method: 'DELETE' })
    await reload()
  }

  if (!payload) return <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>Loading add-ons…</p>

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
        Products offered alongside this one, bought together as one grouped basket. Each add-on
        keeps its own price, stock and delivery rules. Shoppers meet them in the order below, on
        the product page and in the showcase alike - the arrows change it.
      </p>

      {error && (
        <div style={{ display: 'grid', gap: '0.375rem', justifyItems: 'start' }}>
          <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: '0.8125rem' }}>{error}</p>
          {loopOffer && (
            <button type="button" style={btn} onClick={() => addLink(loopOffer, true)}>
              Add {loopOffer.name} without its own add-ons
            </button>
          )}
        </div>
      )}

      {payload.links.map((view, index) => (
        <LinkEditor
          key={view.link.id}
          view={view}
          index={index}
          count={payload.links.length}
          mainOptions={payload.mainOptions}
          onPatch={(body) => patchLink(view.link.id, body)}
          onMove={(direction) => moveLink(view.link.id, direction)}
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
                <button type="button" style={{ ...btn, width: '100%', textAlign: 'left', border: 'none' }} onClick={() => addLink(hit)}>
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

function LinkEditor({ view, index, count, mainOptions, onPatch, onMove, onRemove }: {
  view: AdminSectionPayload['links'][number]
  index: number
  count: number
  mainOptions: AdminOption[]
  onPatch: (body: Record<string, unknown>) => Promise<void>
  onMove: (direction: -1 | 1) => Promise<void>
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

  function setShowWhen(index: number, patch: Partial<PadShowWhenRule>) {
    const rules = [...(config.showWhen ?? [])]
    const current = rules[index]
    if (!current) return
    rules[index] = { ...current, ...patch }
    patchConfig({ ...config, showWhen: rules })
  }

  function addShowWhen() {
    const first = mainOptions[0]
    if (!first) return
    patchConfig({ ...config, showWhen: [...(config.showWhen ?? []), { mainOption: first.name, valueSlugs: [] }] })
  }

  function removeShowWhen(index: number) {
    patchConfig({ ...config, showWhen: (config.showWhen ?? []).filter((_, i) => i !== index) })
  }

  function setValueShowWhen(index: number, patch: Partial<PadValueShowWhenRule>) {
    const rules = [...(config.valueShowWhen ?? [])]
    const current = rules[index]
    if (!current) return
    rules[index] = { ...current, ...patch }
    patchConfig({ ...config, valueShowWhen: rules })
  }

  function addValueShowWhen() {
    const firstAddon = view.addonOptions[0]
    const firstMain = mainOptions[0]
    if (!firstAddon || !firstMain) return
    patchConfig({
      ...config,
      valueShowWhen: [
        ...(config.valueShowWhen ?? []),
        { addonOption: firstAddon.name, addonValueSlugs: [], mainOption: firstMain.name, mainValueSlugs: [] },
      ],
    })
  }

  function removeValueShowWhen(index: number) {
    patchConfig({ ...config, valueShowWhen: (config.valueShowWhen ?? []).filter((_, i) => i !== index) })
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
        {/* Order controls, in the same shape shop's own category list uses:
            plain arrows, disabled and faded at the ends, each naming the add-on
            it moves so a screen reader is not left with a row of arrows. */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <span style={{ ...label, marginRight: '0.125rem' }}>{index + 1} of {count}</span>
          <button
            type="button" style={{ ...btn, padding: '0.375rem 0.5rem', opacity: index <= 0 ? 0.35 : 1 }}
            disabled={index <= 0} title="Move up" aria-label={`Move ${view.addonName} up`}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button" style={{ ...btn, padding: '0.375rem 0.5rem', opacity: index >= count - 1 ? 0.35 : 1 }}
            disabled={index >= count - 1} title="Move down" aria-label={`Move ${view.addonName} down`}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button type="button" style={{ ...btn, color: 'var(--color-danger)' }} onClick={onRemove}>Remove</button>
        </div>
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
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>No options on this product - the add-on is a single item.</p>
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
                  <option value="recommend">Pick a recommendation, changeable</option>
                  <option value="choose">Shopper chooses</option>
                  <option value="fixed">Always one value</option>
                </select>
                {(mapping.mode === 'match' || mapping.mode === 'default') && (
                  <select style={field} value={mapping.mainOption ?? ''} onChange={(e) => setMapping(option.name, { mainOption: e.target.value })}>
                    <option value="">Pick the main option…</option>
                    {mainOptions.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                  </select>
                )}
                {(mapping.mode === 'fixed' || mapping.mode === 'recommend') && (
                  <select style={field} value={mapping.fixedValueSlug ?? ''} onChange={(e) => setMapping(option.name, { fixedValueSlug: e.target.value })}>
                    <option value="">{mapping.mode === 'fixed' ? 'Pick the value…' : 'Pick the recommended value…'}</option>
                    {option.values.map((v) => <option key={v.slug} value={v.slug}>{v.label}</option>)}
                  </select>
                )}
              </div>
              {(mapping.mode === 'match' || mapping.mode === 'default') && mainOption && (
                <details>
                  <summary style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
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
        <span style={label}>When to offer it</span>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          Leave this alone and the add-on is offered on this product however it is configured. Add a
          condition and it is still offered from the off, but disappears the moment the shopper picks
          a value you have not ticked - a power module is no use on a desk ordered without cable
          ports, so it takes itself off the page there.
        </p>
        {(config.showWhen ?? []).map((rule, ruleIndex) => {
          const ruleOption = mainOptions.find((o) => o.name === rule.mainOption)
          return (
            <div key={ruleIndex} style={{ display: 'grid', gap: '0.375rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--color-border)' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
                <span>Only when</span>
                <select
                  style={field} value={rule.mainOption}
                  onChange={(e) => setShowWhen(ruleIndex, { mainOption: e.target.value, valueSlugs: [] })}
                >
                  {mainOptions.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                </select>
                <span>is</span>
                <button
                  type="button" style={{ ...btn, marginLeft: 'auto', color: 'var(--color-danger)' }}
                  onClick={() => removeShowWhen(ruleIndex)}
                >
                  Remove condition
                </button>
              </div>
              {ruleOption ? (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {ruleOption.values.map((v) => (
                    <label key={v.slug} style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                      <input
                        type="checkbox"
                        checked={rule.valueSlugs.includes(v.slug)}
                        onChange={(e) => setShowWhen(ruleIndex, {
                          valueSlugs: e.target.checked
                            ? [...rule.valueSlugs, v.slug]
                            : rule.valueSlugs.filter((slug) => slug !== v.slug),
                        })}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                  &ldquo;{rule.mainOption}&rdquo; is not an option on this product any more, so the add-on is not being offered at all. Pick another, or remove the condition.
                </span>
              )}
            </div>
          )
        })}
        {mainOptions.length > 0 && (
          <div>
            <button type="button" style={btn} onClick={addShowWhen}>Add a condition</button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: '0.375rem' }}>
        <span style={label}>When to offer each of its choices</span>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          The same idea one level down, for when the add-on fits but one of its sizes does not. Tick
          the choices to govern and the values of this product they suit, and those choices leave the
          menu whenever anything else is picked - an 80cm-deep pedestal has nothing to butt against
          on a desk whose arms are both 600 deep. Everything you do not mention is always offered.
        </p>
        {(config.valueShowWhen ?? []).map((rule, ruleIndex) => {
          const governed = view.addonOptions.find((o) => o.name === rule.addonOption)
          const ruleMain = mainOptions.find((o) => o.name === rule.mainOption)
          return (
            <div key={ruleIndex} style={{ display: 'grid', gap: '0.375rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--color-border)' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
                <span>Offer these</span>
                <select
                  style={field} value={rule.addonOption}
                  onChange={(e) => setValueShowWhen(ruleIndex, { addonOption: e.target.value, addonValueSlugs: [] })}
                >
                  {view.addonOptions.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                </select>
                <span>choices only when</span>
                <select
                  style={field} value={rule.mainOption}
                  onChange={(e) => setValueShowWhen(ruleIndex, { mainOption: e.target.value, mainValueSlugs: [] })}
                >
                  {mainOptions.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                </select>
                <span>is</span>
                <button
                  type="button" style={{ ...btn, marginLeft: 'auto', color: 'var(--color-danger)' }}
                  onClick={() => removeValueShowWhen(ruleIndex)}
                >
                  Remove condition
                </button>
              </div>
              {governed ? (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', minWidth: '5rem' }}>Its choices</span>
                  {governed.values.map((v) => (
                    <label key={v.slug} style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                      <input
                        type="checkbox"
                        checked={rule.addonValueSlugs.includes(v.slug)}
                        onChange={(e) => setValueShowWhen(ruleIndex, {
                          addonValueSlugs: e.target.checked
                            ? [...rule.addonValueSlugs, v.slug]
                            : rule.addonValueSlugs.filter((slug) => slug !== v.slug),
                        })}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                  &ldquo;{rule.addonOption}&rdquo; is not an option on the linked product any more, so this condition does nothing.
                </span>
              )}
              {ruleMain ? (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', minWidth: '5rem' }}>This product</span>
                  {ruleMain.values.map((v) => (
                    <label key={v.slug} style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                      <input
                        type="checkbox"
                        checked={rule.mainValueSlugs.includes(v.slug)}
                        onChange={(e) => setValueShowWhen(ruleIndex, {
                          mainValueSlugs: e.target.checked
                            ? [...rule.mainValueSlugs, v.slug]
                            : rule.mainValueSlugs.filter((slug) => slug !== v.slug),
                        })}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                  &ldquo;{rule.mainOption}&rdquo; is not an option on this product any more, so those choices are never offered. Pick another, or remove the condition.
                </span>
              )}
            </div>
          )
        })}
        {mainOptions.length > 0 && view.addonOptions.length > 0 && (
          <div>
            <button type="button" style={btn} onClick={addValueShowWhen}>Add a condition</button>
          </div>
        )}
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
                <span style={{ color: 'var(--color-text-secondary)' }}>× base</span>
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
        <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: '0.8125rem', paddingBottom: '0.375rem' }}>
          <input
            type="checkbox"
            checked={config.hideChildAddons !== true}
            onChange={(e) => {
              const next = { ...config }
              if (e.target.checked) delete next.hideChildAddons
              else next.hideChildAddons = true
              patchConfig(next)
            }}
          />
          Offer its own add-ons here
        </label>
      </div>
      {config.hideChildAddons === true && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          The chain stops here: whatever this add-on offers on its own page is left there. That is how two products get
          to be add-ons of each other - a coffee table offered with a sofa, and the sofa offered with the coffee table,
          without either page ending up offering itself.
        </p>
      )}

      {contextKey.trim() && view.addonOptions.length > 0 && (
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <span style={label}>Which choices change the combined model</span>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
            Tick an option and the shopper&rsquo;s choice is added to the key, so a different file can be shown for
            each - a pedestal that comes in two widths wants a picture of each. Leave them all clear and one file
            covers the accessory however it is configured.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {view.addonOptions.map((option) => (
              <label key={option.name} style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                <input
                  type="checkbox"
                  checked={(config.modelContextOptions ?? []).some((n) => n.trim().toLowerCase() === option.name.trim().toLowerCase())}
                  onChange={(e) => {
                    const rest = (config.modelContextOptions ?? []).filter((n) => n.trim().toLowerCase() !== option.name.trim().toLowerCase())
                    // Kept in the add-on's own option order, so the key reads
                    // the same way whichever order they were ticked in.
                    const next = e.target.checked
                      ? view.addonOptions.map((o) => o.name).filter((name) => name === option.name || rest.includes(name))
                      : rest
                    patchConfig({ ...config, modelContextOptions: next })
                  }}
                />
                {option.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {view.modelCoverage && view.modelCoverage.length > 0 && (
        <div style={{ display: 'grid', gap: '0.125rem', fontSize: '0.75rem' }}>
          {view.modelCoverage.map((row) => (
            <span key={row.context} style={{ color: row.tagged < row.variations ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
              3D files tagged “{row.context}”: {row.tagged} of {row.variations} variations
            </span>
          ))}
        </div>
      )}

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
