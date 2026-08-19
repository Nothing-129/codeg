import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const badgeWindow = vi.hoisted(() => ({
  setBadgeCount: vi.fn(async () => undefined),
}))
const getCurrentWindowMock = vi.fn(async () => badgeWindow)
const isLocalDesktopMock = vi.fn(() => true)

vi.mock("@/hooks/use-is-mac", () => ({
  useIsMac: () => true,
}))
vi.mock("@/lib/platform", () => ({
  getCurrentWindow: (...args: []) => getCurrentWindowMock(...args),
  isLocalDesktop: (...args: []) => isLocalDesktopMock(...args),
}))
vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ isConversations: false }),
}))
vi.mock("@/lib/conversation-unread", () => ({
  collectViewedConversationIds: vi.fn(() => []),
}))
vi.mock("@/stores/tab-store", () => ({
  useTabStore: {
    getState: () => ({
      tabs: [],
      groupLayout: { id: "root" },
      groupOf: {},
      groupSelection: {},
      tileByGroup: {},
    }),
    subscribe: () => () => {},
  },
}))

import { ConversationUnreadSync } from "./conversation-unread-sync"
import {
  resetConversationUnreadStore,
  useConversationUnreadStore,
} from "@/stores/conversation-unread-store"

describe("ConversationUnreadSync", () => {
  beforeEach(() => {
    localStorage.clear()
    resetConversationUnreadStore()
    vi.clearAllMocks()
  })

  it("syncs visible unread conversations to the macOS Dock badge and clears it", async () => {
    render(<ConversationUnreadSync />)

    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenCalledWith(undefined)
    )

    act(() => {
      useConversationUnreadStore.getState().setVisible([7, 8])
      useConversationUnreadStore.getState().noteActivity(7)
      useConversationUnreadStore.getState().noteActivity(8)
    })
    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenLastCalledWith(2)
    )

    act(() => {
      useConversationUnreadStore.getState().markRead(7)
      useConversationUnreadStore.getState().markRead(8)
    })
    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenLastCalledWith(undefined)
    )
  })

  it("excludes unread conversations hidden from the sidebar", async () => {
    render(<ConversationUnreadSync />)

    act(() => {
      useConversationUnreadStore.getState().setVisible([7])
      useConversationUnreadStore.getState().noteActivity(7)
      useConversationUnreadStore.getState().noteActivity(8)
    })

    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenLastCalledWith(1)
    )
  })

  it("does not touch the local Dock badge outside local desktop mode", async () => {
    isLocalDesktopMock.mockReturnValue(false)
    render(<ConversationUnreadSync />)

    act(() => {
      useConversationUnreadStore.getState().noteActivity(7)
    })

    expect(getCurrentWindowMock).not.toHaveBeenCalled()
    expect(badgeWindow.setBadgeCount).not.toHaveBeenCalled()
  })
})
