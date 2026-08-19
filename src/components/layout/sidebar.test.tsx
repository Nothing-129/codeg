import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Sidebar } from "./sidebar"
import { __resetUiPreferencesStoreForTests } from "@/lib/ui-preferences-store"
import enMessages from "@/i18n/messages/en.json"

// The conversation-status switches now persist through the backend
// UiPreferences store — capture the write instead of reading localStorage.
const uiPrefsSpies = vi.hoisted(() => ({
  updateUiPreferences: vi.fn((prefs: unknown) => Promise.resolve(prefs)),
}))

// Stable spies + mutable active-folder, referenced from the hoisted mock
// factories below (vi.mock is hoisted above imports).
const spies = vi.hoisted(() => ({
  openNewConversationTab: vi.fn(),
  openChatModeTab: vi.fn(),
  setSearchOpen: vi.fn(),
  setRoute: vi.fn(),
  openConversations: vi.fn(),
  toggleSidebar: vi.fn(),
  // Latest props the (stubbed) conversation list was rendered with, so tests can
  // assert what the sidebar threads down (e.g. showWorktrees / showCompleted).
  listProps: null as {
    showWorktrees?: boolean
    showCompleted?: boolean
    showRecent?: boolean
    sectionOrder?: readonly string[]
    onNavigate?: () => void
  } | null,
}))
const mockState = vi.hoisted(() => ({
  activeFolder: { id: 7, path: "/x" } as { id: number; path: string } | null,
  isMobile: false,
}))

// The conversation list is irrelevant here — stub it so the test exercises only
// the sidebar's header + fixed New chat / Search region.
vi.mock("@/components/conversations/sidebar-conversation-list", () => ({
  SidebarConversationList: (props: {
    showWorktrees?: boolean
    showCompleted?: boolean
    showRecent?: boolean
    sectionOrder?: readonly string[]
    onNavigate?: () => void
  }) => {
    spies.listProps = props
    return <button onClick={props.onNavigate}>Open folder conversation</button>
  },
}))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({ isOpen: true, toggle: spies.toggleSidebar }),
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: mockState.activeFolder }),
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    openNewConversationTab: spies.openNewConversationTab,
    openChatModeTab: spies.openChatModeTab,
  }),
}))
vi.mock("@/contexts/search-dialog-context", () => ({
  useSearchDialog: () => ({ open: false, setOpen: spies.setSearchOpen }),
}))
vi.mock("@/contexts/automations-view-context", () => ({
  useAutomationsView: () => ({
    automations: [],
    unseenFailures: 0,
    refetch: async () => {},
  }),
}))
vi.mock("@/contexts/tasks-view-context", () => ({
  useTasksView: () => ({
    tasks: [],
    attentionCount: 0,
    refetch: async () => {},
  }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({
    routeId: "conversations",
    isConversations: true,
    setRoute: spies.setRoute,
    openConversations: spies.openConversations,
  }),
}))
vi.mock("@/hooks/use-is-mac", () => ({ useIsMac: () => false }))
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({
    shortcuts: { toggle_search: "mod+k", new_conversation: "mod+t" },
  }),
}))
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockState.isMobile,
}))
vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100, setZoomLevel: () => {} }),
}))
vi.mock("@/lib/api", () => ({
  getUiPreferences: vi.fn(async () => null),
  updateUiPreferences: uiPrefsSpies.updateUiPreferences,
}))
vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
  subscribe: vi.fn(async () => () => {}),
  onTransportReconnect: vi.fn(() => null),
}))

function renderSidebar() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Sidebar />
    </NextIntlClientProvider>
  )
}

