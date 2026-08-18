"use client"

import type { SessionConfigOptionInfo, SessionModeStateInfo } from "@/lib/types"

/**
 * Per-agentType catalog of session selectors (modes + config/model options).
 *
 * The live list only arrives after `session/new`. New conversations used to
 * wait on that spawn before the composer could render a model picker. This
 * cache is the last catalog a real session advertised, so the picker can
 * paint immediately and the in-flight connect still refreshes it.
 */

export interface CachedSelectors {
  modes: SessionModeStateInfo | null
  configOptions: SessionConfigOptionInfo[] | null
}

const STORAGE_KEY = "codeg:selectors-cache:v1"

const memory = new Map<string, CachedSelectors>()
let hydrated = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isModeState(value: unknown): value is SessionModeStateInfo {
  if (!isRecord(value)) return false
  if (typeof value.current_mode_id !== "string") return false
  if (!Array.isArray(value.available_modes)) return false
  return value.available_modes.every(
    (mode) =>
      isRecord(mode) &&
      typeof mode.id === "string" &&
      typeof mode.name === "string"
  )
}

function isSelectOption(value: unknown): boolean {
  return isRecord(value) && typeof value.value === "string"
}

function isConfigOption(value: unknown): value is SessionConfigOptionInfo {
  if (!isRecord(value) || typeof value.id !== "string") return false
  if (!isRecord(value.kind) || typeof value.kind.type !== "string") return false
  if (value.kind.type === "select") {
    return (
      typeof value.kind.current_value === "string" &&
      Array.isArray(value.kind.options) &&
      value.kind.options.every(isSelectOption)
    )
  }
  if (value.kind.type === "boolean") {
    return typeof value.kind.current_value === "boolean"
  }
  return false
}

function isCachedSelectors(value: unknown): value is CachedSelectors {
  if (!isRecord(value)) return false
  if (value.modes != null && !isModeState(value.modes)) return false
  if (value.configOptions != null) {
    if (!Array.isArray(value.configOptions)) return false
    if (!value.configOptions.every(isConfigOption)) return false
  }
  return true
}

function persistAll(): void {
  if (typeof window === "undefined") return
  const payload: Record<string, CachedSelectors> = {}
  for (const [agentType, entry] of memory) {
    payload[agentType] = entry
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode — memory cache still works this session */
  }
}

function ensureHydrated(): void {
  if (hydrated) return
  hydrated = true
  if (typeof window === "undefined") return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!isRecord(parsed)) return
    for (const [agentType, entry] of Object.entries(parsed)) {
      if (typeof agentType !== "string" || !isCachedSelectors(entry)) continue
      memory.set(agentType, {
        modes: entry.modes ?? null,
        configOptions: entry.configOptions ?? null,
      })
    }
  } catch {
    /* ignore corrupt cache */
  }
}

export function getCachedSelectors(agentType: string): CachedSelectors | null {
  ensureHydrated()
  return memory.get(agentType) ?? null
}

export function updateCachedSelectors(
  agentType: string,
  patch: Partial<CachedSelectors>
): CachedSelectors {
  ensureHydrated()
  const prev = memory.get(agentType) ?? { modes: null, configOptions: null }
  const next: CachedSelectors = {
    modes: patch.modes !== undefined ? patch.modes : prev.modes,
    configOptions:
      patch.configOptions !== undefined
        ? patch.configOptions
        : prev.configOptions,
  }
  memory.set(agentType, next)
  persistAll()
  return next
}

/** Seed an empty-or-unknown entry so "this agent has no selectors" is cached. */
export function ensureCachedSelectors(
  agentType: string,
  fallback: CachedSelectors
): void {
  ensureHydrated()
  if (memory.has(agentType)) return
  memory.set(agentType, fallback)
  persistAll()
}

/** Test-only: drop memory + the hydration latch (does not touch localStorage). */
export function resetSelectorsCache(): void {
  memory.clear()
  hydrated = false
}
