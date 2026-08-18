"use client"

/**
 * Global pure-UI preference booleans (conversation-status dots/actions +
 * welcome quick-actions cards), persisted in the backend `app_metadata` table
 * so they survive an app reinstall — their localStorage predecessors lived in
 * the webview container, which uninstall cleanup wipes. Cached at module scope
 * so mounting many consumers (sidebar cards, tabs, dialogs) doesn't refetch.
 *
 * Cross-window reactive: the settings UI and the sidebar view-options menu are
 * SEPARATE windows, so a frontend-only cache would never see the other one's
 * save. The backend broadcasts `ui-preferences://changed` on every write; this
 * store subscribes once per window and updates every mounted hook live — the
 * same backend-emit + frontend-subscribe pattern as `useFeedbackEnabled`.
 *
 * One-time localStorage migration: `getUiPreferences` returns `null` only when
 * no row exists yet, which is the exact signal to seed the row from the legacy
 * keys. The legacy keys are deleted only after the seed write succeeds (a
 * failed write keeps them so the next launch retries), and are deleted
 * unconditionally once the backend has any row — a stale legacy `false` must
 * never resurrect itself after the user re-enabled a toggle.
 */

import { useEffect, useState } from "react"

import {
  getUiPreferences,
  updateUiPreferences,
  type UiPreferences,
} from "@/lib/api"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import { UI_PREFERENCES_CHANGED_EVENT } from "@/lib/types"

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  show_conversation_status: true,
  allow_conversation_status_actions: true,
  show_welcome_quick_actions: true,
}

// Legacy localStorage keys (pre-backend storage). Read once for the seed
// migration; the old writers (conversation-status-prefs / appearance-provider)
// are gone.
const LEGACY_STATUS_DISPLAY_KEY = "workspace:conversation-status-display"
const LEGACY_STATUS_ACTIONS_KEY = "workspace:conversation-status-actions"
const LEGACY_WELCOME_KEY = "codeg-welcome-quick-actions"

let cached: UiPreferences | null = null
let inflight: Promise<UiPreferences | null> | null = null
let saveGeneration = 0
let crossWindowWired = false
const listeners = new Set<(prefs: UiPreferences) => void>()

function notify(prefs: UiPreferences): void {
  for (const listener of listeners) listener(prefs)
}

/** Authoritative update: bump the generation so a slower in-flight initial
 *  load can't overwrite it, set the cache, and notify all mounted hooks.
 *  Shared by the optimistic local apply and the cross-window broadcast. */
function applyPrefs(prefs: UiPreferences): void {
  saveGeneration += 1
  cached = prefs
  notify(prefs)
}

/** Seed/overwrite the cache and notify all mounted hooks. Authoritative and
 *  instant for the saving window; other windows converge via the backend
 *  broadcast. */
export function primeUiPreferences(prefs: UiPreferences): void {
  applyPrefs(prefs)
}

/** Synchronous cache read (null before the first load resolves). Sugar loaders
 *  and the appearance provider use it to initialize without a flash when the
 *  value is already cached. */
export function getCachedUiPreferences(): UiPreferences | null {
  return cached
}

/** Explicit OFF values only — both old readers were default-on, so anything
 *  else (missing key, `"true"`, `"1"`) means "no preference". Returns null when
 *  none of the legacy keys holds a preference. */
function readLegacyUiPreferences(): Partial<UiPreferences> | null {
  if (typeof window === "undefined") return null
  let legacy: Partial<UiPreferences> | null = null
  try {
    if (localStorage.getItem(LEGACY_STATUS_DISPLAY_KEY) === "false") {
      legacy = { ...(legacy ?? {}), show_conversation_status: false }
    }
    if (localStorage.getItem(LEGACY_STATUS_ACTIONS_KEY) === "false") {
      legacy = { ...(legacy ?? {}), allow_conversation_status_actions: false }
    }
    if (localStorage.getItem(LEGACY_WELCOME_KEY) === "0") {
      legacy = { ...(legacy ?? {}), show_welcome_quick_actions: false }
    }
  } catch {
    /* localStorage unavailable — no migration input */
  }
  return legacy
}

function removeLegacyUiPreferenceKeys(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(LEGACY_STATUS_DISPLAY_KEY)
    localStorage.removeItem(LEGACY_STATUS_ACTIONS_KEY)
    localStorage.removeItem(LEGACY_WELCOME_KEY)
  } catch {
    /* ignore */
  }
}

/** Kick off (or reuse) the one-shot initial load, including the one-time
 *  legacy-key migration. Commits only if no explicit update happened while it
 *  was in flight. Resolves `null` only when the transport is unusable (partial
 *  test mocks / startup failure) — callers fall back to defaults. */
