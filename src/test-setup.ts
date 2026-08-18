import "@testing-library/jest-dom/vitest"

// Node ≥ 25 ships an experimental `localStorage` global whose getter returns
// undefined unless --localstorage-file was passed. vitest's jsdom environment
// leaves that getter on the shared global in place of jsdom's implementation,
// so every test touching localStorage breaks on those Node versions. Install a
// minimal in-memory Storage when the global is missing (older Node + plain
// jsdom environments already provide a real one and are untouched).
if (typeof window !== "undefined" && window.localStorage === undefined) {
  class MemoryStorage {
    private map = new Map<string, string>()

    get length(): number {
      return this.map.size
    }

    key(index: number): string | null {
      return [...this.map.keys()][index] ?? null
    }

    getItem(key: string): string | null {
      return this.map.get(String(key)) ?? null
    }

    setItem(key: string, value: string): void {
      this.map.set(String(key), String(value))
    }

    removeItem(key: string): void {
      this.map.delete(String(key))
    }

    clear(): void {
      this.map.clear()
    }
  }

  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}

// jsdom doesn't implement window.matchMedia (components like
// use-is-coarse-pointer / use-mobile query pointer capabilities on mount).
// Stub the small surface they use.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom doesn't implement a few layout APIs that ProseMirror's EditorView
// touches on mount (used by Tiptap-based editors such as the message composer).
// Polyfill them as no-ops so headless/component editor tests can construct a
// view. Only defined when missing, so real browsers/environments are untouched.
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null
}
if (typeof Element !== "undefined") {
  // jsdom doesn't implement scrollIntoView; the composer's suggestion popup
  // calls it to keep the active row visible.
  Element.prototype.scrollIntoView ??= () => {}
  // jsdom doesn't implement Pointer Capture; Radix menus/popovers touch these
  // during the pointer interactions @testing-library/user-event drives.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
}
if (typeof globalThis !== "undefined" && !("ResizeObserver" in globalThis)) {
  // jsdom doesn't implement ResizeObserver; cmdk (the command palette used by
  // the branch/folder pickers) constructs one on mount. A no-op stub is enough
  // for headless rendering — layout callbacks never need to fire.
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    }) as DOMRect
}
