import { beforeEach, expect, it } from "vitest"
import {
  applySavedConfigPreferences,
  applySavedModePreference,
  saveConfigPreference,
  saveModePreference,
} from "@/lib/selector-prefs-storage"
import type { SessionConfigOptionInfo, SessionModeStateInfo } from "@/lib/types"

let storage = new Map<string, string>()

beforeEach(() => {
  storage = new Map()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } as Partial<Storage>,
  })
})

const modes: SessionModeStateInfo = {
  current_mode_id: "default",
  available_modes: [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
  ],
}

const options: SessionConfigOptionInfo[] = [
  {
    id: "model",
    name: "Model",
    kind: {
      type: "select",
      current_value: "opus",
      options: [
        { value: "opus", name: "Opus" },
        { value: "sonnet", name: "Sonnet" },
      ],
      groups: [],
    },
  },
]

it("overlays a saved mode onto a cached catalog", () => {
  saveModePreference("claude_code", { ...modes, current_mode_id: "plan" })
  expect(applySavedModePreference("claude_code", modes)?.current_mode_id).toBe(
    "plan"
  )
})

it("overlays a saved model onto a cached catalog", () => {
  saveConfigPreference("claude_code", "model", "sonnet")
  const applied = applySavedConfigPreferences("claude_code", options)
  expect(applied?.[0]?.kind).toMatchObject({
    type: "select",
    current_value: "sonnet",
  })
})

it("ignores a saved value that is no longer in the catalog", () => {
  saveConfigPreference("claude_code", "model", "gone")
  expect(applySavedConfigPreferences("claude_code", options)).toBe(options)
})
