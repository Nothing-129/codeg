import { type ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

// The create-task action pulls workbench-route + tab-store contexts that this
// unit test doesn't mount; stub it to a no-op handler.
vi.mock("./use-create-task-from-message", () => ({
  useCreateTaskFromMessage: () => () => {},
}))

import { resolveTurnDurationMs, TurnStats } from "./turn-stats"
import { MessageScrollProvider } from "./message-scroll-context"
import enMessages from "@/i18n/messages/en.json"

function renderStats(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MessageScrollProvider value={{ scrollToIndex: vi.fn() }}>
        {ui}
      </MessageScrollProvider>
    </NextIntlClientProvider>
  )
}

const jumpLabel = enMessages.Folder.chat.messageList.jumpToPreviousUserMessage

describe("TurnStats jump-to-previous-user gating", () => {
  it("shows the jump button for a duration-only turn (no token usage)", () => {
    // Cursor never reports per-turn token usage; a turn that still carries a
    // duration is a substantial reply and must keep the jump affordance.
    renderStats(
      <TurnStats
        copyText="hello"
        duration_ms={42_000}
        previousUserIndex={3}
        usage={null}
      />
    )
    expect(screen.getByLabelText(jumpLabel)).toBeInTheDocument()
  })

  it("keeps the jump button hidden when neither usage nor duration exists", () => {
    renderStats(
      <TurnStats
        copyText="hello"
        duration_ms={null}
        previousUserIndex={3}
        usage={null}
      />
    )
    expect(screen.queryByLabelText(jumpLabel)).not.toBeInTheDocument()
  })
})

describe("resolveTurnDurationMs", () => {
  it("prefers the reported duration", () => {
    expect(
      resolveTurnDurationMs(
        12_000,
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:00:00Z"
      )
    ).toBe(12_000)
  })

  it("infers from prompt to completion when the agent left duration empty", () => {
    expect(
      resolveTurnDurationMs(
        null,
        "2026-01-01T00:01:30Z",
        "2026-01-01T00:00:00Z"
      )
    ).toBe(90_000)
  })

  it("shows inferred duration in the stats row", () => {
    renderStats(
      <TurnStats
        copyText=""
        duration_ms={null}
        completedAt="2026-01-01T00:00:42Z"
        previousUserAt="2026-01-01T00:00:00Z"
      />
    )
    expect(screen.getByLabelText("Duration: 42s")).toBeInTheDocument()
  })
})
