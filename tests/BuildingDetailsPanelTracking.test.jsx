// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BuildingDetailsPanel from '../src/components/buildings/BuildingDetailsPanel.jsx'

// The Drawer portal deliberately mounts after its parent's first effect.
// This reproduces the lifecycle that previously prevented control tracking.
const geometry = vi.hoisted(() => ({ sheetTop: 300, resize: null, disconnected: false }))

vi.mock('@base-ui/react/drawer', async () => {
  const React = await import('react')
  const Div = React.forwardRef(({ children, ...props }, ref) =>
    React.createElement('div', { ...props, ref }, children))
  const Title = React.forwardRef(({ children, ...props }, ref) =>
    React.createElement('h2', { ...props, ref }, children))

  function DelayedPortal({ children }) {
    const [mounted, setMounted] = React.useState(false)
    React.useEffect(() => {
      const id = setTimeout(() => setMounted(true), 0)
      return () => clearTimeout(id)
    }, [])
    return mounted ? children : null
  }

  return {
    Drawer: {
      Root: ({ children }) => children,
      VirtualKeyboardProvider: ({ children }) => children,
      Portal: DelayedPortal,
      Viewport: Div,
      Popup: React.forwardRef(({ children, initialFocus, ...props }, ref) =>
        React.createElement('div', { ...props, ref, 'data-focus-title': Boolean(initialFocus) }, children)),
      Title,
      Content: Div,
    },
  }
})

const rect = (top, bottom, width) => ({
  x: 0, y: top, top, bottom, left: 0, right: width,
  width, height: bottom - top,
  toJSON() { return this },
})

beforeEach(() => {
  geometry.sheetTop = 300
  geometry.disconnected = false
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { geometry.resize = callback }
    observe() {}
    disconnect() { geometry.disconnected = true }
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('map-layout')) return rect(0, 800, 390)
    if (this.classList.contains('mobile-detail-panel')) return rect(geometry.sheetTop, 784, 360)
    if (this.classList.contains('sheet-visible-area')) {
      return rect(geometry.sheetTop, 784, 360)
    }
    return rect(0, 0, 0)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Panel({ snapIndex }) {
  return (
    <main className="map-layout">
      <BuildingDetailsPanel
        building={null}
        isMobile
        snapPoints={['56px', 0.5, 0.85]}
        snapIndex={snapIndex}
        sheetHeight="50dvh"
        onSnapIndexChange={() => {}}
        onClose={() => {}}
        overviewRequest={0}
      >
        <ul><li>工学部1号館</li></ul>
      </BuildingDetailsPanel>
    </main>
  )
}

it('observes sheet height after a delayed portal mount and stops when the list is closed', async () => {
  const { rerender } = render(<Panel snapIndex={1} />)
  const mapLayout = document.querySelector('.map-layout')

  await waitFor(() => {
    expect(mapLayout.style.getPropertyValue('--map-sheet-height')).toBe('484px')
  })

  // ResizeObserver also handles changes caused by dragging and viewport resizing.
  geometry.sheetTop = 400
  act(() => geometry.resize())
  expect(mapLayout.style.getPropertyValue('--map-sheet-height')).toBe('384px')

  // The collapsed list is a separate button, so there is no hidden Drawer to measure.
  await act(async () => rerender(<Panel snapIndex={0} />))
  await waitFor(() => {
    expect(mapLayout.style.getPropertyValue('--map-sheet-height')).toBe('')
    expect(document.querySelector('.mobile-detail-panel')).toBeNull()
    expect(document.querySelector('.mobile-list-button')).toBeTruthy()
    expect(geometry.disconnected).toBe(true)
  })
})
