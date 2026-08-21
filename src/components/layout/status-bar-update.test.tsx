import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateContextValue } from "@/components/providers/update-provider"
import type { AppUpdateState } from "@/lib/updater"

// Drive the component straight off the context value: the provider's own
// behaviour (checking, scheduling, seq guards) is covered in its test.
let ctx: UpdateContextValue | null = null
vi.mock("@/components/providers/update-provider", () => ({
  useAppUpdate: () => ctx,
}))

const openUrl = vi.fn()
vi.mock("@/lib/platform", () => ({ openUrl: (u: string) => openUrl(u) }))

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }))
vi.mock("sonner", () => ({ toast: { info: toastInfo } }))

// The popover pulls the markdown stack in lazily; keep the test off the ESM
// markdown pipeline (its rendering is the settings page's concern).
vi.mock("@/components/settings/release-notes", () => ({
  ReleaseNotes: ({
    notes,
    emptyLabel,
  }: {
    notes: string
    emptyLabel: string
  }) => <div data-testid="notes">{notes || emptyLabel}</div>,
}))

import { StatusBarUpdate } from "./status-bar-update"
import enMessages from "@/i18n/messages/en.json"

const startUpdate = vi.fn(async () => {})
const restart = vi.fn(async () => {})
const dismissAvailable = vi.fn()
const checkNow = vi.fn(async () => {})

function makeCtx(overrides: Partial<UpdateContextValue>): UpdateContextValue {
  const state: AppUpdateState = overrides.state ?? { seq: 1, status: "idle" }
  return {
    state,
    isUpdating: state.status === "downloading" || state.status === "installing",
    restartCountdown: null,
    isRollingBack: false,
    isRestarting: false,
    hydrated: true,
    isBusy: false,
    available: null,
    currentVersion: "0.21.7",
    checking: false,
    checkError: null,
    lastCheckedAt: new Date("2026-07-24T10:00:00Z"),
    selfUpdateSupported: false,
    liveProgress: false,
    runtime: undefined,
    rollbackAvailable: false,
    canInstallInPlace: true,
    dismissedVersion: null,
    checkNow,
    dismissAvailable,
    refreshLocalStatus: vi.fn(async () => {}),
    startUpdate,
    restart,
    rollback: vi.fn(async () => {}),
    ...overrides,
  }
}

function renderWith(overrides: Partial<UpdateContextValue>) {
  ctx = makeCtx(overrides)
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatusBarUpdate />
    </NextIntlClientProvider>
  )
}

const RELEASE = { version: "0.21.9", body: "## Fixes", date: "2026-07-24" }

beforeEach(() => {
  startUpdate.mockClear()
  restart.mockClear()
  dismissAvailable.mockClear()
  checkNow.mockClear()
  toastInfo.mockClear()
  openUrl.mockClear()
  localStorage.clear()
})