describe("Sidebar — fixed New chat / Search region", () => {
  beforeEach(() => {
    spies.openNewConversationTab.mockClear()
    spies.openChatModeTab.mockClear()
    spies.setSearchOpen.mockClear()
    spies.setRoute.mockClear()
    spies.openConversations.mockClear()
    spies.toggleSidebar.mockClear()
    mockState.activeFolder = { id: 7, path: "/x" }
    mockState.isMobile = false
  })

  it("renders the app name above New chat", () => {
    const { getByText } = renderSidebar()
    const brand = getByText("Codeg")
    const newChat = getByText("New chat")
    expect(brand.compareDocumentPosition(newChat)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it("Automations navigates to the automations route", () => {
    const { getByText } = renderSidebar()
    fireEvent.click(getByText("Automations"))
    expect(spies.setRoute).toHaveBeenCalledWith("automations")
  })

  it("New chat returns to the conversation workspace", () => {
    const { getByText } = renderSidebar()
    fireEvent.click(getByText("New chat"))
    expect(spies.openConversations).toHaveBeenCalled()
  })

  it("New chat opens a conversation tab in the active folder", () => {
    const { getByText } = renderSidebar()
    fireEvent.click(getByText("New chat"))
    expect(spies.openNewConversationTab).toHaveBeenCalledWith(7, "/x")
  })

  it("Search opens the shared search dialog", () => {
    const { getByText } = renderSidebar()
    fireEvent.click(getByText("Search"))
    expect(spies.setSearchOpen).toHaveBeenCalledWith(true)
  })

  it("renders New chat and Search shortcut hints", () => {
    const { getByText } = renderSidebar()
    // isMac=false → "mod" formats as "Ctrl". The badges are opacity-0 until the
    // row is hovered/focused but stay in the DOM, so getByText resolves them.
    expect(getByText("Ctrl+T")).toBeTruthy()
    expect(getByText("Ctrl+K")).toBeTruthy()
  })

  it("falls back to chat mode (never disabled) when no folder is active", () => {
    mockState.activeFolder = null
    const { getByText } = renderSidebar()
    const btn = getByText("New chat").closest("button") as HTMLButtonElement
    // Defense-in-depth: the button stays clickable so a workspace that recovered
    // to no active folder is never a dead end — it opens folderless chat mode.
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(spies.openChatModeTab).toHaveBeenCalled()
    expect(spies.openNewConversationTab).not.toHaveBeenCalled()
  })

  it("closes the mobile sidebar when the conversation list navigates", () => {
    mockState.isMobile = true
    renderSidebar()

    fireEvent.click(screen.getByText("Open folder conversation"))

    expect(spies.toggleSidebar).toHaveBeenCalledOnce()
  })
})

describe("Sidebar — Show worktree folders toggle", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("defaults Show worktree folders on and threads it to the conversation list", () => {
    renderSidebar()
    expect(spies.listProps?.showWorktrees).toBe(true)
  })

  it("respects an explicitly-stored 'false' from localStorage", () => {
    localStorage.setItem("workspace:sidebar-show-worktrees", "false")
    renderSidebar()
    // Hydration runs in a mount effect (flushed by render's act): a user who
    // unchecked it keeps it off despite the default-on.
    expect(spies.listProps?.showWorktrees).toBe(false)
  })

  it("toggling the funnel item off persists the choice and threads it down", async () => {
    const user = userEvent.setup()
    renderSidebar()
    // Default on with a cleared store.
    expect(spies.listProps?.showWorktrees).toBe(true)

    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Show worktree folders" })
    )

    expect(localStorage.getItem("workspace:sidebar-show-worktrees")).toBe(
      "false"
    )
    expect(spies.listProps?.showWorktrees).toBe(false)
  })
})

describe("Sidebar — conversation status view options", () => {
  beforeEach(() => {
    localStorage.clear()
    __resetUiPreferencesStoreForTests()
    uiPrefsSpies.updateUiPreferences.mockClear()
  })

  it("defaults both status switches on and persists turning them off", async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole("button", { name: "View options" }))
    const showStatus = screen.getByRole("menuitemcheckbox", {
      name: "Show status colors",
    })
    const allowActions = screen.getByRole("menuitemcheckbox", {
      name: "Allow changing conversation status",
    })
    expect(showStatus).toHaveAttribute("data-state", "checked")
    expect(allowActions).toHaveAttribute("data-state", "checked")

    await user.click(showStatus)
    await user.click(allowActions)

    expect(showStatus).toHaveAttribute("data-state", "unchecked")
    expect(allowActions).toHaveAttribute("data-state", "unchecked")
    // Persisted to the backend as the full UiPreferences blob (not localStorage).
    expect(uiPrefsSpies.updateUiPreferences).toHaveBeenLastCalledWith({
      show_conversation_status: false,
      allow_conversation_status_actions: false,
      show_welcome_quick_actions: true,
    })
  })
})

