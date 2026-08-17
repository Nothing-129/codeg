import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
}))

import { conversationUnreadStorageKey } from "@/lib/conversation-unread-storage"
import {
  resetConversationUnreadStore,
  useConversationUnreadStore,
} from "./conversation-unread-store"

describe("conversation-unread-store", () => {
  beforeEach(() => {
    localStorage.clear()
    resetConversationUnreadStore()
  })

  it("marks a background thread unread and persists it", () => {
    useConversationUnreadStore.getState().noteActivity(7)
    expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(true)
    expect(localStorage.getItem(conversationUnreadStorageKey())).toBe("[7]")
  })

  it("does not mark a currently viewed thread unread", () => {
    useConversationUnreadStore.getState().setViewed([7])
    useConversationUnreadStore.getState().noteActivity(7)
    expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(false)
  })

  it("clears unread when the thread becomes viewed", () => {
    useConversationUnreadStore.getState().noteActivity(7)
    useConversationUnreadStore.getState().setViewed([7, 8])
    expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(false)
    expect(useConversationUnreadStore.getState().viewedIds.has(7)).toBe(true)
    expect(localStorage.getItem(conversationUnreadStorageKey())).toBe("[]")
  })

  it("ignores non-positive ids and is idempotent", () => {
    useConversationUnreadStore.getState().noteActivity(-3)
    useConversationUnreadStore.getState().noteActivity(0)
    useConversationUnreadStore.getState().noteActivity(4)
    useConversationUnreadStore.getState().noteActivity(4)
    expect([...useConversationUnreadStore.getState().unreadIds]).toEqual([4])
  })

  it("drops a deleted thread from unread and viewed", () => {
    useConversationUnreadStore.getState().setViewed([4])
    useConversationUnreadStore.getState().noteActivity(5)
    useConversationUnreadStore.getState().clear(4)
    useConversationUnreadStore.getState().clear(5)
    expect(useConversationUnreadStore.getState().unreadIds.size).toBe(0)
    expect(useConversationUnreadStore.getState().viewedIds.has(4)).toBe(false)
  })
})
