import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import {
  loadConversationStatusActions,
  loadConversationStatusDisplay,
  saveConversationStatusActions,
  saveConversationStatusDisplay,
  useConversationStatusPrefs,
} from "./conversation-status-prefs"

describe("conversation status preferences", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("defaults both switches on", () => {
    expect(loadConversationStatusDisplay()).toBe(true)
    expect(loadConversationStatusActions()).toBe(true)
  })

  it("round-trips each switch independently", () => {
    saveConversationStatusDisplay(false)
    expect(loadConversationStatusDisplay()).toBe(false)
    expect(loadConversationStatusActions()).toBe(true)

    saveConversationStatusActions(false)
    expect(loadConversationStatusDisplay()).toBe(false)
    expect(loadConversationStatusActions()).toBe(false)

    saveConversationStatusDisplay(true)
    expect(loadConversationStatusDisplay()).toBe(true)
    expect(loadConversationStatusActions()).toBe(false)
  })

  it("updates live subscribers without a reload", () => {
    const { result } = renderHook(() => useConversationStatusPrefs())
    expect(result.current.showStatus).toBe(true)
    expect(result.current.allowActions).toBe(true)

    act(() => {
      result.current.setShowStatus(false)
      result.current.setAllowActions(false)
    })

    expect(result.current.showStatus).toBe(false)
    expect(result.current.allowActions).toBe(false)
  })
})
