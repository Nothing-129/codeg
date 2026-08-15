import { describe, expect, it } from "vitest"
import {
  OPENCODE_PERMISSION_KEYS,
  applyOpenCodeAutoAccept,
  clearOpenCodePermissions,
  effectiveOpenCodeDefault,
  isOpenCodeConfigEditable,
  normalizeOpenCodePermissionOrder,
  readOpenCodePermissions,
  setOpenCodeGlobalPermission,
  setOpenCodeKeyPermission,
  setOpenCodeKeyRules,
} from "./opencode-permissions"

function permissionOf(configText: string): unknown {
  return JSON.parse(configText || "{}").permission
}

function entry(configText: string, key: string) {
  const view = readOpenCodePermissions(configText)
  return view.entries.find((item) => item.key === key)
}

describe("readOpenCodePermissions", () => {
  it("reports an unset block with every known key blank", () => {
    const view = readOpenCodePermissions("")
    expect(view.shape).toBe("unset")
    expect(view.globalAction).toBeNull()
    expect(view.autoAcceptAll).toBe(false)
    expect(view.invalid).toBe(false)
    expect(view.entries).toHaveLength(OPENCODE_PERMISSION_KEYS.length)
    expect(view.entries.every((item) => item.action === null)).toBe(true)
  })

  it("reads the bare-action form as a global default", () => {
    const view = readOpenCodePermissions('{"permission":"allow"}')
    expect(view.shape).toBe("action")
    expect(view.globalAction).toBe("allow")
    expect(view.autoAcceptAll).toBe(true)
  })

  it("bare 'ask' is not auto-accept", () => {
    expect(readOpenCodePermissions('{"permission":"ask"}').autoAcceptAll).toBe(
      false
    )
  })

  it("reads per-key actions and the object wildcard", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"*":"ask","bash":"allow","edit":"deny"}}'
    )
    expect(view.shape).toBe("object")
    expect(view.globalAction).toBe("ask")
    expect(entry(JSON.stringify({ permission: {} }), "bash")?.action).toBeNull()
    expect(view.entries.find((e) => e.key === "bash")?.action).toBe("allow")
    expect(view.entries.find((e) => e.key === "edit")?.action).toBe("deny")
  })

  it("splits a key's wildcard from its ordered pattern rules", () => {
    const bash = entry(
      JSON.stringify({
        permission: {
          bash: { "*": "ask", "git *": "allow", "rm *": "deny" },
        },
      }),
      "bash"
    )
    expect(bash?.action).toBe("ask")
    expect(bash?.rules).toEqual([
      { pattern: "git *", action: "allow" },
      { pattern: "rm *", action: "deny" },
    ])
  })

  it("surfaces unknown keys as custom entries after the known ones", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"my-mcp_tool":"deny"}}'
    )
    const custom = view.entries.filter((item) => item.custom)
    expect(custom).toHaveLength(1)
    expect(custom[0]).toMatchObject({ key: "my-mcp_tool", action: "deny" })
    expect(view.entries.indexOf(custom[0])).toBe(
      OPENCODE_PERMISSION_KEYS.length
    )
  })

  it("flags a malformed block instead of guessing", () => {
    expect(readOpenCodePermissions('{"permission":["allow"]}').invalid).toBe(
      true
    )
    expect(readOpenCodePermissions('{"permission":{"bash":1}}').invalid).toBe(
      true
    )
    expect(
      readOpenCodePermissions('{"permission":{"bash":{"git *":"yes"}}}').invalid
    ).toBe(true)
  })

  it("treats invalid JSON as unset rather than throwing", () => {
    const view = readOpenCodePermissions("{not json")
    expect(view.shape).toBe("unset")
    expect(view.invalid).toBe(false)
  })

  it("only calls it auto-accept when nothing can still prompt", () => {
    expect(
      readOpenCodePermissions('{"permission":{"*":"allow"}}').autoAcceptAll
    ).toBe(true)
    expect(
      readOpenCodePermissions('{"permission":{"*":"allow","bash":"ask"}}')
        .autoAcceptAll
    ).toBe(false)
    expect(
      readOpenCodePermissions(
        '{"permission":{"*":"allow","bash":{"rm *":"deny"}}}'
      ).autoAcceptAll
    ).toBe(false)
    expect(
      readOpenCodePermissions('{"permission":{"*":"allow","bash":"allow"}}')
        .autoAcceptAll
    ).toBe(true)
  })
})

