import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"

const mocks = vi.hoisted(() => ({
  isLocalDesktop: vi.fn(() => true),
  revealItemInDir: vi.fn(async () => {}),
  openPath: vi.fn(async () => {}),
  copyTextFromMenu: vi.fn(async () => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  ancestorContextMenu: vi.fn(),
  ancestorPointerDown: vi.fn(),
  folderPath: "/repo" as string | undefined,
}))

vi.mock("@/lib/platform", () => ({
  isLocalDesktop: mocks.isLocalDesktop,
  revealItemInDir: mocks.revealItemInDir,
  openPath: mocks.openPath,
}))

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({
    activeFolderId: 1,
    activeFolder: mocks.folderPath ? { path: mocks.folderPath } : null,
  }),
}))

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>()
  return { ...actual, copyTextFromMenu: mocks.copyTextFromMenu }
})

import {
  FileReferenceActions,
  resolveFileReferenceTarget,
  systemFileManagerLabelKey,
} from "./file-reference-actions"

function renderActions(target: string) {
  return render(
    // The outer handler stands in for the conversation panel's own context menu
    // (copy text / export / …), which wraps the whole transcript.
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <div
        onContextMenu={mocks.ancestorContextMenu}
        onPointerDown={mocks.ancestorPointerDown}
      >
        <FileReferenceActions target={target}>
          <button type="button" data-testid="badge">
            app.ts
          </button>
        </FileReferenceActions>
      </div>
    </NextIntlClientProvider>
  )
}

/** The context-menu trigger wrapped around the badge. */
function trigger(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-file-actions]")
  if (!element) throw new Error("expected a context-menu trigger on the badge")
  return element
}

/** Right-click the file name. */
function openMenu(): void {
  fireEvent.contextMenu(trigger())
}

function item(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name })
}

describe("resolveFileReferenceTarget", () => {
  it("resolves a file:// uri, dropping the line-range fragment", () => {
    expect(
      resolveFileReferenceTarget("file:///repo/src/app.ts#L10-25", "/repo")
    ).toEqual({ absolute: "/repo/src/app.ts", relative: "src/app.ts" })
  })

  it("resolves the sanitize-safe Windows form back to a drive path", () => {
    expect(
      resolveFileReferenceTarget("/C:/repo/src/app.ts", "C:/repo")
    ).toEqual({ absolute: "C:/repo/src/app.ts", relative: "src/app.ts" })
  })

  it("joins an explicitly-relative path onto the active folder", () => {
    expect(resolveFileReferenceTarget("./src/app.ts", "/repo")).toEqual({
      absolute: "/repo/src/app.ts",
      relative: "src/app.ts",
    })
  })

  it("reports no relative form for a file outside the folder", () => {
    expect(resolveFileReferenceTarget("/elsewhere/a.ts", "/repo")).toEqual({
      absolute: "/elsewhere/a.ts",
      relative: null,
    })
  })

  it("keeps a ~ path in tilde form (home only resolves through the backend)", () => {
    expect(resolveFileReferenceTarget("~/notes/todo.md", "/repo")).toEqual({
      absolute: "~/notes/todo.md",
      relative: null,
    })
  })

  it("returns null for anything that isn't a local file", () => {
    expect(
      resolveFileReferenceTarget("https://example.com", "/repo")
    ).toBeNull()
    expect(resolveFileReferenceTarget("codeg://embedded/x", "/repo")).toBeNull()
    // Relative with no active folder: nothing could be revealed or copied.
    expect(resolveFileReferenceTarget("./src/app.ts", null)).toBeNull()
  })
})

describe("systemFileManagerLabelKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ["MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Finder"],
    ["Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Explorer"],
    ["Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)", "FileManager"],
  ])("maps %s to openIn%s", (platform, userAgent, expected) => {
    vi.stubGlobal("navigator", { platform, userAgent })
    expect(systemFileManagerLabelKey()).toBe(`openIn${expected}`)
  })
})

