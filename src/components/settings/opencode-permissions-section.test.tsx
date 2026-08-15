import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import { OpenCodePermissionsSection } from "./opencode-permissions-section"

/**
 * The section is controlled, so the harness owns `configText` and exposes the
 * latest value the same way the settings page does — through its draft.
 */
function Harness({
  initial,
  onText,
  disabled,
}: {
  initial: string
  onText: (value: string) => void
  disabled?: boolean
}) {
  const [configText, setConfigText] = useState(initial)
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OpenCodePermissionsSection
        configText={configText}
        disabled={disabled}
        onChange={(next) => {
          setConfigText(next)
          onText(next)
        }}
      />
    </NextIntlClientProvider>
  )
}

function setup(initial = "", disabled = false) {
  const seen: string[] = []
  render(
    <Harness
      initial={initial}
      disabled={disabled}
      onText={(value) => seen.push(value)}
    />
  )
  return {
    latest: () => seen[seen.length - 1] ?? initial,
    permission: () =>
      JSON.parse((seen[seen.length - 1] ?? initial) || "{}").permission,
  }
}

const autoAcceptName = "Auto-accept every permission"
const bashRulesName = "Fine-grained rules for bash"

describe("OpenCodePermissionsSection", () => {
  it("lists every documented permission key", () => {
    setup()
    for (const key of [
      "bash",
      "edit",
      "read",
      "external_directory",
      "task",
      "skill",
      "glob",
      "grep",
      "list",
      "webfetch",
      "websearch",
      "lsp",
      "todowrite",
      "question",
      "doom_loop",
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument()
    }
  })

  it("turning auto-accept on writes an allow-all wildcard", () => {
    const harness = setup()
    const toggle = screen.getByRole("switch", { name: autoAcceptName })
    expect(toggle).toHaveAttribute("data-state", "unchecked")
    fireEvent.click(toggle)
    expect(harness.permission()).toEqual({ "*": "allow" })
    expect(
      screen.getByRole("switch", { name: autoAcceptName })
    ).toHaveAttribute("data-state", "checked")
  })

  it("auto-accept replaces narrowing rules that would still prompt", () => {
    const harness = setup(
      JSON.stringify({
        model: "anthropic/claude",
        permission: { "*": "ask", bash: { "rm *": "deny" } },
      })
    )
    expect(
      screen.getByRole("switch", { name: autoAcceptName })
    ).toHaveAttribute("data-state", "unchecked")
    fireEvent.click(screen.getByRole("switch", { name: autoAcceptName }))
    expect(harness.permission()).toEqual({ "*": "allow" })
    expect(JSON.parse(harness.latest()).model).toBe("anthropic/claude")
  })

  it("turning auto-accept off only drops the global wildcard", () => {
    const harness = setup(
      JSON.stringify({ permission: { "*": "allow", edit: "allow" } })
    )
    fireEvent.click(screen.getByRole("switch", { name: autoAcceptName }))
    expect(harness.permission()).toEqual({ edit: "allow" })
  })

  it("adds, edits and deletes a fine-grained rule", () => {
    const harness = setup()
    fireEvent.click(screen.getByRole("button", { name: bashRulesName }))
    expect(screen.getByText("No fine-grained rules yet.")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("git *"), {
      target: { value: "rm *" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }))
    expect(harness.permission()).toEqual({ bash: { "rm *": "allow" } })

    // The saved rule now owns the first input; the draft row is the second.
    const inputs = screen.getAllByPlaceholderText("git *")
    fireEvent.change(inputs[0], { target: { value: "rm -rf *" } })
    expect(harness.permission()).toEqual({ bash: { "rm -rf *": "allow" } })

    fireEvent.click(
      screen.getByRole("button", { name: "Delete rule rm -rf *" })
    )
    expect(harness.permission()).toBeUndefined()
  })

  it("keeps the row when a pattern is cleared, and reverts on blur", () => {
    const harness = setup(
      JSON.stringify({ permission: { bash: { "git *": "allow" } } })
    )
    fireEvent.click(screen.getByRole("button", { name: bashRulesName }))
    const input = screen.getAllByPlaceholderText("git *")[0]

    fireEvent.change(input, { target: { value: "" } })
    // Still one saved rule; only the in-flight text went blank.
    expect(harness.permission()).toEqual({ bash: { "git *": "allow" } })
    expect(input).toHaveValue("")
    expect(
      screen.getByText(
        "A rule needs a pattern — use the trash icon to remove it."
      )
    ).toBeInTheDocument()

    fireEvent.blur(input)
    expect(screen.getAllByPlaceholderText("git *")[0]).toHaveValue("git *")
  })

  // Keying the row by its pattern used to remount the input on every accepted
  // keystroke, so a multi-character edit was impossible without refocusing.
  it("keeps focus on the pattern input across keystrokes", () => {
    const harness = setup(
      JSON.stringify({ permission: { bash: { g: "allow" } } })
    )
    fireEvent.click(screen.getByRole("button", { name: bashRulesName }))
    const input = screen.getAllByPlaceholderText("git *")[0]
    input.focus()
    expect(document.activeElement).toBe(input)

    for (const value of ["gi", "git", "git ", "git *"]) {
      fireEvent.change(document.activeElement!, { target: { value } })
      expect(document.activeElement).toBe(input)
    }
    expect(harness.permission()).toEqual({ bash: { "git *": "allow" } })
  })

  it("refuses to retype a pattern onto one the key already has", () => {
    const harness = setup(
      JSON.stringify({
        permission: { bash: { "git *": "allow", "rm *": "deny" } },
      })
    )
    fireEvent.click(screen.getByRole("button", { name: bashRulesName }))
    const input = screen.getAllByPlaceholderText("git *")[1]

    fireEvent.change(input, { target: { value: "git *" } })
    expect(harness.permission()).toEqual({
      bash: { "git *": "allow", "rm *": "deny" },
    })
    expect(screen.getByText("That pattern already exists.")).toBeInTheDocument()
  })

  it("refuses to add a pattern the key already has", () => {
    setup(JSON.stringify({ permission: { bash: { "git *": "allow" } } }))
    fireEvent.click(screen.getByRole("button", { name: bashRulesName }))
    const inputs = screen.getAllByPlaceholderText("git *")
    fireEvent.change(inputs[inputs.length - 1], {
      target: { value: "git *" },
    })
    expect(screen.getByRole("button", { name: /Add rule/ })).toBeDisabled()
    expect(screen.getByText("That pattern already exists.")).toBeInTheDocument()
  })

  it("shows a rule count badge for keys that carry patterns", () => {
    setup(
      JSON.stringify({
        permission: { bash: { "*": "ask", "git *": "allow", "rm *": "deny" } },
      })
    )
    expect(screen.getByText("rules: 2")).toBeInTheDocument()
  })

  it("surfaces permission keys that are not built-in tools", () => {
    setup(JSON.stringify({ permission: { "my-mcp_tool": "deny" } }))
    expect(
      screen.getByText("Other permission keys in the file")
    ).toBeInTheDocument()
    expect(screen.getByText("my-mcp_tool")).toBeInTheDocument()
  })

  it("pauses editing when the surrounding JSON cannot be parsed", () => {
    setup("{ not json")
    expect(
      screen.getByText(
        "The native JSON below is not valid, so the visual editor is paused. Fix the JSON to resume."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: autoAcceptName })).toBeDisabled()
  })

  it("warns instead of guessing when the block has an unknown shape", () => {
    setup(JSON.stringify({ permission: { bash: 1 } }))
    expect(
      screen.getByText(
        "The permission block has a shape codeg does not recognize. Edit it in the native JSON below, or use Reset to start over."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: autoAcceptName })).toBeDisabled()
    // Reset stays live — it is the only repair the visual editor can offer.
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled()
  })

  it("warns that a trailing wildcard overrides the rows, and can fix it", () => {
    const harness = setup(
      JSON.stringify({ permission: { bash: "deny", "*": "allow" } })
    )
    expect(
      screen.getByText(/A wildcard rule is written after specific tools/)
    ).toBeInTheDocument()
    // It must not read as auto-accept while the rows claim bash is denied.
    expect(
      screen.getByRole("switch", { name: autoAcceptName })
    ).toHaveAttribute("data-state", "unchecked")

    fireEvent.click(screen.getByRole("button", { name: "Fix order" }))
    expect(Object.keys(harness.permission() as object)).toEqual(["*", "bash"])
    expect(
      screen.queryByText(/A wildcard rule is written after specific tools/)
    ).not.toBeInTheDocument()
  })

  it("offers no Fix order button for shadowing reordering cannot fix", () => {
    setup(
      JSON.stringify({ permission: { mymcp_run: "deny", "mymcp_*": "ask" } })
    )
    expect(
      screen.getByText(/shadowed by a later, more general pattern/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Fix order" })
    ).not.toBeInTheDocument()
  })

  it("warns about a legacy tools map that denies a tool", () => {
    setup(JSON.stringify({ permission: "allow", tools: { bash: false } }))
    expect(screen.getByText(/legacy top-level tools map/)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: autoAcceptName })
    ).toHaveAttribute("data-state", "unchecked")
  })

  it("warns about agent blocks that outrank everything shown", () => {
    setup(
      JSON.stringify({
        permission: { "*": "allow" },
        agent: { build: { permission: { bash: "ask" } } },
      })
    )
    expect(screen.getByText(/These agents override permissions/)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: autoAcceptName })
    ).toHaveAttribute("data-state", "unchecked")
  })

  it("auto-accept clears agent overrides so the switch tells the truth", () => {
    const harness = setup(
      JSON.stringify({
        agent: {
          build: { model: "x/y", permission: { bash: "ask" } },
          review: { permission: "deny" },
        },
      })
    )
    fireEvent.click(screen.getByRole("switch", { name: autoAcceptName }))
    expect(JSON.parse(harness.latest()).agent).toEqual({
      build: { model: "x/y" },
      // Kept: the entry is what registers the custom agent at all.
      review: {},
    })
    expect(
      screen.getByRole("switch", { name: autoAcceptName })
    ).toHaveAttribute("data-state", "checked")
    expect(
      screen.queryByText(/These agents override permissions/)
    ).not.toBeInTheDocument()
  })

  it("reset clears the block but keeps the rest of the config", () => {
    const harness = setup(
      JSON.stringify({ model: "x/y", permission: { "*": "deny" } })
    )
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(JSON.parse(harness.latest())).toEqual({ model: "x/y" })
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled()
  })

  it("locks every control while a save is in flight", () => {
    setup(JSON.stringify({ permission: { "*": "ask" } }), true)
    expect(screen.getByRole("switch", { name: autoAcceptName })).toBeDisabled()
    expect(screen.getByRole("button", { name: bashRulesName })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled()
  })
})