describe("setOpenCodeGlobalPermission", () => {
  it("creates the block on an empty config", () => {
    const next = setOpenCodeGlobalPermission("", "allow")
    expect(permissionOf(next)).toEqual({ "*": "allow" })
  })

  it("keeps unrelated keys intact", () => {
    const next = setOpenCodeGlobalPermission(
      '{"model":"anthropic/claude","permission":{"bash":"ask"}}',
      "deny"
    )
    const parsed = JSON.parse(next)
    expect(parsed.model).toBe("anthropic/claude")
    expect(parsed.permission).toEqual({ "*": "deny", bash: "ask" })
  })

  // OpenCode flattens the block and resolves with findLast, matching the tool
  // name through the same wildcard matcher — so a "*" written after "bash"
  // overrides it. Appending would turn `bash: deny` into an allow.
  it("writes the wildcard ahead of the keys it must not override", () => {
    const next = setOpenCodeGlobalPermission(
      '{"permission":{"bash":"deny","edit":"ask"}}',
      "allow"
    )
    expect(Object.keys(JSON.parse(next).permission)).toEqual([
      "*",
      "bash",
      "edit",
    ])
  })

  it("repairs a document whose wildcard was already written last", () => {
    const next = setOpenCodeGlobalPermission(
      '{"permission":{"bash":"deny","*":"allow"}}',
      "ask"
    )
    expect(Object.keys(JSON.parse(next).permission)).toEqual(["*", "bash"])
    expect(JSON.parse(next).permission["*"]).toBe("ask")
  })

  it("widens the bare-action form instead of dropping it", () => {
    const next = setOpenCodeGlobalPermission('{"permission":"ask"}', "allow")
    expect(permissionOf(next)).toEqual({ "*": "allow" })
  })

  it("clearing the only entry removes the whole block", () => {
    const next = setOpenCodeGlobalPermission('{"permission":{"*":"ask"}}', null)
    expect(permissionOf(next)).toBeUndefined()
  })

  it("collapses a document that held nothing else to an empty string", () => {
    expect(setOpenCodeGlobalPermission('{"permission":"allow"}', null)).toBe("")
  })

  it("returns invalid JSON untouched", () => {
    expect(setOpenCodeGlobalPermission("{oops", "allow")).toBe("{oops")
  })
})

describe("setOpenCodeKeyPermission", () => {
  it("writes a bare action for a key with no rules", () => {
    const next = setOpenCodeKeyPermission("", "edit", "deny")
    expect(permissionOf(next)).toEqual({ edit: "deny" })
  })

  it("preserves the bare global default when adding a key", () => {
    const next = setOpenCodeKeyPermission(
      '{"permission":"ask"}',
      "bash",
      "allow"
    )
    expect(permissionOf(next)).toEqual({ "*": "ask", bash: "allow" })
    // The key must land AFTER the wildcard or it would never take effect.
    expect(Object.keys(JSON.parse(next).permission)).toEqual(["*", "bash"])
  })

  it("writes into the key's wildcard when it has rules", () => {
    const next = setOpenCodeKeyPermission(
      '{"permission":{"bash":{"git *":"allow"}}}',
      "bash",
      "ask"
    )
    expect(permissionOf(next)).toEqual({
      bash: { "*": "ask", "git *": "allow" },
    })
  })

  it("clearing a key that still has rules keeps the rules", () => {
    const next = setOpenCodeKeyPermission(
      '{"permission":{"bash":{"*":"ask","git *":"allow"}}}',
      "bash",
      null
    )
    expect(permissionOf(next)).toEqual({ bash: { "git *": "allow" } })
  })

  it("clearing a rule-less key removes it", () => {
    const next = setOpenCodeKeyPermission(
      '{"permission":{"bash":"ask","edit":"deny"}}',
      "bash",
      null
    )
    expect(permissionOf(next)).toEqual({ edit: "deny" })
  })

  it("refuses to write the wildcard through the per-key path", () => {
    const config = '{"permission":{"*":"ask"}}'
    expect(setOpenCodeKeyPermission(config, "*", "allow")).toBe(config)
  })
})