function ensureLoaded(): Promise<UiPreferences | null> {
  if (inflight) return inflight
  const startGeneration = saveGeneration
  const legacy = readLegacyUiPreferences()
  // Deferred call: several test suites mock `@/lib/api` with a partial factory
  // where `getUiPreferences` is undefined — a synchronous throw would escape
  // into the mount effect, a rejected microtask is swallowed below.
  inflight = Promise.resolve()
    .then(() => getUiPreferences())
    .catch(() => null)
    .then((fetched) => {
      // A save/broadcast during the fetch is authoritative — don't clobber it
      // (and don't run the migration: another window may have just written the
      // row our fetch predates).
      if (saveGeneration !== startGeneration) return cached ?? fetched
      if (fetched === null) {
        if (legacy) {
          // No row yet + legacy OFF values → seed once. The keys are removed
          // only on a successful write, so a transient failure retries next
          // launch (and the backend broadcast converges other windows).
          const merged = { ...DEFAULT_UI_PREFERENCES, ...legacy }
          cached = merged
          notify(merged)
          void updateUiPreferences(merged)
            .then(() => removeLegacyUiPreferenceKeys())
            .catch(() => {})
          return merged
        }
        cached = DEFAULT_UI_PREFERENCES
        notify(cached)
        return cached
      }
      // Row exists — it is authoritative; any legacy value is stale.
      cached = fetched
      notify(fetched)
      removeLegacyUiPreferenceKeys()
      return fetched
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Wire the cross-window convergence once per window: subscribe to the backend
 *  `ui-preferences://changed` broadcast (a save in the settings window or the
 *  sidebar menu reaches every other window), and re-fetch on WS reconnect since
 *  the broadcaster drops events fired while no client is listening. */
function ensureCrossWindowSync(): void {
  if (crossWindowWired) return
  crossWindowWired = true
  try {
    void subscribe<UiPreferences>(UI_PREFERENCES_CHANGED_EVENT, (prefs) => {
      applyPrefs(prefs)
    }).catch(() => {
      // Wiring failed (e.g. transport not ready yet) — clear the guard so a
      // later mount retries instead of silently never subscribing.
      crossWindowWired = false
    })
    // Returns null on desktop IPC (no disconnect window) → harmless no-op
    // there. Both calls touch the transport synchronously in web mode, so the
    // whole wiring is guarded — a broken transport must not escape into the
    // mount effect (it also clears the guard so a later mount retries).
    onTransportReconnect(() => {
      void Promise.resolve()
        .then(() => getUiPreferences())
        .then((fetched) => {
          if (fetched) applyPrefs(fetched)
        })
        .catch(() => {})
    })
  } catch {
    crossWindowWired = false
  }
}

/** Optimistic-but-authoritative save: applies the patch to the cache
 *  immediately, persists the full blob, and applies the server echo. On
 *  failure the optimistic value is reverted unless a newer write/broadcast
 *  landed meanwhile (generation guard). */
export async function setUiPreferences(
  patch: Partial<UiPreferences>
): Promise<UiPreferences> {
  const prev = cached
  const next = { ...(prev ?? DEFAULT_UI_PREFERENCES), ...patch }
  const gen = saveGeneration
  applyPrefs(next)
  try {
    const saved = await updateUiPreferences(next)
    applyPrefs(saved)
    return saved
  } catch (err) {
    // Revert only if nothing newer (another save, a broadcast) has landed.
    if (saveGeneration === gen + 1) {
      applyPrefs(prev ?? DEFAULT_UI_PREFERENCES)
    }
    throw err
  }
}

export function useUiPreferences(): UiPreferences {
  // Lazy init reads the cache at mount (covers a value cached by an earlier
  // mount/save/broadcast). Subsequent changes — the initial load's commit,
  // every save, and every cross-window broadcast — arrive through `notify`,
  // so the effect never calls setState itself.
  const [prefs, setPrefs] = useState<UiPreferences>(
    () => cached ?? DEFAULT_UI_PREFERENCES
  )

  useEffect(() => {
    ensureCrossWindowSync()
    listeners.add(setPrefs)
    if (cached === null) void ensureLoaded()
    return () => {
      listeners.delete(setPrefs)
    }
  }, [])

  return prefs
}

/** Test-only: reset the module singleton (cache, wiring) between tests. */
export function __resetUiPreferencesStoreForTests(): void {
  cached = null
  inflight = null
  saveGeneration = 0
  crossWindowWired = false
  listeners.clear()
}
