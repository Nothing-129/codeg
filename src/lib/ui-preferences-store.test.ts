import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { UiPreferences } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  getUiPreferences: vi.fn(),
  updateUiPreferences: vi.fn(),
}))

// Capture the backend-broadcast handler the store registers via `subscribe`,
// so tests can simulate a `ui-preferences://changed` event from another window.
let capturedEventHandler: ((prefs: UiPreferences) => void) | null = null
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(
    async (_event: string, handler: (prefs: UiPreferences) => void) => {
      capturedEventHandler = handler
      return () => {}
    }
  ),
  onTransportReconnect: vi.fn(() => null),
}))

const ALL_ON: UiPreferences = {
  show_conversation_status: true,
  allow_conversation_status_actions: true,
  show_welcome_quick_actions: true,
}

// The store caches at module scope; reset the module registry (and the legacy
// localStorage keys the migration reads) so each test starts fresh. Mock call
// history outlives resetModules (the factory result is cached per path), so
// clear it too — the not-called assertions below depend on it.
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  capturedEventHandler = null
  localStorage.clear()
})

async function setup(
  getImpl: () => Promise<UiPreferences | null>,
  updateImpl?: (prefs: UiPreferences) => Promise<UiPreferences>
) {
  const api = await import("@/lib/api")
  vi.mocked(api.getUiPreferences).mockImplementation(getImpl)
  vi.mocked(api.updateUiPreferences).mockImplementation(
    updateImpl ?? ((prefs: UiPreferences) => Promise.resolve(prefs))
  )
  return import("./ui-preferences-store")
}

describe("useUiPreferences", () => {
  it("reflects the fetched value on mount", async () => {
    const { useUiPreferences } = await setup(async () => ({
      ...ALL_ON,
      show_conversation_status: false,
    }))
    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() =>
      expect(result.current.show_conversation_status).toBe(false)
    )
  })

  it("optimistic set applies instantly and persists the full blob", async () => {
    const { useUiPreferences, setUiPreferences } = await setup(
      async () => ALL_ON
    )
    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() => expect(result.current).toEqual(ALL_ON))

    let saved: UiPreferences | null = null
    const api = await import("@/lib/api")
    vi.mocked(api.updateUiPreferences).mockImplementation((prefs) => {
      saved = prefs
      return Promise.resolve(prefs)
    })

    await act(async () => {
      await setUiPreferences({ show_conversation_status: false })
    })
    expect(result.current.show_conversation_status).toBe(false)
    // The persisted payload is the whole object (full-blob update), with the
    // untouched fields carried over from the loaded state.
    expect(saved).toEqual({ ...ALL_ON, show_conversation_status: false })
  })

  it("reverts the optimistic value when the persist fails", async () => {
    const { useUiPreferences, setUiPreferences } = await setup(
      async () => ALL_ON,
      () => Promise.reject(new Error("persist failed"))
    )
    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() => expect(result.current).toEqual(ALL_ON))

    await act(async () => {
      await expect(
        setUiPreferences({ show_welcome_quick_actions: false })
      ).rejects.toThrow("persist failed")
    })
    expect(result.current.show_welcome_quick_actions).toBe(true)
  })

  it("a newer broadcast suppresses the stale revert after a failed save", async () => {
    const { useUiPreferences, setUiPreferences } = await setup(
      async () => ALL_ON,
      () => Promise.reject(new Error("persist failed"))
    )
    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() => expect(result.current).toEqual(ALL_ON))

    let attempt: Promise<unknown>
    act(() => {
      attempt = setUiPreferences({ show_conversation_status: false })
    })
    expect(result.current.show_conversation_status).toBe(false)

    // Another window's save lands while ours is failing — it must win over the
    // revert.
    act(() => {
      capturedEventHandler?.({
        ...ALL_ON,
        allow_conversation_status_actions: false,
      })
    })
    await act(async () => {
      await expect(attempt!).rejects.toThrow("persist failed")
    })
    expect(result.current.show_conversation_status).toBe(true)
    expect(result.current.allow_conversation_status_actions).toBe(false)
  })

  it("converges to a cross-window broadcast (save made in another window)", async () => {
    const { useUiPreferences } = await setup(async () => ALL_ON)
    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() => expect(result.current).toEqual(ALL_ON))

    act(() => {
      capturedEventHandler?.({
        ...ALL_ON,
        show_welcome_quick_actions: false,
      })
    })
    expect(result.current.show_welcome_quick_actions).toBe(false)
  })

  it("a save during the in-flight initial load wins (no stale overwrite)", async () => {
    let resolveFetch: (v: UiPreferences | null) => void = () => {}
    const { useUiPreferences, setUiPreferences } = await setup(
      () =>
        new Promise<UiPreferences | null>((r) => {
          resolveFetch = r
        })
    )
    const { result } = renderHook(() => useUiPreferences())

    // A save lands while the initial fetch is still pending.
    await act(async () => {
      await setUiPreferences({ show_conversation_status: false })
    })
    expect(result.current.show_conversation_status).toBe(false)

    // The stale fetch now resolves with the OLD value — it must NOT clobber
    // the newer save.
    await act(async () => {
      resolveFetch(ALL_ON)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.show_conversation_status).toBe(false)
  })
})