describe("setOpenCodeKeyRules", () => {
  it("emits the wildcard first and the rules in caller order", () => {
    const next = setOpenCodeKeyRules('{"permission":{"bash":"ask"}}', "bash", [
      { pattern: "git *", action: "allow" },
      { pattern: "git push *", action: "deny" },
    ])
    expect(Object.keys(JSON.parse(next).permission.bash)).toEqual([
      "*",
      "git *",
      "git push *",
    ])
  })

  it("skips blank and wildcard patterns", () => {
    const next = setOpenCodeKeyRules("", "bash", [
      { pattern: "  ", action: "allow" },
      { pattern: "*", action: "deny" },
      { pattern: " npm * ", action: "allow" },
    ])
    expect(permissionOf(next)).toEqual({ bash: { "npm *": "allow" } })
  })

  it("a duplicate pattern keeps the last one, at the last position", () => {
    const next = setOpenCodeKeyRules("", "bash", [
      { pattern: "git *", action: "allow" },
      { pattern: "rm *", action: "deny" },
      { pattern: "git *", action: "ask" },
    ])
    expect(Object.keys(JSON.parse(next).permission.bash)).toEqual([
      "rm *",
      "git *",
    ])
    expect(JSON.parse(next).permission.bash["git *"]).toBe("ask")
  })

  it("dropping every rule collapses back to the bare action", () => {
    const next = setOpenCodeKeyRules(
      '{"permission":{"bash":{"*":"ask","git *":"allow"}}}',
      "bash",
      []
    )
    expect(permissionOf(next)).toEqual({ bash: "ask" })
  })

  it("dropping every rule with no base action removes the key", () => {
    const next = setOpenCodeKeyRules(
      '{"permission":{"bash":{"git *":"allow"}}}',
      "bash",
      []
    )
    expect(permissionOf(next)).toBeUndefined()
  })

  it("round-trips through the reader", () => {
    const next = setOpenCodeKeyRules(
      '{"permission":{"*":"ask"}}',
      "external_directory",
      [{ pattern: "~/projects/**", action: "allow" }]
    )
    const view = readOpenCodePermissions(next)
    expect(view.globalAction).toBe("ask")
    expect(
      view.entries.find((item) => item.key === "external_directory")?.rules
    ).toEqual([{ pattern: "~/projects/**", action: "allow" }])
  })
})

describe("applyOpenCodeAutoAccept", () => {
  it("replaces every narrowing rule with a single allow-all", () => {
    const next = applyOpenCodeAutoAccept(
      '{"model":"x/y","permission":{"*":"ask","bash":{"rm *":"deny"}}}'
    )
    const parsed = JSON.parse(next)
    expect(parsed.permission).toEqual({ "*": "allow" })
    expect(parsed.model).toBe("x/y")
    expect(readOpenCodePermissions(next).autoAcceptAll).toBe(true)
  })

  it("works from an empty config", () => {
    expect(permissionOf(applyOpenCodeAutoAccept(""))).toEqual({ "*": "allow" })
  })

  // Agent rules are appended after the global ones, so they win the findLast.
  it("clears agent permission overrides but keeps the rest of the agent", () => {
    const next = applyOpenCodeAutoAccept(
      JSON.stringify({
        agent: { build: { model: "x/y", permission: { bash: "ask" } } },
      })
    )
    expect(JSON.parse(next).agent).toEqual({ build: { model: "x/y" } })
    expect(readOpenCodePermissions(next).autoAcceptAll).toBe(true)
  })

  // OpenCode registers a custom agent from the presence of `agent.<name>`;
  // dropping an emptied entry would delete the agent, not just its rules.
  it("keeps an agent that held nothing but permissions", () => {
    const next = applyOpenCodeAutoAccept(
      JSON.stringify({ agent: { review: { permission: "deny" } } })
    )
    expect(JSON.parse(next).agent).toEqual({ review: {} })
    expect(readOpenCodePermissions(next).autoAcceptAll).toBe(true)
  })

  // config loading folds `mode.<name>` into `agent.<name>`, and
  // `agent.<name>.tools` into that agent's permissions.
  it("clears the deprecated mode blocks and tools maps too", () => {
    const next = applyOpenCodeAutoAccept(
      JSON.stringify({
        tools: { bash: false },
        agent: { build: { model: "x/y", tools: { bash: false } } },
        mode: { plan: { permission: { edit: "deny" } } },
      })
    )
    const parsed = JSON.parse(next)
    expect(parsed.tools).toBeUndefined()
    expect(parsed.agent).toEqual({ build: { model: "x/y" } })
    expect(parsed.mode).toEqual({ plan: {} })
    expect(readOpenCodePermissions(next).autoAcceptAll).toBe(true)
  })

  it("leaves agents that never set permissions alone", () => {
    const next = applyOpenCodeAutoAccept(
      JSON.stringify({ agent: { build: { model: "x/y" } } })
    )
    expect(JSON.parse(next).agent).toEqual({ build: { model: "x/y" } })
  })
})

