import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

function popoverContent() {
  return document.querySelector("[data-slot=popover-content]")
}

/**
 * Where a popover's content lands in the DOM is not cosmetic inside a modal
 * layer: Radix locks page scrolling with `react-remove-scroll`, which whitelists
 * exactly one subtree — the dialog's content, handed to it as a "shard" — and
 * `preventDefault`s every `wheel` whose target falls outside it. Portalled to
 * the body, a popover's list could only be scrolled by dragging its scrollbar.
 */
describe("overlay portal container", () => {
  it("renders a popover inside the dialog that owns it", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <Popover open>
            <PopoverTrigger>Pick</PopoverTrigger>
            <PopoverContent>Options</PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>
    )

    const dialog = document.querySelector("[data-slot=dialog-content]")
    const popover = popoverContent()
    expect(dialog).toBeTruthy()
    expect(popover).toBeTruthy()
    expect(dialog!.contains(popover!)).toBe(true)

    // And it costs the dialog no layout: the content is `display: grid` with a
    // gap, so a popper wrapper that ever stopped being out of flow would show
    // up as a phantom row every time the popover opened.
    const wrapper = popover!.closest<HTMLElement>(
      "[data-radix-popper-content-wrapper]"
    )
    expect(wrapper?.style.position).toBe("fixed")
  })

  it("renders a popover inside the sheet that owns it", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <Popover open>
            <PopoverTrigger>Pick</PopoverTrigger>
            <PopoverContent>Options</PopoverContent>
          </Popover>
        </SheetContent>
      </Sheet>
    )

    const sheet = document.querySelector("[data-slot=sheet-content]")
    expect(sheet!.contains(popoverContent()!)).toBe(true)
  })

  it("leaves a popover outside any modal layer on the body", () => {
    const { container } = render(
      <Popover open>
        <PopoverTrigger>Pick</PopoverTrigger>
        <PopoverContent>Options</PopoverContent>
      </Popover>
    )

    // Radix's default: appended to the body, not into the tree that rendered
    // the trigger. Nothing here clips or scroll-locks, so it stays that way.
    expect(popoverContent()).toBeTruthy()
    expect(container.contains(popoverContent())).toBe(false)
  })
})
