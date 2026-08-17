// Conversation-status UI preference: whether to show the colored status
// (in progress / review / completed / cancelled) and whether the user can
// change it. Persisted in localStorage; both default ON so the main-branch
// status workflow stays available until the user turns a switch off.

import { useEffect, useState } from "react"

const SHOW_STATUS_KEY = "workspace:conversation-status-display"
const ALLOW_ACTIONS_KEY = "workspace:conversation-status-actions"
const SHOW_STATUS_EVENT = "codeg:conversation-status-display-changed"
const ALLOW_ACTIONS_EVENT = "codeg:conversation-status-actions-changed"

function readFlag(key: string): boolean {
  if (typeof window === "undefined") return true
  try {
    // Default ON: only an explicit "false" disables it.
    return localStorage.getItem(key) !== "false"
  } catch {
    return true
  }
}

function writeFlag(key: string, eventName: string, value: boolean): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(eventName, { detail: value }))
}

export function loadConversationStatusDisplay(): boolean {
  return readFlag(SHOW_STATUS_KEY)
}

export function saveConversationStatusDisplay(value: boolean): void {
  writeFlag(SHOW_STATUS_KEY, SHOW_STATUS_EVENT, value)
}

export function loadConversationStatusActions(): boolean {
  return readFlag(ALLOW_ACTIONS_KEY)
}

export function saveConversationStatusActions(value: boolean): void {
  writeFlag(ALLOW_ACTIONS_KEY, ALLOW_ACTIONS_EVENT, value)
}

function useStoredFlag(load: () => boolean, eventName: string): boolean {
  const [enabled, setEnabled] = useState<boolean>(load)
  useEffect(() => {
    const sync = () => setEnabled(load())
    window.addEventListener(eventName, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(eventName, sync)
      window.removeEventListener("storage", sync)
    }
  }, [load, eventName])
  return enabled
}

/** Live read of the "show status colors" preference. */
export function useConversationStatusDisplay(): boolean {
  return useStoredFlag(loadConversationStatusDisplay, SHOW_STATUS_EVENT)
}

/** Live read of the "allow changing status" preference. */
export function useConversationStatusActions(): boolean {
  return useStoredFlag(loadConversationStatusActions, ALLOW_ACTIONS_EVENT)
}

export function useConversationStatusPrefs(): {
  showStatus: boolean
  allowActions: boolean
  setShowStatus: (value: boolean) => void
  setAllowActions: (value: boolean) => void
} {
  const showStatus = useConversationStatusDisplay()
  const allowActions = useConversationStatusActions()
  return {
    showStatus,
    allowActions,
    setShowStatus: saveConversationStatusDisplay,
    setAllowActions: saveConversationStatusActions,
  }
}