describe("agent overrides", () => {
  it("are reported, and only when they can still prompt or block", () => {
    const narrowing = readOpenCodePermissions(
      JSON.stringify({
        permission: { "*": "allow" },
        agent: {
          build: { permission: { bash: "ask" } },
          plan: { permission: "deny" },
          loose: { permission: { bash: "allow" } },
          nested: { permission: { bash: { "rm *": "deny" } } },
        },
      })
    )
    expect(narrowing.agentOverrides).toEqual(["build", "plan", "nested"])
    expect(narrowing.autoAcceptAll).toBe(false)
  })

  it("do not exist for a config without agents", () => {
    expect(readOpenCodePermissions('{"permission":"allow"}')).toMatchObject({
      agentOverrides: [],
      autoAcceptAll: true,
    })
  })

  // `mode.<name>` is folded into `agent.<name>`, and `tools: {x: false}` into
  // that agent's permissions, before anything is resolved.
  it("cover the deprecated mode blocks and tools maps", () => {
    const view = readOpenCodePermissions(
      JSON.stringify({
        permission: "allow",
        agent: { build: { tools: { bash: false } } },
        mode: { plan: { permission: { edit: "deny" } } },
      })
    )
    expect(view.agentOverrides).toEqual(["build", "plan"])
    expect(view.autoAcceptAll).toBe(false)
  })

  it("ignore a tools map that only enables things", () => {
    const view = readOpenCodePermissions(
      JSON.stringify({
        permission: "allow",
        agent: { build: { tools: { bash: true } } },
      })
    )
    expect(view.agentOverrides).toEqual([])
    expect(view.autoAcceptAll).toBe(true)
  })
})

describe("legacy top-level tools", () => {
  it("is reported and blocks auto-accept", () => {
    const view = readOpenCodePermissions(
      JSON.stringify({ permission: "allow", tools: { bash: false } })
    )
    expect(view.legacyToolsDeny).toBe(true)
    expect(view.autoAcceptAll).toBe(false)
  })

  it("is quiet when it only enables things", () => {
    const view = readOpenCodePermissions(
      JSON.stringify({ permission: "allow", tools: { bash: true } })
    )
    expect(view.legacyToolsDeny).toBe(false)
    expect(view.autoAcceptAll).toBe(true)
  })

  it("keep a bare allow-all honest", () => {
    const view = readOpenCodePermissions(
      JSON.stringify({
        permission: "allow",
        agent: { build: { permission: { bash: "deny" } } },
      })
    )
    expect(view.autoAcceptAll).toBe(false)
  })
})