describe("Sidebar — Show completed default", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("defaults Show completed off and threads it to the conversation list", () => {
    renderSidebar()
    expect(spies.listProps?.showCompleted).toBe(false)
  })

  it("respects an explicitly-stored 'true' from localStorage", () => {
    localStorage.setItem("workspace:sidebar-show-completed", "true")
    renderSidebar()
    expect(spies.listProps?.showCompleted).toBe(true)
  })
})

describe("Sidebar — Show Recent group toggle", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("defaults Show Recent on and threads it to the conversation list", () => {
    renderSidebar()
    expect(spies.listProps?.showRecent).toBe(true)
  })

  it("respects an explicitly-stored 'false' from localStorage", () => {
    localStorage.setItem("workspace:sidebar-show-recent", "false")
    renderSidebar()
    expect(spies.listProps?.showRecent).toBe(false)
  })

  it("toggling the funnel item off persists the choice and keeps the menu open", async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Show Recent group" })
    )

    expect(localStorage.getItem("workspace:sidebar-show-recent")).toBe("false")
    expect(spies.listProps?.showRecent).toBe(false)
    // The view-options menu is a settings panel: flipping one option must not
    // dismiss it, or changing two costs two trips through the trigger.
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Show Recent group" })
    ).toBeTruthy()
  })
})

describe("Sidebar — Section order control", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  // The order rows are `menuitem`s labelled "<name> — position N of 3"; the
  // move buttons inside them are labelled "<name> — Move up/down".
  const orderRowNames = () =>
    screen
      .getAllByRole("menuitem")
      .map((el) => el.getAttribute("aria-label") ?? "")
      .filter((label) => label.includes("position"))

  it("defaults to Folders → Chat → Recent", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    expect(orderRowNames()).toEqual([
      "Folders — position 1 of 3",
      "Chat — position 2 of 3",
      "Recent — position 3 of 3",
    ])
    expect(spies.listProps?.sectionOrder).toEqual([
      "folders",
      "chats",
      "recent",
    ])
  })

  it("moves a section up, persists the new order and threads it down", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.click(screen.getByRole("button", { name: "Recent — Move up" }))

    expect(orderRowNames()).toEqual([
      "Folders — position 1 of 3",
      "Recent — position 2 of 3",
      "Chat — position 3 of 3",
    ])
    expect(spies.listProps?.sectionOrder).toEqual([
      "folders",
      "recent",
      "chats",
    ])
    expect(
      JSON.parse(localStorage.getItem("workspace:sidebar-section-order") ?? "")
    ).toEqual(["folders", "recent", "chats"])
  })

  it("disables the move buttons that would fall off an end", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    expect(
      screen.getByRole("button", { name: "Folders — Move up" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Recent — Move down" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Folders — Move down" })
    ).not.toBeDisabled()
  })

  it("reorders from the keyboard with Alt+Arrow on the focused row", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    // The nested move buttons are unreachable by Tab (Radix's menu swallows it)
    // and by the roving focus, so Alt+Arrow on the row is the ONLY keyboard
    // path — if this regresses, the control becomes mouse-only.
    const foldersRow = screen.getByRole("menuitem", {
      name: "Folders — position 1 of 3",
    })
    // Focusing a menu item updates Radix's roving-focus state, so it has to run
    // inside act().
    act(() => foldersRow.focus())
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}")

    expect(orderRowNames()).toEqual([
      "Chat — position 1 of 3",
      "Folders — position 2 of 3",
      "Recent — position 3 of 3",
    ])
    // Focus follows the row it moved, so a second press keeps going.
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Folders — position 2 of 3"
    )
  })

  it("restores a legacy 'chats-first' preference from an older build", async () => {
    const user = userEvent.setup()
    localStorage.setItem("workspace:sidebar-section-order", "chats-first")
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    expect(orderRowNames()).toEqual([
      "Chat — position 1 of 3",
      "Folders — position 2 of 3",
      "Recent — position 3 of 3",
    ])
  })

  it("keeps a hidden Recent section listed and reorderable", async () => {
    const user = userEvent.setup()
    localStorage.setItem("workspace:sidebar-show-recent", "false")
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    // Hiding is a separate preference from position: the row stays so the user
    // can park it where it will reappear.
    await user.click(screen.getByRole("button", { name: "Recent — Move up" }))
    expect(spies.listProps?.sectionOrder).toEqual([
      "folders",
      "recent",
      "chats",
    ])
    expect(spies.listProps?.showRecent).toBe(false)
  })
})
