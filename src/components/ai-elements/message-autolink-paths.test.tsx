import { fireEvent, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// End-to-end guard for plain-text local paths in assistant markdown (the
// build-artifact table an agent writes at the end of a reply). Exercises the
// REAL Streamdown pipeline — parse → remarkAutolinkLocalPaths → sanitize →
// harden — so the assertions prove the minted `codeg://file/…` and
// `/C:/…` hrefs survive to MarkdownLink as file badges, and that clicks
// route into the workspace file opener exactly like an agent-written file
// link would.
const mocks = vi.hoisted(() => ({
  openFilePreview: vi.fn(),
  openUrl: vi.fn(),
  openPath: vi.fn(),
  isLocalDesktop: vi.fn(() => false),
  toastError: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}))

vi.mock("@/lib/platform", () => ({
  openUrl: mocks.openUrl,
  openPath: mocks.openPath,
  isLocalDesktop: mocks.isLocalDesktop,
}))

vi.mock("@/lib/transport", () => ({
  isDesktop: vi.fn(() => false),
  getActiveRemoteConnectionId: vi.fn(() => null),
}))

vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: { path: "/repo" } }),
}))

vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceActions: () => ({ openFilePreview: mocks.openFilePreview }),
}))

import { MessageResponse } from "./message"

function fileBadges(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      "button[data-resource-kind='file']"
    )
  )
}

// The artifact table from a real agent reply — paths as plain table text.
const ARTIFACT_TABLE = [
  "| 类型 | 路径 | 大小 |",
  "| --- | --- | --- |",
  "| DMG 安装包 | src-tauri/target/release/bundle/dmg/Codeg_0.26.1_aarch64.dmg | 79MB |",
  "| 可直接打开的 App | src-tauri/target/release/bundle/macos/Codeg.app | — |",
].join("\n")

describe("MessageResponse — plain-text local paths autolink to file badges", () => {
  beforeEach(() => {
    mocks.openFilePreview.mockReset()
    mocks.openFilePreview.mockResolvedValue(undefined)
    mocks.openUrl.mockReset()
    mocks.openUrl.mockResolvedValue(undefined)
    mocks.openPath.mockReset()
    mocks.openPath.mockResolvedValue(undefined)
    mocks.isLocalDesktop.mockReset()
    mocks.isLocalDesktop.mockReturnValue(false)
    mocks.toastError.mockReset()
    vi.spyOn(window, "open").mockReturnValue(null)
  })

  it("renders the artifact-table paths as file badges, not plain text", async () => {
    const { container } = render(
      <MessageResponse>{ARTIFACT_TABLE}</MessageResponse>
    )

    await waitFor(() => {
      expect(fileBadges(container)).toHaveLength(2)
    })
    expect(container.textContent).toContain(
      "src-tauri/target/release/bundle/dmg/Codeg_0.26.1_aarch64.dmg"
    )
    expect(container.textContent).not.toContain("[blocked]")
    // The badge carries the right-click reveal/copy menu wrapper.
    expect(container.querySelectorAll("[data-file-actions]")).toHaveLength(2)
  })

  it("opens the artifact on click via the workspace file opener", async () => {
    const { container } = render(
      <MessageResponse>{ARTIFACT_TABLE}</MessageResponse>
    )

    await waitFor(() => {
      expect(fileBadges(container)).toHaveLength(2)
    })
    fireEvent.click(fileBadges(container)[0])
    await waitFor(() => {
      expect(mocks.openFilePreview).toHaveBeenCalledWith(
        "src-tauri/target/release/bundle/dmg/Codeg_0.26.1_aarch64.dmg",
        { line: undefined }
      )
    })
    expect(window.open).not.toHaveBeenCalled()
  })

  it("opens a binary artifact with the OS default application on desktop", async () => {
    // Web mode has no opener, so the artifact falls back to the preview
    // above; a LOCAL desktop routes .dmg/.app straight to the system —
    // mounting the dmg / launching the app, which a text preview never could.
    mocks.isLocalDesktop.mockReturnValue(true)
    const { container } = render(
      <MessageResponse>{ARTIFACT_TABLE}</MessageResponse>
    )

    await waitFor(() => {
      expect(fileBadges(container)).toHaveLength(2)
    })
    fireEvent.click(fileBadges(container)[0])
    await waitFor(() => {
      expect(mocks.openPath).toHaveBeenCalledWith(
        "/repo/src-tauri/target/release/bundle/dmg/Codeg_0.26.1_aarch64.dmg"
      )
    })
    expect(mocks.openFilePreview).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it("autolinks glued-CJK prose and absolute/home paths", async () => {
    const { container } = render(
      <MessageResponse>
        {
          "产物在src-tauri/target/dmg/codeg.dmg。日志见 /var/log/app.log 和 ~/notes.md"
        }
      </MessageResponse>
    )

    await waitFor(() => {
      expect(fileBadges(container)).toHaveLength(3)
    })
    expect(container.textContent).not.toContain("[blocked]")

    fireEvent.click(fileBadges(container)[1])
    await waitFor(() => {
      expect(mocks.openFilePreview).toHaveBeenCalledWith("/var/log/app.log", {
        line: undefined,
      })
    })
  })

  it("keeps a Windows drive path written in plain text inert", async () => {
    const { container } = render(
      <MessageResponse>{"打开 C:\\Users\\a\\手册.docx 看看"}</MessageResponse>
    )

    await waitFor(() => expect(container.textContent).toBeTruthy())
    expect(fileBadges(container)).toHaveLength(0)
    expect(container.textContent).toContain("C:\\Users\\a\\手册.docx")
    expect(container.textContent).not.toContain("[blocked]")
  })

  it("leaves prose slash-pairs and inline code alone", async () => {
    const { container } = render(
      <MessageResponse>
        {"and/or 与 TCP/IP 都是普通文本，`src/foo.ts` 是内联代码。"}
      </MessageResponse>
    )

    // Give the real pipeline a beat, then assert nothing was minted.
    await waitFor(() => {
      expect(container.querySelector("table, p")).not.toBeNull()
    })
    expect(fileBadges(container)).toHaveLength(0)
    expect(container.querySelector("code")?.textContent).toBe("src/foo.ts")
    expect(container.textContent).not.toContain("[blocked]")
  })
})