describe("StatusBarUpdate — trigger", () => {
  it("keeps the running version visible while idle", () => {
    renderWith({})
    expect(screen.getByRole("button", { name: "v0.21.7" })).toBeVisible()
  })

  it("renders nothing outside a provider", () => {
    ctx = null
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StatusBarUpdate />
      </NextIntlClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("badges a newly available release", () => {
    renderWith({ available: RELEASE })
    expect(screen.getByRole("button", { name: /New v0\.21\.9/ })).toBeVisible()
  })

  it("keeps a dismissed release reachable as a muted, label-less icon", () => {
    // Hiding it outright would leave the settings page as the only way back to
    // a release waved away by mistake. The icon stops asking for attention
    // (no accent colour, no label) but still opens the panel.
    renderWith({ available: RELEASE, dismissedVersion: "0.21.9" })

    const trigger = screen.getByRole("button", { name: /New v0\.21\.9/ })
    expect(trigger).toBeVisible()
    // The running version and arrow remain, but the release label and accent
    // stop asking for attention.
    expect(trigger.textContent).toBe("v0.21.7")
    expect(trigger.className).not.toContain("text-amber-700")
  })

  it("accents the badge with its label while the release is undismissed", () => {
    renderWith({ available: RELEASE })
    const trigger = screen.getByRole("button", { name: /New v0\.21\.9/ })
    expect(trigger.textContent).toContain("New v0.21.9")
    expect(trigger.className).toContain("border-amber-500/50")
    expect(trigger.className).toContain("bg-amber-500/15")
    expect(trigger.className).toContain("text-amber-700")
    expect(trigger.className).not.toContain("animate-pulse")
  })

  it("still shows a dismissed release once its download is staged", () => {
    // Dismissing hides the invitation, not an update the user then chose to
    // install — that one still needs its restart prompt.
    renderWith({
      available: RELEASE,
      dismissedVersion: "0.21.9",
      state: { seq: 4, status: "ready_to_restart", version: "0.21.9" },
    })
    expect(
      screen.getByRole("button", { name: /Restart to update/ })
    ).toBeVisible()
  })

  it("shows download percent while downloading", () => {
    renderWith({
      state: { seq: 2, status: "downloading", downloaded: 50, total: 200 },
    })
    expect(screen.getByRole("button", { name: /25%/ })).toBeVisible()
  })

  it("shows the restart countdown while relaunching", () => {
    renderWith({
      state: { seq: 6, status: "restarting" },
      restartCountdown: 3,
    })
    expect(
      screen.getByRole("button", { name: /Restarting in 3s/ })
    ).toBeVisible()
  })
})

describe("StatusBarUpdate — popover", () => {
  it("checks manually from the idle version panel", async () => {
    renderWith({})
    fireEvent.click(screen.getByRole("button", { name: "v0.21.7" }))

    expect(await screen.findByText("Software Update")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(checkNow).toHaveBeenCalledWith({ silent: false })
  })

  it("shows the version delta, notes and starts the in-place update", async () => {
    renderWith({ available: RELEASE })
    fireEvent.click(screen.getByRole("button", { name: /New v0\.21\.9/ }))

    expect(await screen.findByText("Update available")).toBeVisible()
    expect(screen.getByText("v0.21.7 → v0.21.9")).toBeVisible()
    await waitFor(() =>
      expect(screen.getByTestId("notes").textContent).toBe("## Fixes")
    )

    fireEvent.click(
      screen.getByRole("button", { name: /Upgrade to v0\.21\.9/ })
    )
    expect(startUpdate).toHaveBeenCalledTimes(1)
  })

  it("links to the release page when this client can't install in place", async () => {
    // Older remote server: driving the detached flow against it would hang on
    // its legacy blocking endpoint.
    renderWith({ available: RELEASE, canInstallInPlace: false })
    fireEvent.click(screen.getByRole("button", { name: /New v0\.21\.9/ }))

    const link = await screen.findByRole("button", {
      name: /View v0\.21\.9 release/,
    })
    fireEvent.click(link)
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/xintaofei/codeg/releases/latest"
    )
    expect(startUpdate).not.toHaveBeenCalled()
  })

  it("relaunches from the staged-update prompt", async () => {
    renderWith({
      available: RELEASE,
      state: { seq: 4, status: "ready_to_restart", version: "0.21.9" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Restart to update/ }))

    // Trigger and popover action share the label, so wait for the second one
    // to appear and click that.
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /Restart to update/ })
      ).toHaveLength(2)
    )
    const actions = screen.getAllByRole("button", { name: /Restart to update/ })
    fireEvent.click(actions[actions.length - 1])
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it("still offers the upgrade after a dismissal, without the Later button", async () => {
    // The muted icon must not be a dead end: the action survives, only the
    // nagging goes away — and "Later" is pointless once already dismissed.
    renderWith({ available: RELEASE, dismissedVersion: "0.21.9" })
    fireEvent.click(screen.getByRole("button", { name: /New v0\.21\.9/ }))

    expect(
      await screen.findByRole("button", { name: /Upgrade to v0\.21\.9/ })
    ).toBeVisible()
    expect(screen.getByText("Update available")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull()
  })

  it("dismisses the release and closes", async () => {
    renderWith({ available: RELEASE })
    fireEvent.click(screen.getByRole("button", { name: /New v0\.21\.9/ }))

    fireEvent.click(await screen.findByRole("button", { name: "Later" }))
    expect(dismissAvailable).toHaveBeenCalledTimes(1)
  })

  it("explains a failed install and offers a retry", async () => {
    renderWith({
      available: RELEASE,
      state: {
        seq: 7,
        status: "error",
        error: "error sending request for url",
      },
    })
    fireEvent.click(screen.getByRole("button", { name: /Update failed/ }))

    expect(await screen.findByText(/Check your network or proxy/)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(startUpdate).toHaveBeenCalled()
  })

  it("reports transferred bytes while downloading", async () => {
    renderWith({
      state: {
        seq: 2,
        status: "downloading",
        downloaded: 1024 * 1024,
        total: 4 * 1024 * 1024,
      },
    })
    fireEvent.click(screen.getByRole("button", { name: /25%/ }))
    expect(await screen.findByText("1.0 MB / 4.0 MB")).toBeVisible()
  })
})

describe("StatusBarUpdate — discovery notification", () => {
  it("announces each available release only once", () => {
    const first = renderWith({ available: RELEASE })
    expect(toastInfo).toHaveBeenCalledTimes(1)
    expect(toastInfo).toHaveBeenCalledWith(
      "New version v0.21.9 found",
      expect.objectContaining({ action: expect.any(Object) })
    )

    first.unmount()
    renderWith({ available: RELEASE })
    expect(toastInfo).toHaveBeenCalledTimes(1)
  })
})
