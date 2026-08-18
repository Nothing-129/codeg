"use client"

import type { AgentType } from "@/lib/types"

const STORAGE_KEY = "codeg:last-selected-agent:v1"

/** Returns the agent most recently picked by the user for a new conversation. */
export function getLastSelectedAgent(): AgentType | null {
  if (typeof window === "undefined") return null
  try {
    const agentType = localStorage.getItem(STORAGE_KEY)
    return agentType ? (agentType as AgentType) : null
  } catch {
    return null
  }
}

/** Saves only explicit user choices; automatic availability fallbacks do not count. */
export function saveLastSelectedAgent(agentType: AgentType) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, agentType)
  } catch {
    /* ignore */
  }
}