describe("one-time localStorage migration", () => {
  it("seeds the backend row from legacy OFF keys when none exists yet", async () => {
    localStorage.setItem("workspace:conversation-status-display", "false")
    localStorage.setItem("codeg-welcome-quick-actions", "0")
    const { useUiPreferences } = await setup(async () => null)

    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() =>
      expect(result.current.show_conversation_status).toBe(false)
    )
    expect(result.current.show_welcome_quick_actions).toBe(false)
    expect(result.current.allow_conversation_status_actions).toBe(true)

    const api = await import("@/lib/api")
    expect(vi.mocked(api.updateUiPreferences)).toHaveBeenCalledWith({
      show_conversation_status: false,
      allow_conversation_status_actions: true,
      show_welcome_quick_actions: false,
    })
    // Keys are cleared once the seed write succeeds.
    await waitFor(() => {
      expect(
        localStorage.getItem("workspace:conversation-status-display")
      ).toBeNull()
      expect(localStorage.getItem("codeg-welcome-quick-actions")).toBeNull()
    })
  })

  it("keeps legacy keys when the seed write fails (retry next launch)", async () => {
    localStorage.setItem("workspace:conversation-status-actions", "false")
    const { useUiPreferences } = await setup(
      async () => null,
      () => Promise.reject(new Error("seed failed"))
    )

    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() =>
      expect(result.current.allow_conversation_status_actions).toBe(false)
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(localStorage.getItem("workspace:conversation-status-actions")).toBe(
      "false"
    )
  })

  it("ignores stale legacy keys once the backend row exists", async () => {
    localStorage.setItem("codeg-welcome-quick-actions", "0")
    const stored: UiPreferences = {
      ...ALL_ON,
      show_welcome_quick_actions: true,
    }
    const { useUiPreferences } = await setup(async () => stored)

    const { result } = renderHook(() => useUiPreferences())
    await waitFor(() =>
      expect(result.current.show_welcome_quick_actions).toBe(true)
    )
    const api = await import("@/lib/api")
    expect(vi.mocked(api.updateUiPreferences)).not.toHaveBeenCalled()
    // ...and the legacy keys are dropped so they can never resurrect.
    await waitFor(() =>
      expect(localStorage.getItem("codeg-welcome-quick-actions")).toBeNull()
    )
  })

  it("tolerates a partially-mocked api module without crashing", async () => {
    // Simulate a partial api factory (several suites mock `@/lib/api` with only
    // the keys they use): the getter is outright missing, so calling it throws.
    const api = (await import("@/lib/api")) as {
      getUiPreferences?: unknown
    }
    api.getUiPreferences = undefined
    const { useUiPreferences } = await import("./ui-preferences-store")

    const { result } = renderHook(() => useUiPreferences())
    // Falls back to defaults instead of throwing into the mount effect.
    await waitFor(() => expect(result.current).toEqual(ALL_ON))
  })
})
