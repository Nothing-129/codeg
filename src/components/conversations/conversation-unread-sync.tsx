"use client"

import { useEffect, useLayoutEffect, useMemo } from "react"
import { useIsMac } from "@/hooks/use-is-mac"
import { collectViewedConversationIds } from "@/lib/conversation-unread"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { getCurrentWindow, isLocalDesktop } from "@/lib/platform"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useTabStore } from "@/stores/tab-store"

/**
 * Codex-style unread: a thread that produces a settled update (new messages
 * or a non-running status) while you are looking at something else gets
 * `unread = true`; opening it again clears the flag. In-progress streaming
 * is the running spinner, not unread. Activity is noted in the workspace
 * store; this component only tracks which threads are on screen.
 */
export function ConversationUnreadSync() {
  const { isConversations } = useWorkbenchRoute()
  const isMac = useIsMac()
  const unreadIds = useConversationUnreadStore((s) => s.unreadIds)
  const visibleIds = useConversationUnreadStore((s) => s.visibleIds)
  const unreadCount = useMemo(() => {
    let count = 0
    for (const id of unreadIds) {
      if (visibleIds.has(id)) count += 1
    }
    return count
  }, [unreadIds, visibleIds])

  useLayoutEffect(() => {
    const syncViewed = () => {
      const { tabs, groupLayout, groupOf, groupSelection, tileByGroup } =
        useTabStore.getState()
      useConversationUnreadStore.getState().setViewed(
        collectViewedConversationIds({
          isConversationsRoute: isConversations,
          tabs,
          groupLayout,
          groupOf,
          groupSelection,
          tileByGroup,
        })
      )
    }
    syncViewed()
    return useTabStore.subscribe(syncViewed)
  }, [isConversations])

  useEffect(() => {
    if (!isMac || !isLocalDesktop()) return

    let cancelled = false
    void (async () => {
      const window = await getCurrentWindow()
      if (cancelled || window == null) return
      try {
        await window.setBadgeCount(unreadCount > 0 ? unreadCount : undefined)
      } catch (error) {
        console.error(
          "[ConversationUnread] failed to update Dock badge:",
          error
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isMac, unreadCount])

  return null
}
