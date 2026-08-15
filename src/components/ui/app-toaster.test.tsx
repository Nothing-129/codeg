import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { toast } from "sonner"

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}))

import { AppToaster } from "./app-toaster"

/**
 * The toaster must live in the BODY, not where it is mounted. Every dialog
 * portals to the body at z-50, while the workspace shell's root is
 * `fixed inset-0` — a stacking context that would cap sonner's z-index no
 * matter how large it is. A toast raised from an open dialog (the error that
 * explains why a button did nothing) painted underneath it.
 */
describe("AppToaster", () => {
  it("mounts the toaster on the body rather than in the tree that renders it", async () => {
    const { container } = render(
      <div id="shell" className="fixed inset-0">
        <AppToaster position="bottom-right" />
      </div>
    )

    // Sonner's own container is not inside the (stacking-context-forming)
    // shell that rendered it…
    expect(container.querySelector("section[aria-live='polite']")).toBeNull()

    toast.error("project folder is on 'feature'")
    const message = await screen.findByText("project folder is on 'feature'")
    // …and neither is the toast it raises.
    expect(container.contains(message)).toBe(false)
    expect(message.closest("#shell")).toBeNull()
    expect(document.body.contains(message)).toBe(true)
  })
})
