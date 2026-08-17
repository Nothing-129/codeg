"use client"

import { useLayoutEffect } from "react"
import { collectViewedConversationIds } from "@/lib/conversation-unread"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
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

  return null
}
