// Conversation-status UI preference: whether to show the colored status
// (in progress / review / completed / cancelled) and whether the user can
// change it. Backed by the backend-persisted UiPreferences store
// (`app_metadata`), so the toggles survive an app reinstall; both default ON
// so the main-branch status workflow stays available until the user turns a
// switch off. Thin sugar over `@/lib/ui-preferences-store` — consumers keep
// the historical load/save/use API surface.

import {
  DEFAULT_UI_PREFERENCES,
  getCachedUiPreferences,
  setUiPreferences,
  useUiPreferences,
} from "@/lib/ui-preferences-store"

/** Synchronous read of the "show status colors" preference (cache only). */
export function loadConversationStatusDisplay(): boolean {
  return (getCachedUiPreferences() ?? DEFAULT_UI_PREFERENCES)
    .show_conversation_status
}

/** Synchronous read of the "allow changing status" preference (cache only). */
export function loadConversationStatusActions(): boolean {
  return (getCachedUiPreferences() ?? DEFAULT_UI_PREFERENCES)
    .allow_conversation_status_actions
}

/** Optimistic save; persists to the backend and reverts on failure (rejects
 *  after the revert — callers that care surface a toast). */
export function saveConversationStatusDisplay(value: boolean): Promise<void> {
  return setUiPreferences({ show_conversation_status: value }).then(
    () => undefined
  )
}

/** See {@link saveConversationStatusDisplay}. */
export function saveConversationStatusActions(value: boolean): Promise<void> {
  return setUiPreferences({ allow_conversation_status_actions: value }).then(
    () => undefined
  )
}

/** Live read of the "show status colors" preference. */
export function useConversationStatusDisplay(): boolean {
  return useUiPreferences().show_conversation_status
}

/** Live read of the "allow changing status" preference. */
export function useConversationStatusActions(): boolean {
  return useUiPreferences().allow_conversation_status_actions
}

export function useConversationStatusPrefs(): {
  showStatus: boolean
  allowActions: boolean
  setShowStatus: (value: boolean) => Promise<void>
  setAllowActions: (value: boolean) => Promise<void>
} {
  const prefs = useUiPreferences()
  return {
    showStatus: prefs.show_conversation_status,
    allowActions: prefs.allow_conversation_status_actions,
    setShowStatus: saveConversationStatusDisplay,
    setAllowActions: saveConversationStatusActions,
  }
}
