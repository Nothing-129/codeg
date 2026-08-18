import { beforeEach, expect, it } from "vitest"
import {
  ensureCachedSelectors,
  getCachedSelectors,
  resetSelectorsCache,
  updateCachedSelectors,
} from "@/lib/selectors-cache-storage"
import type { SessionConfigOptionInfo, SessionModeStateInfo } from "@/lib/types"

const STORAGE_KEY = "codeg:selectors-cache:v1"
let storage = new Map<string, string>()

const modes: SessionModeStateInfo = {
  current_mode_id: "default",
  available_modes: [{ id: "default", name: "Default" }],
}

const configOptions: SessionConfigOptionInfo[] = [
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

beforeEach(() => {
  storage = new Map()
  resetSelectorsCache()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } as Partial<Storage>,
  })
})

it("hydrates a previously persisted catalog so a new conversation can paint immediately", () => {
  storage.set(
    STORAGE_KEY,
    JSON.stringify({
      claude_code: { modes, configOptions },
    })
  )

  expect(getCachedSelectors("claude_code")).toEqual({ modes, configOptions })
})

it("merges patch writes and survives a cold read", () => {
  updateCachedSelectors("codex", { modes })
  updateCachedSelectors("codex", { configOptions })

  expect(getCachedSelectors("codex")).toEqual({ modes, configOptions })

  resetSelectorsCache()
  expect(getCachedSelectors("codex")).toEqual({ modes, configOptions })
})

it("does not overwrite an existing entry with the empty seed", () => {
  updateCachedSelectors("claude_code", { modes, configOptions })
  ensureCachedSelectors("claude_code", { modes: null, configOptions: null })
  expect(getCachedSelectors("claude_code")).toEqual({ modes, configOptions })
})

it("rejects a corrupt catalog instead of poisoning the picker", () => {
  storage.set(STORAGE_KEY, JSON.stringify({ claude_code: { modes: "nope" } }))
  expect(getCachedSelectors("claude_code")).toBeNull()
})