describe("wildcard ordering", () => {
  it("is flagged when a top-level wildcard follows a specific key", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"bash":"deny","*":"allow"}}'
    )
    expect(view.orderingUnsafe).toBe(true)
    // The rows say bash: deny, but the trailing "*" actually allows it.
    expect(view.autoAcceptAll).toBe(false)
  })

  it("is flagged when a key's own wildcard follows its patterns", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"bash":{"git *":"allow","*":"deny"}}}'
    )
    expect(view.orderingUnsafe).toBe(true)
  })

  it("is clean for the order codeg writes", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"*":"ask","bash":{"*":"ask","git *":"allow"}}}'
    )
    expect(view.orderingUnsafe).toBe(false)
  })

  // The tool name goes through the same wildcard matcher as the pattern, so a
  // glob key shadows any earlier key it matches — not just a bare "*".
  it("catches a glob key that shadows an earlier specific one", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"mymcp_run":"deny","mymcp_*":"allow"}}'
    )
    expect(view.orderingUnsafe).toBe(true)
    // Moving "*" to the front cannot help here; there is no such key.
    expect(view.orderingFixable).toBe(false)
  })

  // Containment, not text matching: "git ?" and "git *" each match the other's
  // literal text, but only "git *" covers the other's language.
  it("does not flag a narrower glob written after a broader one", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"bash":{"git *":"ask","git ?":"allow"}}}'
    )
    expect(view.orderingUnsafe).toBe(false)
  })

  it("flags the same two globs in the order that really shadows", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"bash":{"git ?":"ask","git *":"allow"}}}'
    )
    expect(view.orderingUnsafe).toBe(true)
  })

  // The trailing " *" rule cuts both ways: " *" matches the empty string,
  // which "?*" does not, so "?*" does not cover it and nothing is shadowed.
  it("does not flag when the earlier pattern matches its own bare prefix", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"bash":{" *":"deny","?*":"allow"}}}'
    )
    expect(view.orderingUnsafe).toBe(false)
  })

  // `Wildcard.match` lets a trailing " *" match the bare prefix too.
  it("knows a trailing wildcard pattern also covers its bare prefix", () => {
    expect(
      readOpenCodePermissions(
        '{"permission":{"bash":{"git":"deny","git *":"allow"}}}'
      ).orderingUnsafe
    ).toBe(true)
    expect(
      readOpenCodePermissions(
        '{"permission":{"bash":{"gitx":"deny","git *":"allow"}}}'
      ).orderingUnsafe
    ).toBe(false)
  })

  // Two wildcards trading responsibility for the same characters: "*?" is
  // every non-empty string, so it swallows "a*" whole. No left-to-right token
  // pairing sees this, which is why containment is decided as a language.
  it("flags shadowing that only shows up as language containment", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"bash":{"a*":"deny","*?":"allow"}}}'
    )
    expect(view.orderingUnsafe).toBe(true)
  })

  // Long enough to have tripped an earlier size guard, which quietly switched
  // the whole check off for exactly the patterns the docs use as examples.
  it("still decides shadowing for realistically long patterns", () => {
    expect(
      readOpenCodePermissions(
        JSON.stringify({
          permission: {
            edit: {
              "packages/web/src/content/docs/index.mdx": "deny",
              "packages/web/src/content/docs/*.mdx": "allow",
            },
          },
        })
      ).orderingUnsafe
    ).toBe(true)
    expect(
      readOpenCodePermissions(
        JSON.stringify({
          permission: {
            bash: { "docker compose up": "deny", "docker compose *": "allow" },
          },
        })
      ).orderingUnsafe
    ).toBe(true)
    // Reverse order is the intended arrangement and stays quiet.
    expect(
      readOpenCodePermissions(
        JSON.stringify({
          permission: {
            edit: {
              "packages/web/src/content/docs/*.mdx": "allow",
              "packages/web/src/content/docs/index.mdx": "deny",
            },
          },
        })
      ).orderingUnsafe
    ).toBe(false)
  })

  // `*` and `**` are the same language here, and a fixed-length `?` run after
  // a `*` is the shape whose subset construction blows up — content-hashed
  // build output is the realistic way to write one.
  it("decides shadowing between hashed build-output patterns", () => {
    const shadowed = (rules: Record<string, string>) =>
      readOpenCodePermissions(JSON.stringify({ permission: { edit: rules } }))
        .orderingUnsafe
    expect(
      shadowed({
        "dist/*/????????.js": "deny",
        "dist/**/????????.js": "allow",
      })
    ).toBe(true)
    expect(
      shadowed({
        "logs/*/????-??-??/???????????.log": "deny",
        "logs/**/????-??-??/???????????.log": "allow",
      })
    ).toBe(true)
    // Different suffix, so nothing is shadowed.
    expect(
      shadowed({
        "dist/*/????????.js": "deny",
        "dist/**/????????.map": "allow",
      })
    ).toBe(false)
  })

  // The matcher folds backslashes to slashes, so two keys JSON kept apart can
  // be the same pattern — and the later one then wins outright.
  it("flags two literal keys that differ only by path separator", () => {
    const view = readOpenCodePermissions(
      JSON.stringify({
        permission: {
          edit: { "src/file.ts": "deny", "src\\file.ts": "allow" },
        },
      })
    )
    expect(view.orderingUnsafe).toBe(true)
  })

  it("flags an equivalent glob that fully replaces the one before it", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"edit":{"src/*":"deny","src/**":"allow"}}}'
    )
    expect(view.orderingUnsafe).toBe(true)
  })

  it("does not flag a specific key written after a glob", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"mymcp_*":"allow","mymcp_run":"deny"}}'
    )
    expect(view.orderingUnsafe).toBe(false)
  })

  it("does not flag the pattern ordering the docs recommend", () => {
    const view = readOpenCodePermissions(
      JSON.stringify({
        permission: {
          bash: {
            "*": "ask",
            "git *": "allow",
            "npm *": "allow",
            "rm *": "deny",
            "grep *": "allow",
          },
          edit: { "*": "deny", "packages/web/**/*.mdx": "allow" },
        },
      })
    )
    expect(view.orderingUnsafe).toBe(false)
  })

  it("marks a trailing wildcard as fixable by reordering", () => {
    const view = readOpenCodePermissions(
      '{"permission":{"bash":"deny","*":"allow"}}'
    )
    expect(view.orderingFixable).toBe(true)
  })

  it("normalizes every scope without touching a value", () => {
    const next = normalizeOpenCodePermissionOrder(
      JSON.stringify({
        model: "x/y",
        permission: {
          bash: { "git *": "allow", "*": "deny" },
          "*": "allow",
          edit: "ask",
        },
      })
    )
    const parsed = JSON.parse(next)
    expect(Object.keys(parsed.permission)).toEqual(["*", "bash", "edit"])
    expect(Object.keys(parsed.permission.bash)).toEqual(["*", "git *"])
    expect(parsed.permission.bash).toEqual({ "*": "deny", "git *": "allow" })
    expect(parsed.permission.edit).toBe("ask")
    expect(parsed.model).toBe("x/y")
    expect(readOpenCodePermissions(next).orderingUnsafe).toBe(false)
  })

  it("is a no-op on a config with no permission block", () => {
    expect(normalizeOpenCodePermissionOrder('{"model":"x/y"}')).toBe(
      '{\n  "model": "x/y"\n}'
    )
  })
})