describe("FileReferenceActions", () => {
  beforeEach(() => {
    mocks.isLocalDesktop.mockReturnValue(true)
    mocks.revealItemInDir.mockResolvedValue(undefined)
    mocks.copyTextFromMenu.mockResolvedValue(true)
    mocks.copyTextFromMenu.mockClear()
    mocks.revealItemInDir.mockClear()
    mocks.toastSuccess.mockClear()
    mocks.toastError.mockClear()
    mocks.ancestorContextMenu.mockClear()
    mocks.ancestorPointerDown.mockClear()
    mocks.folderPath = "/repo"
  })

  it("passes the badge through untouched when the target has no local path", () => {
    const { container } = renderActions("codeg://embedded/abc-123")
    expect(screen.getByTestId("badge")).toBeInTheDocument()
    expect(document.querySelector("[data-file-actions]")).toBeNull()

    // …and its right-click still reaches the conversation panel's own menu.
    fireEvent.contextMenu(screen.getByTestId("badge"))
    expect(mocks.ancestorContextMenu).toHaveBeenCalled()
    expect(container.querySelector("[role='menu']")).toBeNull()
  })

  it("opens on right-click, and only on right-click", () => {
    renderActions("file:///repo/src/app.ts")
    // A left click belongs to the badge (it opens the file in the workspace).
    fireEvent.click(trigger())
    expect(screen.queryByRole("menu")).toBeNull()

    openMenu()
    expect(screen.getByRole("menu")).toBeInTheDocument()
  })

  it("keeps a touch long-press from arming the conversation menu too", () => {
    renderActions("file:///repo/src/app.ts")
    // jsdom's fireEvent.pointerDown drops `pointerType`, so pin it by hand.
    const event = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, "pointerType", { value: "touch" })
    fireEvent(trigger(), event)

    expect(mocks.ancestorPointerDown).not.toHaveBeenCalled()
  })

  it("keeps the right-click from also opening the conversation menu", () => {
    renderActions("file:///repo/src/app.ts")
    openMenu()

    expect(screen.getByRole("menu")).toBeInTheDocument()
    // The transcript is wrapped in the conversation panel's own context menu;
    // both opening at once was the bug this stopPropagation fixes.
    expect(mocks.ancestorContextMenu).not.toHaveBeenCalled()
  })

  it("reveals the absolute path in the file manager", async () => {
    renderActions("file:///repo/src/app.ts#L10-25")
    openMenu()

    // Platform-agnostic match on the reveal row (its label varies with the
    // host OS); "Open with default app" must not match it.
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /^Open in (Finder|Explorer|file manager)/,
      })
    )
    await waitFor(() => {
      expect(mocks.revealItemInDir).toHaveBeenCalledWith("/repo/src/app.ts")
    })
  })

  it("opens the file with the OS default application", async () => {
    renderActions("file:///repo/src/app.ts")
    openMenu()

    fireEvent.click(item("Open with default app"))
    await waitFor(() => {
      expect(mocks.openPath).toHaveBeenCalledWith("/repo/src/app.ts")
    })
    expect(mocks.revealItemInDir).not.toHaveBeenCalled()
  })

  it("copies the relative and the absolute path", async () => {
    renderActions("file:///repo/src/app.ts")
    openMenu()

    fireEvent.click(item("Copy relative path"))
    await waitFor(() => {
      expect(mocks.copyTextFromMenu).toHaveBeenCalledWith("src/app.ts")
    })
    expect(mocks.toastSuccess).toHaveBeenCalled()

    openMenu()
    fireEvent.click(item("Copy absolute path"))
    await waitFor(() => {
      expect(mocks.copyTextFromMenu).toHaveBeenCalledWith("/repo/src/app.ts")
    })
  })

  it("toasts when the copy fails", async () => {
    mocks.copyTextFromMenu.mockResolvedValue(false)
    renderActions("file:///repo/src/app.ts")
    openMenu()

    fireEvent.click(item("Copy absolute path"))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalled()
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it("disables the relative copy for a file outside the active folder", () => {
    renderActions("file:///elsewhere/a.ts")
    openMenu()

    expect(item("Copy relative path")).toHaveAttribute("data-disabled")
    expect(item("Copy absolute path")).not.toHaveAttribute("data-disabled")
  })

  it("hides the reveal row when the file manager is unreachable (web / remote)", () => {
    mocks.isLocalDesktop.mockReturnValue(false)
    renderActions("file:///repo/src/app.ts")
    openMenu()

    expect(
      screen.queryByRole("menuitem", {
        name: /^Open in (Finder|Explorer|file manager)/,
      })
    ).toBeNull()
    expect(
      screen.queryByRole("menuitem", {
        name: "Open with default app",
      })
    ).toBeNull()
    expect(item("Copy absolute path")).toBeInTheDocument()
  })
})
