import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  loadConversationStatusActions,
  loadConversationStatusDisplay,
  saveConversationStatusActions,
  saveConversationStatusDisplay,
  useConversationStatusPrefs,
} from "./conversation-status-prefs"

// The prefs are backend-persisted through the UiPreferences store; mock the
// transport-facing api (and platform broadcast wiring) so no real transport
// is constructed.
vi.mock("@/lib/api", () => ({
  getUiPreferences: vi.fn(async () => null),
  updateUiPreferences: vi.fn((prefs: unknown) => Promise.resolve(prefs)),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async () => () => {}),
  onTransportReconnect: vi.fn(() => null),
}))

import { __resetUiPreferencesStoreForTests } from "./ui-preferences-store"

describe("conversation status preferences", () => {
  beforeEach(() => {
    localStorage.clear()
    __resetUiPreferencesStoreForTests()
  })

  it("defaults both switches on", () => {
    expect(loadConversationStatusDisplay()).toBe(true)
    expect(loadConversationStatusActions()).toBe(true)
  })

  it("round-trips each switch independently", async () => {
    await saveConversationStatusDisplay(false)
    expect(loadConversationStatusDisplay()).toBe(false)
    expect(loadConversationStatusActions()).toBe(true)

    await saveConversationStatusActions(false)
    expect(loadConversationStatusDisplay()).toBe(false)
    expect(loadConversationStatusActions()).toBe(false)

    await saveConversationStatusDisplay(true)
    expect(loadConversationStatusDisplay()).toBe(true)
    expect(loadConversationStatusActions()).toBe(false)
  })

  it("updates live subscribers without a reload", () => {
    const { result } = renderHook(() => useConversationStatusPrefs())
    expect(result.current.showStatus).toBe(true)
    expect(result.current.allowActions).toBe(true)

    act(() => {
      void result.current.setShowStatus(false)
      void result.current.setAllowActions(false)
    })

    expect(result.current.showStatus).toBe(false)
    expect(result.current.allowActions).toBe(false)
  })
})