describe("clearOpenCodePermissions", () => {
  it("removes the block but keeps the rest", () => {
    const next = clearOpenCodePermissions(
      '{"model":"x/y","permission":{"*":"deny"}}'
    )
    expect(JSON.parse(next)).toEqual({ model: "x/y" })
  })

  it("is a no-op when there is no block", () => {
    expect(clearOpenCodePermissions('{"model":"x/y"}')).toBe('{"model":"x/y"}')
  })
})

describe("isOpenCodeConfigEditable", () => {
  it("accepts an empty or object document", () => {
    expect(isOpenCodeConfigEditable("")).toBe(true)
    expect(isOpenCodeConfigEditable('{"permission":"allow"}')).toBe(true)
  })

  it("rejects broken JSON and non-objects", () => {
    expect(isOpenCodeConfigEditable("{oops")).toBe(false)
    expect(isOpenCodeConfigEditable("[1,2]")).toBe(false)
  })
})

describe("effectiveOpenCodeDefault", () => {
  it("falls back to OpenCode's own per-key defaults", () => {
    expect(effectiveOpenCodeDefault("bash", null)).toBe("allow")
    expect(effectiveOpenCodeDefault("doom_loop", null)).toBe("ask")
    expect(effectiveOpenCodeDefault("external_directory", null)).toBe("ask")
  })

  it("a configured global default wins", () => {
    expect(effectiveOpenCodeDefault("doom_loop", "allow")).toBe("allow")
  })

  it("treats an unknown key as allow", () => {
    expect(effectiveOpenCodeDefault("some-mcp-tool", null)).toBe("allow")
  })
})
