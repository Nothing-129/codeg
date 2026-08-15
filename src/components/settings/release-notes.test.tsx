import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider, type Locale } from "next-intl"
import { describe, expect, it, vi } from "vitest"

// The markdown pipeline is ESM-only and its rendering isn't what's under test
// here — what matters is WHICH half of the body reaches it.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: string }) => (
    <div data-testid="markdown">{children ?? null}</div>
  ),
}))
vi.mock("remark-gfm", () => ({ default: () => undefined }))

import { ReleaseNotes } from "./release-notes"

const ENGLISH = "# Release version 0.24.0\n\nNotification sounds."
const CHINESE = "# 发布版本 0.24.0\n\n通知声音。"
const BILINGUAL = `${ENGLISH}\n\n-----------------------------\n\n${CHINESE}`

function renderNotes(locale: Locale, notes = BILINGUAL) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <ReleaseNotes notes={notes} emptyLabel="No notes" />
    </NextIntlClientProvider>
  )
}

describe("ReleaseNotes", () => {
  it("renders the Chinese half for a Chinese interface", () => {
    for (const locale of ["zh-CN", "zh-TW"] as const) {
      const { unmount } = renderNotes(locale)
      expect(screen.getByTestId("markdown").textContent).toBe(CHINESE)
      unmount()
    }
  })

  it("renders the English half everywhere else", () => {
    for (const locale of ["en", "ja", "de"] as const) {
      const { unmount } = renderNotes(locale)
      expect(screen.getByTestId("markdown").textContent).toBe(ENGLISH)
      unmount()
    }
  })

  it("renders a body that isn't bilingual whole", () => {
    const body = "# Release version 0.24.0\n\nEnglish only."
    renderNotes("zh-CN", body)
    expect(screen.getByTestId("markdown").textContent).toBe(body)
  })

  it("falls back to the empty label when a release carries no notes", () => {
    renderNotes("en", "   ")
    expect(screen.queryByTestId("markdown")).toBeNull()
    expect(screen.getByText("No notes")).toBeTruthy()
  })
})
