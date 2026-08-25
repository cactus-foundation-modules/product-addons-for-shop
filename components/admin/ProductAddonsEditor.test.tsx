// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { LinkEditor } from '@/modules/product-addons-for-shop/components/admin/ProductAddonsEditor'
import type { AdminOption, AdminSectionPayload } from '@/modules/product-addons-for-shop/lib/admin-payload'

// A saved add-on is a line in a list until somebody presses Edit. What the
// closed line must still carry is the point of these tests: hiding a warning,
// a switched-off add-on or an unsaved draft behind Edit is the one way this
// could quietly cost a sale.

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const mainOptions = [{ name: 'Finish', values: [{ slug: 'oak', label: 'Oak' }] }] as unknown as AdminOption[]

function makeView(over: { enabled?: boolean; warnings?: string[] } = {}) {
  return {
    link: {
      id: 'l1', productId: 'p1', addonProductId: 'p2', enabled: over.enabled ?? true, sortOrder: 0,
      modelContextKey: '', plannerStandalone: false,
      config: { optionMappings: [], quantity: { mode: 'recommended', base: 1 } },
    },
    addonName: 'Mobile Pedestal',
    addonOptions: [{ name: 'Width', values: [{ slug: '40', label: '40cm' }] }],
    warnings: over.warnings ?? [],
    modelCoverage: [],
  } as unknown as AdminSectionPayload['links'][number]
}

function props(view: AdminSectionPayload['links'][number], onPatch = vi.fn(async () => true)) {
  return { view, index: 1, count: 3, mainOptions, onPatch, onMove: vi.fn(async () => {}), onRemove: vi.fn(async () => {}) }
}

function buttonWith(host: HTMLElement, text: string) {
  const hit = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!hit) throw new Error(`No "${text}" button. Buttons: ${[...host.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`)
  return hit
}

async function mount(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(node) })
  return host
}

describe('LinkEditor, collapsed', () => {
  it('is the header row and nothing else', () => {
    const html = renderToStaticMarkup(<LinkEditor {...props(makeView())} startExpanded={false} />)
    expect(html).toContain('Mobile Pedestal')
    expect(html).toContain('2 of 3')
    expect(html).toContain('Edit Mobile Pedestal')
    expect(html).toContain('Remove')
    expect(html).not.toContain('How each of its options is decided')
    expect(html).not.toContain('When to offer it')
    expect(html).not.toContain('3D context key')
    // The enabled tick lives inside now, so the closed line is a list entry
    // rather than a control strip.
    expect(html).not.toContain('type="checkbox"')
  })

  it('still says a switched-off add-on is switched off, and counts its warnings', () => {
    const html = renderToStaticMarkup(
      <LinkEditor {...props(makeView({ enabled: false, warnings: ['No matching width', 'No 3D file'] }))} startExpanded={false} />,
    )
    expect(html).toContain('Not offered on the product page')
    expect(html).toContain('2 warnings')
  })

  it('opens on Edit and shuts again on Close', async () => {
    const host = await mount(<LinkEditor {...props(makeView())} startExpanded={false} />)
    await act(async () => { buttonWith(host, 'Edit').click() })
    expect(host.textContent).toContain('How each of its options is decided')
    expect(host.textContent).toContain('Offered on the product page')
    await act(async () => { buttonWith(host, 'Close').click() })
    expect(host.textContent).not.toContain('How each of its options is decided')
  })

  it('starts open when it is the add-on that was just added', async () => {
    const host = await mount(<LinkEditor {...props(makeView())} startExpanded />)
    expect(host.textContent).toContain('3D context key')
  })
})

describe('LinkEditor, saving', () => {
  it('shuts itself over a save that landed', async () => {
    const onPatch = vi.fn(async () => true)
    const host = await mount(<LinkEditor {...props(makeView(), onPatch)} startExpanded />)
    await act(async () => { buttonWith(host, 'Add a condition').click() })
    await act(async () => { buttonWith(host, 'Save add-on rules').click() })
    expect(onPatch).toHaveBeenCalledOnce()
    expect(host.textContent).not.toContain('3D context key')
  })

  it('stays open over a refusal, draft and all', async () => {
    const onPatch = vi.fn(async () => false)
    const host = await mount(<LinkEditor {...props(makeView(), onPatch)} startExpanded />)
    await act(async () => { buttonWith(host, 'Add a condition').click() })
    await act(async () => { buttonWith(host, 'Save add-on rules').click() })
    expect(host.textContent).toContain('3D context key')
    expect(buttonWith(host, 'Save add-on rules')).toBeTruthy()
  })

  it('says so on the closed line when rules were left unsaved', async () => {
    const host = await mount(<LinkEditor {...props(makeView())} startExpanded />)
    await act(async () => { buttonWith(host, 'Add a condition').click() })
    await act(async () => { buttonWith(host, 'Close').click() })
    expect(host.textContent).toContain('Unsaved changes')
  })
})
