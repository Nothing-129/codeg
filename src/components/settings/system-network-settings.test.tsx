import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, expect, it, vi } from "vitest"

const transportCall = vi.fn()

vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: transportCall }),
  isDesktop: () => false,
  isRemoteDesktopMode: () => false,
  getActiveRemoteConnectionId: () => null,
}))

vi.mock("@/lib/api", () => ({
  getSystemProxySettings: vi.fn(),
  updateSystemProxySettings: vi.fn(),
  updateSystemLanguageSettings: vi.fn(),
  listenBackupProgress: vi.fn(async () => () => {}),
  exportBackupDesktop: vi.fn(),
  exportBackupWeb: vi.fn(),
  inspectBackupDesktop: vi.fn(),
  inspectBackupWeb: vi.fn(),
  scanExternalConflictsDesktop: vi.fn(),
  scanExternalConflictsWeb: vi.fn(),
  stageRestoreDesktop: vi.fn(),
  stageRestoreWeb: vi.fn(),
  uploadBackupWeb: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}))

vi.mock("@/lib/platform", () => ({ openUrl: vi.fn(), isDesktop: () => false }))

vi.mock("@/components/i18n-provider", () => ({
  useAppI18n: () => ({
    languageSettings: { mode: "system", language: "en" },
    languageSettingsLoaded: true,
    setLanguageSettings: vi.fn(),
  }),
}))

import { SystemNetworkSettings } from "./system-network-settings"
import enMessages from "@/i18n/messages/en.json"
import { getSystemProxySettings } from "@/lib/api"

const mockGetProxy = vi.mocked(getSystemProxySettings)

beforeEach(() => {
  transportCall.mockReset()
  mockGetProxy.mockReset()
})

it("loads system settings without exposing or checking for updates", async () => {
  mockGetProxy.mockResolvedValue({
    enabled: true,
    proxy_url: "http://proxy.local:8080",
  })

  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SystemNetworkSettings />
    </NextIntlClientProvider>
  )

  expect(
    await screen.findByDisplayValue("http://proxy.local:8080")
  ).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Check for updates" })
  ).not.toBeInTheDocument()
  expect(screen.queryByText("Version & Updates")).not.toBeInTheDocument()
  expect(transportCall).not.toHaveBeenCalled()
})
