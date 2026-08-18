import { AGENT_DISPLAY_ORDER, type AgentType } from "@/lib/types"

export interface ResolveDefaultAgentInput {
  /** Agent most recently selected by the user, shared across all projects. */
  lastSelected: AgentType | null
  /** Folder's saved `default_agent_type`, or null if none set. */
  folderDefault: AgentType | null
  /**
   * Agent to inherit when "new conversation" is launched from inside a
   * real conversation context (caller passes the active tab's agentType
   * only when its `conversationId != null`).
   */
  inherit: AgentType | null
  /**
   * User-sorted list of enabled+available agents. Empty during cold start
   * before the first successful `acpListAgents()` call.
   */
  sortedTypes: AgentType[]
  /** True once `acpListAgents()` has succeeded at least once this session. */
  fresh: boolean
}

export interface ResolveDefaultAgentResult {
  agentType: AgentType
  /**
   * True when the returned `agentType` is a "best guess" tentative value
   * that should be re-evaluated once the agent list becomes fresh — the
   * caller (TabProvider) tracks this on draft tabs and patches them when
   * fresh data arrives. Always false when `agentType` came from either
   * `folderDefault` or `inherit` (those are explicit user intent).
   */
  provisional: boolean
}

/**
 * Decide which agent a freshly-opened conversation should use. Pure
 * function — no side effects, no React, no DB. Lives outside hooks so the
 * priority rules can be reasoned about (and one day unit-tested) without
 * spinning up a renderer.
 *
 * Priority (highest first):
 *   1. `lastSelected` — the user's most recent explicit selection, shared
 *      across all projects.
 *   2. `folderDefault` — used only until the user has selected an agent.
 *   3. `inherit` — "new conversation" launched from inside an existing
 *      conversation should produce another conversation with the same agent.
 *   4. `sortedTypes[0]` — first entry of the user-managed drag-sorted list.
 *   5. `AGENT_DISPLAY_ORDER[0]` — final fallback when even the sorted list
 *      isn't available yet (cold start).
 *
 * The result is marked `provisional: true` for cases 3 and 4 when `fresh`
 * is false — i.e. the sorted list might still be stale or empty seed data
 * from localStorage, and the caller should re-resolve once fresh data
 * arrives.
 */
export function resolveDefaultAgent(
  input: ResolveDefaultAgentInput
): ResolveDefaultAgentResult {
  const { lastSelected, folderDefault, inherit, sortedTypes, fresh } = input
  if (lastSelected) {
    return { agentType: lastSelected, provisional: false }
  }
  if (folderDefault) {
    return { agentType: folderDefault, provisional: false }
  }
  if (inherit) {
    return { agentType: inherit, provisional: false }
  }
  if (sortedTypes.length > 0) {
    return { agentType: sortedTypes[0], provisional: !fresh }
  }
  return { agentType: AGENT_DISPLAY_ORDER[0], provisional: !fresh }
}
