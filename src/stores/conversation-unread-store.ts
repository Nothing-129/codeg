import { create } from "zustand"
import { registerBackendScopedStoreReset } from "@/stores/backend-scoped-store-reset"
import {
  clearUnreadConversationIds,
  loadUnreadConversationIds,
  saveUnreadConversationIds,
} from "@/lib/conversation-unread-storage"

function sameIdSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

export interface ConversationUnreadState {
  unreadIds: ReadonlySet<number>
  viewedIds: ReadonlySet<number>
  visibleIds: ReadonlySet<number>
  noteActivity: (conversationId: number) => void
  markRead: (conversationId: number) => void
  setViewed: (conversationIds: Iterable<number>) => void
  setVisible: (conversationIds: Iterable<number>) => void
  clear: (conversationId: number) => void
}

function persistUnread(ids: ReadonlySet<number>): void {
  saveUnreadConversationIds(ids)
}

export const useConversationUnreadStore = create<ConversationUnreadState>(
  (set, get) => ({
    unreadIds: new Set(loadUnreadConversationIds()),
    viewedIds: new Set(),
    visibleIds: new Set(),

    noteActivity: (conversationId) => {
      if (conversationId <= 0) return
      const { viewedIds, unreadIds } = get()
      if (viewedIds.has(conversationId)) return
      if (unreadIds.has(conversationId)) return
      const next = new Set(unreadIds)
      next.add(conversationId)
      persistUnread(next)
      set({ unreadIds: next })
    },

    markRead: (conversationId) => {
      if (conversationId <= 0) return
      const { unreadIds } = get()
      if (!unreadIds.has(conversationId)) return
      const next = new Set(unreadIds)
      next.delete(conversationId)
      persistUnread(next)
      set({ unreadIds: next })
    },

    setViewed: (conversationIds) => {
      const viewedIds = new Set<number>()
      for (const id of conversationIds) {
        if (id > 0) viewedIds.add(id)
      }
      const { viewedIds: prevViewed, unreadIds } = get()
      const viewedUnchanged = sameIdSet(prevViewed, viewedIds)
      let nextUnread = unreadIds
      if (viewedIds.size > 0 && unreadIds.size > 0) {
        const cleared = new Set(unreadIds)
        let changed = false
        for (const id of viewedIds) {
          if (cleared.delete(id)) changed = true
        }
        if (changed) {
          nextUnread = cleared
          persistUnread(nextUnread)
        }
      }
      if (viewedUnchanged && nextUnread === unreadIds) return
      set({ viewedIds, unreadIds: nextUnread })
    },

    setVisible: (conversationIds) => {
      const visibleIds = new Set<number>()
      for (const id of conversationIds) {
        if (id > 0) visibleIds.add(id)
      }
      if (sameIdSet(get().visibleIds, visibleIds)) return
      set({ visibleIds })
    },

    clear: (conversationId) => {
      if (conversationId <= 0) return
      const { unreadIds, viewedIds } = get()
      const hadUnread = unreadIds.has(conversationId)
      const hadViewed = viewedIds.has(conversationId)
      if (!hadUnread && !hadViewed) return
      let nextUnread = unreadIds
      if (hadUnread) {
        const cleared = new Set(unreadIds)
        cleared.delete(conversationId)
        nextUnread = cleared
      }
      let nextViewed = viewedIds
      if (hadViewed) {
        const cleared = new Set(viewedIds)
        cleared.delete(conversationId)
        nextViewed = cleared
      }
      if (hadUnread) persistUnread(nextUnread)
      set({ unreadIds: nextUnread, viewedIds: nextViewed })
    },
  })
)

export function resetConversationUnreadStore() {
  clearUnreadConversationIds()
  useConversationUnreadStore.setState(
    {
      unreadIds: new Set(),
      viewedIds: new Set(),
      visibleIds: new Set(),
    },
    false
  )
}

registerBackendScopedStoreReset(resetConversationUnreadStore)
