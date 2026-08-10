'use client'

// The sidebar page: Overview (every link in the catalogue, with its health at
// a glance) and Attach rate (how often the add-ons actually sell with their
// products, from the orders themselves).
import { useEffect, useState } from 'react'

const API = '/api/m/product-addons-for-shop/admin'

type OverviewRow = {
  id: string; enabled: boolean; modelContextKey: string
  productId: string; productName: string; addonProductId: string; addonName: string
  quantityMode: 'recommended' | 'free'; mappings: number
}

type ReportRow = {
  linkId: string; productName: string; addonName: string
  mainOrders: number; attachedOrders: number; attachRate: number; unitsSold: number; revenue: number
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600, padding: '0.375rem 0.75rem', borderBottom: '1px solid var(--color-border)' }
const td: React.CSSProperties = { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.8125rem', verticalAlign: 'top' }
const tabBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--color-primary)' : 'transparent',
  color: active ? 'var(--color-on-primary)' : 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.375rem 0.875rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600,
})

export function AddonsScreen() {
  const [tab, setTab] = useState<'overview' | 'report'>('overview')
  const [overview, setOverview] = useState<OverviewRow[] | null>(null)
  const [report, setReport] = useState<ReportRow[] | null>(null)
  const [from, setFrom] = useState(() => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    fetch(`${API}/overview`).then((r) => (r.ok ? r.json() : null)).then((d) => setOverview(d?.links ?? []))
  }, [])

  useEffect(() => {
    if (tab !== 'report') return
    // Stale rows stay on screen while the fresh range loads (the working note
    // shows only before the first load) - and only the newest request lands.
    let cancelled = false
    fetch(`${API}/report?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setReport(d?.rows ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tab, from, to])

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" style={tabBtn(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" style={tabBtn(tab === 'report')} onClick={() => setTab('report')}>Attach rate</button>
      </div>

      {tab === 'overview' && (
        overview == null ? <p style={{ color: 'var(--color-text-secondary)' }}>Loading…</p> :
        overview.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Nothing linked yet. Open a product and use its Add-ons section to offer another product alongside it.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={th}>Product</th><th style={th}>Add-on</th><th style={th}>Offered</th>
                <th style={th}>Quantity</th><th style={th}>Option rules</th><th style={th}>3D context</th><th style={th} aria-label="Edit" />
              </tr></thead>
              <tbody>
                {overview.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{row.productName}</td>
                    <td style={td}>{row.addonName}</td>
                    <td style={td}>{row.enabled ? 'Yes' : 'No'}</td>
                    <td style={td}>{row.quantityMode === 'free' ? 'Shopper decides' : 'Recommended'}</td>
                    <td style={td}>{row.mappings}</td>
                    <td style={td}>{row.modelContextKey || '-'}</td>
                    <td style={td}>
                      <a href={`/cactus-admin/m/shop/products/${row.productId}`} style={{ color: 'var(--color-primary)' }}>Edit on product</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'report' && (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
            <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
              From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: '0.25rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
              To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: '0.25rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
            </label>
          </div>
          {report == null ? <p style={{ color: 'var(--color-text-secondary)' }}>Working it out…</p> :
          report.length === 0 ? <p style={{ color: 'var(--color-text-secondary)' }}>No add-ons configured yet, so nothing to report.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={th}>Product</th><th style={th}>Add-on</th>
                  <th style={th}>Orders with product</th><th style={th}>Bought together</th>
                  <th style={th}>Attach rate</th><th style={th}>Units</th><th style={th}>Add-on revenue</th>
                </tr></thead>
                <tbody>
                  {report.map((row) => (
                    <tr key={row.linkId}>
                      <td style={td}>{row.productName}</td>
                      <td style={td}>{row.addonName}</td>
                      <td style={td}>{row.mainOrders}</td>
                      <td style={td}>{row.attachedOrders}</td>
                      <td style={td}>{(row.attachRate * 100).toFixed(0)}%</td>
                      <td style={td}>{row.unitsSold}</td>
                      <td style={td}>£{row.revenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
