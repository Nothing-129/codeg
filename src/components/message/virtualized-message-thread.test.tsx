import type { ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const testState = vi.hoisted(() => ({
  scrollRef: { current: null as HTMLDivElement | null },
}))

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({ scrollRef: testState.scrollRef }),
}))

vi.mock("virtua", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ai-elements/message-thread", () => ({
  MessageThreadContent: ({
    children,
    scrollClassName,
  }: {
    children: ReactNode
    scrollClassName?: string
  }) => (
    <div
      ref={(element) => {
        testState.scrollRef.current = element
      }}
      className={scrollClassName}
      data-testid="viewport"
    >
      {children}
    </div>
  ),
}))

import { VirtualizedMessageThread } from "@/components/message/virtualized-message-thread"

function renderThread(
  content: ReactNode = <div data-testid="content">text</div>
) {
  return render(
    <VirtualizedMessageThread
      items={[{ id: "message-1" }]}
      getItemKey={(item) => item.id}
      renderItem={() => content}
    />
  )
}

function pointerDown(element: HTMLElement, button: number) {
  fireEvent(element, new MouseEvent("pointerdown", { bubbles: true, button }))
}

beforeEach(() => {
  testState.scrollRef.current = null
})

describe("VirtualizedMessageThread viewport focus", () => {
  it("focuses the viewport on a left click of transcript content", () => {
    renderThread()
    const viewport = screen.getByTestId("viewport")

    pointerDown(screen.getByTestId("content"), 0)

    expect(document.activeElement).toBe(viewport)
    expect(viewport.className).not.toContain("focus-visible:ring")
  })

  it("does not steal focus when an interactive control is clicked", () => {
    renderThread(<button data-testid="action">Action</button>)

    pointerDown(screen.getByTestId("action"), 0)

    expect(document.activeElement).not.toBe(screen.getByTestId("viewport"))
  })

  it("does not focus the viewport on a right click", () => {
    renderThread()

    pointerDown(screen.getByTestId("content"), 2)

    expect(document.activeElement).not.toBe(screen.getByTestId("viewport"))
  })
})
