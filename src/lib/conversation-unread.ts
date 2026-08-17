import { firstLeafId, leafIds, type LayoutNode } from "@/lib/tab-group-layout"
import type { DbConversationSummary } from "@/lib/types"

/** The sidebar spinner already covers this — unread is for settled updates. */
export function isRunningConversationStatus(
  status: string | null | undefined
): boolean {
  return status === "in_progress"
}

/**
 * New content the user should come back for. In-progress streaming is not
 * unread — that is the running spinner, not Codex's "you missed a result".
 */
export function isConversationActivity(
  prev: Pick<DbConversationSummary, "message_count" | "status" | "child_count">,
  next: Pick<DbConversationSummary, "message_count" | "status" | "child_count">
): boolean {
  if (isRunningConversationStatus(next.status)) return false
  return (
    prev.message_count !== next.message_count ||
    prev.status !== next.status ||
    prev.child_count !== next.child_count
  )
}

export interface ViewedConversationSource {
  isConversationsRoute: boolean
  tabs: Array<{ id: string; conversationId: number | null }>
  groupLayout: LayoutNode
  groupOf: Record<string, string>
  groupSelection: Record<string, string>
  tileByGroup: Record<string, boolean>
}

/**
 * Conversation ids the user can actually see right now. Background tabs, other
 * workbench routes (Tasks / Automations), and drafts are excluded — those
 * threads can accumulate unread independently, matching Codex Unread chats.
 */
export function collectViewedConversationIds(
  source: ViewedConversationSource
): number[] {
  if (!source.isConversationsRoute) return []
  const leaves = leafIds(source.groupLayout)
  if (leaves.length === 0) return []
  const fallbackGroup = firstLeafId(source.groupLayout)
  const ids: number[] = []
  const seen = new Set<number>()
  for (const tab of source.tabs) {
    if (tab.conversationId == null || tab.conversationId <= 0) continue
    const groupId = source.groupOf[tab.id] ?? fallbackGroup
    const visible = source.tileByGroup[groupId]
      ? true
      : source.groupSelection[groupId] === tab.id
    if (!visible || seen.has(tab.conversationId)) continue
    seen.add(tab.conversationId)
    ids.push(tab.conversationId)
  }
  return ids
}
