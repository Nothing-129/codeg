/**
 * Shared gate for the ACP connection teardowns that fire on their own — no
 * user asked for them — so they can't drift apart:
 *
 *   * the tab-unmount cleanup (`shouldDisconnectOnUnmount`)
 *   * the preview-tab release (`disconnectIfIdle`), fired when the next
 *     single-click in the sidebar takes the preview slot
 *
 * (The idle sweep enforces the same rule inline, alongside guards this
 * predicate can't express: `connecting`, viewers, delegation children.)
 */

import { extractAppCommandError, toErrorMessage } from "@/lib/app-error"

/**
 * Work that an `acpDisconnect` would DESTROY rather than merely detach from.
 * The backend tears a connection down unconditionally, so the agent CLI dies
 * with its in-flight turn — which agents record in their own transcript as an
 * interrupted request — and any launched-but-unresolved background task
 * (async sub-agent / background shell) dies with it.
 *
 * Only OWNERS need this gate: a viewer's teardown detaches and never kills
 * anything, and the sweeps skip viewers, so one left attached leaks its
 * subscription. An explicit `disconnect` ignores it by design — that path
 * carries user intent (agent switch, restart-to-apply, an explicit close).
 */
export function isConnectionBusy(conn: {
  status: string | null
  backgroundOutstanding: number
}): boolean {
  return conn.status === "prompting" || conn.backgroundOutstanding > 0
}

// Must mirror `AcpError::ConnectionNotFound`'s code in
// src-tauri/src/acp/error.rs. If the backend enum ever renames, both sides
// must change together.
export const CONNECTION_NOT_FOUND_CODE = "connection_not_found"

/**
 * A teardown that failed because the connection was ALREADY gone — another
 * window reaped it, the agent process died, or the backend restarted. For
 * every purpose that counts as a successful teardown: the backend is holding
 * nothing, and the local entry is simply stale.
 *
 * Worth telling apart because every OTHER failure (a transport blip, a backend
 * that never processed the request) may leave the agent process ALIVE, and a
 * caller that reports "restarted, config applied" on one of those is lying —
 * the next connect can re-attach to the very process it believed it replaced.
 *
 * The message fallback mirrors the variant's `#[error("connection not found:
 * {0}")]` text: a synchronous Tauri command rejection flattens to a bare
 * message string and does not expose the error `code` (the same reason
 * `connect()` matches on the literal "is not installed").
 */
export function isConnectionGoneError(error: unknown): boolean {
  const appError = extractAppCommandError(error)
  if (appError?.code === CONNECTION_NOT_FOUND_CODE) return true
  return toErrorMessage(error).toLowerCase().includes("connection not found")
}
