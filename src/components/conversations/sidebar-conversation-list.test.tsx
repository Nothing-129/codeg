import {
  createRef,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useState,
} from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SidebarConversationList,
  resetFolderPointerToggleGuardForTests,
  type SidebarConversationListHandle,
} from "./sidebar-conversation-list"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import enMessages from "@/i18n/messages/en.json"

// ── Probes ────────────────────────────────────────────────────────────────
// AgentIcon renders once per card body → counts card re-renders. The Folder /
// FolderOpen lucide icon renders once per FolderHeader body → counts folder
// re-renders. Both increment only when the owning memoized component does NOT
// bail out, so they measure exactly the production memo path.
const probes = vi.hoisted(() => ({ card: 0, folder: 0, root: 0 }))

// Mutable backing store the mocked tab-context hook reads from (workspace data
// now lives in the real zustand store, seeded per test below). `tabs` is
// rebuilt fresh every render to mirror tab-context re-deriving it on each
// `conversations` change.
const store = vi.hoisted(() => ({
  activeTabId: null as string | null,
  tabSpec: [] as Array<{
    id: string
    conversationId: number | null
    agentType: string
    folderId: number
    title: string
    isPinned: boolean
  }>,
}))

// Action spies installed into the workspace store before each test. zustand
// keeps these referentially stable across renders (as the real store's action
// fields are), so the list's folder callbacks that close over them stay
// memoized.
const stableWorkspaceFns = vi.hoisted(() => ({
  refreshConversations: async () => {},
  updateConversationLocal: () => {},
  removeFolderFromWorkspace: async () => {},
  openFolder: async () => ({}) as FolderDetail,
  refreshFolder: async () => {},
}))

const stableTabFns = vi.hoisted(() => ({
  openTab: () => {},
  closeConversationTab: () => {},
  closeTabsByFolder: () => {},
  openNewConversationTab: vi.fn(),
}))

const stableAgents = vi.hoisted(() => ({ sortedTypes: ["claude_code"] }))

// Context functions are stable refs in production (useCallback values); the
// mocks must be too, else the list's folder callbacks (which close over them)
// would churn and mask the memo behaviour under test.
const stableTask = vi.hoisted(() => ({
  addTask: () => {},
  updateTask: () => {},
}))
const stableTerminal = vi.hoisted(() => ({
  createTerminalInDirectory: () => {},
}))

vi.mock("@/components/agent-icon", () => ({
  AgentIcon: () => {
    probes.card++
    return null
  },
}))

// Controllable virtua geometry for the sticky-overlay tests. All rows are 32px
// (h-[2rem]), so offsets are index*32 and findItemIndex is floor(offset/32).
const virtuaCtl = vi.hoisted(() => ({
  scrollOffset: 0,
  onScroll: null as ((offset: number) => void) | null,
  scrollToIndex: vi.fn(),
}))

// Render EVERY row (data.map) rather than only a window, so the render-count
// probes stay meaningful in jsdom (which has no real layout/scroll). This is
// exactly why virtua's windowing itself needs manual QA on a large dataset. The
// mock also forwards a settable VirtualizerHandle (ref-as-prop, React 19) so the
// list's scroll-driven sticky logic can be exercised; with scrollOffset left at
// 0 the overlay stays hidden, so the memo-scope tests below are unaffected.
vi.mock("virtua", () => ({
  Virtualizer: ({
    data,
    children,
    onScroll,
    ref,
  }: {
    data: unknown[]
    children: (row: unknown, index: number) => ReactNode
    onScroll?: (offset: number) => void
    ref?: Ref<unknown>
  }) => {
    virtuaCtl.onScroll = onScroll ?? null
    useImperativeHandle(ref, () => ({
      get scrollOffset() {
        return virtuaCtl.scrollOffset
      },
      get scrollSize() {
        return data.length * 32
      },
      get viewportSize() {
        return 600
      },
      findItemIndex: (offset: number) =>
        Math.max(0, Math.min(data.length - 1, Math.floor(offset / 32))),
      getItemOffset: (index: number) => index * 32,
      getItemSize: () => 32,
      scrollToIndex: virtuaCtl.scrollToIndex,
      scrollTo: () => {},
      scrollBy: () => {},
    }))
    return <>{data.map((row, i) => children(row, i))}</>
  },
}))

// FolderHeader renders exactly one glyph in its body per variant: FolderClosed/
// FolderOpen (a repo / plain folder / repo container header) → `probes.folder`,
// or FolderRoot (a container's "root" sub-group header) → `probes.root`. Every
// other icon stays real. FolderRoot is used ONLY by the root sub-group, so it is
// an exact re-render probe. Worktree headers use FolderGit2, which the Folders
// section header's Clone action ALSO renders — so it is deliberately left real
// (not a probe); worktree headers are asserted via `data-folder-id` + the branch
// label instead.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return {
    ...actual,
    FolderClosed: () => {
      probes.folder++
      return null
    },
    FolderOpen: () => {
      probes.folder++
      return null
    },
    FolderRoot: () => {
      probes.root++
      return null
    },
  }
})

// The list mounts the Virtualizer only once OverlayScrollbars surfaces its
// viewport; the mock fires that bridge synchronously after mount.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    onViewportRef,
  }: {
    children?: ReactNode
    onViewportRef?: (el: HTMLElement | null) => void
  }) => {
    useEffect(() => {
      onViewportRef?.(document.createElement("div"))
    }, [onViewportRef])
    return <>{children}</>
  },
}))

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}))

vi.mock("@/hooks/use-appearance", () => ({
  useThemeColor: () => ({ themeColor: "blue" }),
  useZoomLevel: () => {},
}))

vi.mock("@/hooks/use-sorted-available-agents", () => ({
  useSortedAvailableAgents: () => ({
    sortedTypes: stableAgents.sortedTypes,
    fresh: true,
    refresh: () => {},
  }),
}))

vi.mock("@/contexts/terminal-context", () => ({
  useTerminalContext: () => stableTerminal,
}))

vi.mock("@/contexts/task-context", () => ({
  useTaskContext: () => stableTask,
}))

vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: null }),
}))

vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => stableTabFns,
  useTabStore: (
    selector: (s: {
      activeTabId: string | null
      tabs: Array<Record<string, unknown>>
    }) => unknown
  ) =>
    selector({
      activeTabId: store.activeTabId,
      // Fresh array + fresh objects every render → worst-case churn, exactly
      // what the list's reuseSelected/reuseSet must absorb to keep folders
      // memoized.
      tabs: store.tabSpec.map((t) => ({ ...t })),
    }),
}))
vi.mock("@/contexts/workbench-route-context", () => {
  // Stable singleton — the real provider memoizes these (useCallback([])), so a
  // fresh object per render would break the list's callback-identity memoization
  // probes.
  const value = {
    routeId: "conversations",
    isConversations: true,
    setRoute: () => {},
    openConversations: () => {},
  }
  return { useWorkbenchRoute: () => value }
})

// These only mount when their state opens (never in these tests); stub to keep
// the import graph light.
vi.mock("./conversation-manage-dialog", () => ({
  ConversationManageDialog: () => null,
}))
vi.mock("@/components/layout/clone-dialog", () => ({ CloneDialog: () => null }))
// The sub-session realtime sync hook reaches @/lib/platform (transport), which
// these tests don't load; stub it to a no-op — it has its own unit tests.
vi.mock("@/hooks/use-subsession-sync", () => ({ useSubsessionSync: () => {} }))
vi.mock("@/components/shared/directory-browser-dialog", () => ({
  DirectoryBrowserDialog: () => null,
}))

const MINUTE = 60_000
const FIXED = 1_700_000_000_000

function conv(
  id: number,
  folderId: number,
  overrides: Partial<DbConversationSummary> = {}
): DbConversationSummary {
  const createdAt = new Date(FIXED - 5 * MINUTE).toISOString()
  return {
    id,
    folder_id: folderId,
    title: `conv-${id}`,
    title_locked: false,
    agent_type: "claude_code",
    status: "pending",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: null,
    message_count: 0,
    child_count: 0,
    created_at: createdAt,
    updated_at: createdAt,
    pinned_at: null,
    ...overrides,
  }
}

function folder(
  id: number,
  name: string,
  parentId: number | null = null
): FolderDetail {
  return {
    id,
    name,
    path: `/p/${id}`,
    color: "blue",
    default_agent_type: null,
    parent_id: parentId,
  } as unknown as FolderDetail
}

// Re-render only the list, leaving the intl provider mounted once — mirrors
// production, where NextIntlClientProvider sits high in the tree and stays
// stable (so `useTranslations` returns a stable `t`) while the list re-renders
// on each conversations change.
const harness: { rerender: () => void } = { rerender: () => {} }
function Harness() {
  const [, setTick] = useState(0)
  useEffect(() => {
    harness.rerender = () => setTick((n) => n + 1)
  }, [])
  return <SidebarConversationList showCompleted sortMode="created" />
}

function tree() {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Harness />
    </NextIntlClientProvider>
  )
}

// Reset the virtua geometry and the workspace store before every test (runs
// before each describe's own beforeEach) so a scrolled overlay test never
// bleeds into the memo-scope suites, which all assume scrollOffset 0 →
// overlay hidden. The store reset restores pristine state; the setState then
// flips the loading flags off and installs the stable action spies, and each
// describe's own beforeEach seeds its folders/conversations fixture on top.
beforeEach(() => {
  resetAppWorkspaceStore()
  useAppWorkspaceStore.setState({
    conversationsLoading: false,
    conversationsError: null,
    ...stableWorkspaceFns,
  })
  virtuaCtl.scrollOffset = 0
  virtuaCtl.onScroll = null
  virtuaCtl.scrollToIndex.mockClear()
  stableTabFns.openNewConversationTab.mockClear()
})

describe("SidebarConversationList — single status event re-render scope", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED })
    probes.card = 0
    probes.folder = 0
    const folders = [folder(1, "Folder 1"), folder(2, "Folder 2")]
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [
        conv(11, 1),
        conv(12, 1),
        conv(21, 2),
        conv(22, 2),
        conv(23, 2),
      ],
    })
    // One open tab in folder 1 → exercises the selectedConversation object and
    // openTabKeys Set reuse paths (these churn refs every render via the mock).
    store.activeTabId = "tab-11"
    store.tabSpec = [
      {
        id: "tab-11",
        conversationId: 11,
        agentType: "claude_code",
        folderId: 1,
        title: "conv-11",
        isPinned: false,
      },
    ]
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("indents folder sessions without drawing a folder spine", () => {
    render(tree())
    const cards = document.querySelectorAll("[data-conv-key]")
    expect(cards.length).toBe(5)
    // Sessions sit one step under the folder header, but the first indent
    // step does not grow a vertical rail — two expanded folders stay
    // separate groups, not one connected column.
    for (const card of cards) {
      expect(card.querySelectorAll("[data-subsession-rail]")).toHaveLength(0)
      expect(
        (card as HTMLElement).style.getPropertyValue("--conv-rail-axis")
      ).toBe("calc(0.875rem + 1 * 1.25rem)")
    }
  })

  it("re-renders exactly one card and no folder headers when a single summary changes", () => {
    render(tree())

    // Sanity: initial mount rendered all 5 cards and both folders.
    expect(probes.card).toBe(5)
    expect(probes.folder).toBe(2)

    // Mirror updateConversationLocal: replace exactly one summary (folder 2,
    // conv 22) with a new object; every other summary keeps its identity.
    const prev = useAppWorkspaceStore.getState().conversations
    const next = prev.slice()
    const idx = next.findIndex((c) => c.id === 22)
    next[idx] = { ...next[idx], status: "completed" }

    probes.card = 0
    probes.folder = 0
    act(() => {
      useAppWorkspaceStore.setState({ conversations: next })
    })
    act(() => harness.rerender())

    // Card-level gate: only the changed card re-renders (R1 + R1b + shared now).
    expect(probes.card).toBe(1)
    // Folder headers are fully decoupled from their conversation rows in the
    // flat model — a status event leaves every header's props (count, expanded,
    // stable callbacks) unchanged, so no header re-renders at all.
    expect(probes.folder).toBe(0)
  })

  it("re-renders nothing when conversations are unchanged despite tab churn", () => {
    render(tree())

    probes.card = 0
    probes.folder = 0
    // Same conversations reference; tabs still churns (fresh array each render).
    act(() => harness.rerender())

    expect(probes.card).toBe(0)
    expect(probes.folder).toBe(0)
  })
})

describe("SidebarConversationList — Pinned section (migration semantics)", () => {
  beforeEach(() => {
    probes.card = 0
    probes.folder = 0
    const folders = [folder(1, "Folder 1"), folder(2, "Folder 2")]
    store.activeTabId = null
    store.tabSpec = []
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [
        conv(11, 1),
        conv(12, 1, { pinned_at: new Date(FIXED).toISOString() }), // pinned
        conv(21, 2),
      ],
    })
  })

  it("moves a pinned conversation into the Pinned section above Folders, without duplicating it", () => {
    render(tree())
    const text = document.body.textContent ?? ""
    // The Pinned section header exists only because something is pinned, and it
    // sits above the Folders section.
    expect(text).toContain("Pinned")
    expect(text).toContain("Folders")
    const iPinned = text.indexOf("Pinned")
    const iFolders = text.indexOf("Folders")
    const iConv12 = text.indexOf("conv-12") // the pinned conversation
    const iConv11 = text.indexOf("conv-11") // unpinned → stays in its folder
    // conv-12 renders under the Pinned header and above the Folders section…
    expect(iPinned).toBeLessThan(iConv12)
    expect(iConv12).toBeLessThan(iFolders)
    // …while the unpinned conv-11 lives down in the folders section.
    expect(iFolders).toBeLessThan(iConv11)
    // Migration, not duplication: 3 conversations → exactly 3 rendered cards.
    expect(probes.card).toBe(3)
  })

  it("omits the Pinned section entirely when nothing is pinned", () => {
    useAppWorkspaceStore.setState({ conversations: [conv(11, 1), conv(21, 2)] })
    render(tree())
    const text = document.body.textContent ?? ""
    expect(text).not.toContain("Pinned")
    expect(text).toContain("Folders")
  })
})

describe("SidebarConversationList — folder expand/collapse", () => {
  beforeEach(() => {
    resetFolderPointerToggleGuardForTests()
    localStorage.clear()
    vi.useFakeTimers({ now: FIXED })
    const folders = [folder(1, "F1"), folder(2, "F2"), folder(3, "F3")]
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [conv(11, 1), conv(21, 2), conv(31, 3)],
    })
    store.activeTabId = null
    store.tabSpec = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("toggles only the clicked folder: expanded collapses, collapsed expands", () => {
    render(tree())
    const folderOne = document.querySelector(
      '[data-folder-id="1"]'
    ) as HTMLElement
    const folderTwo = document.querySelector(
      '[data-folder-id="2"]'
    ) as HTMLElement
    expect(document.body.textContent).toContain("conv-11")
    expect(document.body.textContent).toContain("conv-21")
    act(() => {
      fireEvent.click(folderOne)
    })
    expect(document.body.textContent).not.toContain("conv-11")
    expect(document.body.textContent).toContain("conv-21")
    act(() => {
      fireEvent.click(folderOne)
    })
    expect(document.body.textContent).toContain("conv-11")
    expect(document.body.textContent).toContain("conv-21")
    act(() => {
      fireEvent.click(folderTwo)
    })
    expect(document.body.textContent).toContain("conv-11")
    expect(document.body.textContent).not.toContain("conv-21")
  })

  it("does not let a leftover trackpad click undo the pointerdown toggle", () => {
    render(tree())
    const folderOne = document.querySelector(
      '[data-folder-id="1"]'
    ) as HTMLElement
    expect(document.body.textContent).toContain("conv-11")
    act(() => {
      const ev = new Event("pointerdown", { bubbles: true, cancelable: true })
      Object.assign(ev, {
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
      })
      folderOne.dispatchEvent(ev)
    })
    expect(document.body.textContent).not.toContain("conv-11")
    // WebKit remounts the header, then synthesizes click. Must not expand again.
    const remounted = document.querySelector(
      '[data-folder-id="1"]'
    ) as HTMLElement
    act(() => {
      fireEvent.click(remounted)
    })
    expect(document.body.textContent).not.toContain("conv-11")
    expect(document.body.textContent).toContain("conv-21")
  })

  it("does not lose a rapid second toggle while the first render is pending", () => {
    localStorage.setItem(
      "workspace:sidebar-folder-expanded",
      JSON.stringify({ 1: false })
    )
    render(tree())
    const folderOne = document.querySelector(
      '[data-folder-id="1"]'
    ) as HTMLElement

    act(() => {
      fireEvent.click(folderOne)
      fireEvent.click(folderOne)
    })

    expect(document.body.textContent).not.toContain("conv-11")
  })

  it("opens a new conversation from the folder header button", () => {
    render(tree())
    const toggle = document.querySelector('[data-folder-id="1"]')
    const newConversation = toggle?.parentElement?.querySelector(
      'button[aria-label="New Conversation"]'
    )
    if (!newConversation) throw new Error("new-conversation button not found")
    fireEvent.click(newConversation)
    expect(stableTabFns.openNewConversationTab).toHaveBeenCalledWith(1, "/p/1")
  })

  it("does not render a folder reorder grip", () => {
    render(tree())
    expect(document.querySelector("[data-folder-grip]")).toBeNull()
  })
})

// Drives the sticky overlay via the controllable virtua handle. The overlay is
// resolved from the layout effect at mount (no scroll event needed): set
// virtuaCtl.scrollOffset before render and assert the duplicated header. Real
// virtua scrolling / handoff smoothness still needs manual QA.
describe("SidebarConversationList — sticky folder header overlay", () => {
  beforeEach(() => {
    resetFolderPointerToggleGuardForTests()
    localStorage.clear() // folderExpanded persists across tests otherwise
    const folders = [folder(1, "Folder 1"), folder(2, "Folder 2")]
    // rows: F1(0) c11(1) c12(2) F2(3) c21(4) c22(5) c23(6)
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [
        conv(11, 1),
        conv(12, 1),
        conv(21, 2),
        conv(22, 2),
        conv(23, 2),
      ],
    })
    store.activeTabId = null
    store.tabSpec = []
  })

  function headerCount(folderId: number): number {
    return document.querySelectorAll(`[data-folder-id="${folderId}"]`).length
  }

  it("hides the overlay at the top of the list", () => {
    virtuaCtl.scrollOffset = 0
    render(tree())
    // Only the real in-list header exists for each folder.
    expect(headerCount(1)).toBe(1)
    expect(headerCount(2)).toBe(1)
  })

  it("shows a sticky overlay for the folder scrolled through", () => {
    virtuaCtl.scrollOffset = 40 // past F1's header (offset 0), inside conv 11
    render(tree())
    // Folder 1 header is duplicated in the DOM (in-list + overlay); folder 2 is
    // not.
    expect(headerCount(1)).toBe(2)
    expect(headerCount(2)).toBe(1)
    // Only one of the two is accessible: the in-list copy is suppressed
    // (inert + aria-hidden) so the overlay is the sole tab stop / announcement.
    const f1 = document.querySelectorAll('[data-folder-id="1"]')
    expect(
      (f1[0] as HTMLElement).closest('[aria-hidden="true"]')
    ).not.toBeNull()
    expect((f1[1] as HTMLElement).closest('[aria-hidden="true"]')).toBeNull()
    // The accessible (overlay) toggle exposes its expanded state to AT.
    expect((f1[1] as HTMLElement).getAttribute("aria-expanded")).toBe("true")
  })

  it("tracks the active folder as the scroll moves into the next folder", () => {
    virtuaCtl.scrollOffset = 130 // inside folder 2 (F2 header at offset 96)
    render(tree())
    expect(headerCount(1)).toBe(1)
    expect(headerCount(2)).toBe(2)
  })

  it("collapses from the overlay and pins the header BEFORE the shrink", () => {
    virtuaCtl.scrollOffset = 130 // overlay shows folder 2
    render(tree())
    const headers = document.querySelectorAll('[data-folder-id="2"]')
    expect(headers.length).toBe(2)
    // headers[1] is the overlay copy (rendered after ScrollArea in DOM order).
    act(() => {
      fireEvent.click(headers[1] as HTMLElement)
    })
    // The folder collapsed (its conversation rows are gone).
    expect(document.body.textContent).not.toContain("conv-21")
    // The pin scroll runs synchronously BEFORE the row shrink — scrolling
    // shrunken content desynced virtua's layout from the viewport and left
    // the list click-dead until the next real scroll (the "expand needs two
    // clicks" bug). The header's flat index is the same pre/post collapse:
    // section(0), F1(1), c11(2), c12(3), F2(4) → instant, aligned to start.
    expect(virtuaCtl.scrollToIndex).toHaveBeenCalledWith(4, {
      align: "start",
      smooth: false,
    })
  })
})

describe("SidebarConversationList — scrollToActive across a worktree merge", () => {
  const EXPANDED_KEY = "workspace:sidebar-folder-expanded"

  beforeEach(() => {
    // Root folder 1 + worktree child folder 2 (parent_id = 1), one conversation
    // in each. Select the worktree conversation via the active tab.
    const folders = [folder(1, "Root"), folder(2, "Worktree", 1)]
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [conv(11, 1), conv(21, 2)],
    })
    store.activeTabId = "tab-21"
    store.tabSpec = [
      {
        id: "tab-21",
        conversationId: 21,
        agentType: "claude_code",
        folderId: 2,
        title: "conv-21",
        isPinned: false,
      },
    ]
    // Collapse the parent (root) group so the merged worktree row is initially
    // absent from the flat model.
    localStorage.setItem(EXPANDED_KEY, JSON.stringify({ 1: false }))
  })

  afterEach(() => {
    localStorage.removeItem(EXPANDED_KEY)
  })

  it("expands the parent group to reveal and scroll to a merged worktree conversation", () => {
    const ref = createRef<SidebarConversationListHandle>()
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SidebarConversationList showCompleted sortMode="created" ref={ref} />
      </NextIntlClientProvider>
    )

    // Parent collapsed → the worktree row is not in the flat model, so no scroll
    // can resolve yet.
    expect(virtuaCtl.scrollToIndex).not.toHaveBeenCalled()

    act(() => {
      ref.current?.scrollToActive()
    })

    // The fix resolves the *display group* (parent folder 1), expands it, and the
    // deferred scroll then finds the worktree row. Pre-fix this stayed at 0
    // because it checked/expanded the child folder id (2) — never a rendered
    // group — so the row never entered the flat model.
    expect(virtuaCtl.scrollToIndex).toHaveBeenCalled()
  })
})

describe("SidebarConversationList — folder ⋯ opens the same menu as right-click", () => {
  beforeEach(() => {
    probes.card = 0
    probes.folder = 0
    const folders = [folder(1, "Folder 1")]
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [conv(11, 1)],
    })
    store.activeTabId = null
    store.tabSpec = []
  })

  it("opens the folder context menu via the ⋯ button — no right-click needed", () => {
    render(tree())
    // Closed: Radix mounts the menu content lazily, so its items aren't present.
    expect(document.body.textContent).not.toContain("Manage conversations")

    // The ⋯ button dispatches a synthetic `contextmenu` event that bubbles to the
    // same <ContextMenuTrigger> the right-click uses — single source of truth.
    const moreBtn = document.querySelector('[aria-label="More options"]')
    expect(moreBtn).not.toBeNull()
    act(() => {
      fireEvent.click(moreBtn as HTMLElement)
    })

    // The identical menu is now open — assert a label unique to the folder menu.
    expect(document.body.textContent).toContain("Manage conversations")
  })
})

describe("SidebarConversationList — worktree grouping (Show worktrees)", () => {
  // A repo (folder 1) with two conversations, plus a worktree child (folder 2,
  // branch "feature-x") holding one conversation.
  const wtHarness: { rerender: () => void } = { rerender: () => {} }
  function WtHarness({ showWorktrees }: { showWorktrees: boolean }) {
    const [, setTick] = useState(0)
    useEffect(() => {
      wtHarness.rerender = () => setTick((n) => n + 1)
    }, [])
    return (
      <SidebarConversationList
        showCompleted
        showWorktrees={showWorktrees}
        sortMode="created"
      />
    )
  }
  function wtTree(showWorktrees: boolean) {
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WtHarness showWorktrees={showWorktrees} />
      </NextIntlClientProvider>
    )
  }

  function folderHeaderIds(): number[] {
    return Array.from(document.querySelectorAll("[data-folder-id]")).map((el) =>
      Number(el.getAttribute("data-folder-id"))
    )
  }

  beforeEach(() => {
    probes.card = 0
    probes.folder = 0
    probes.root = 0
    const wt = {
      ...folder(2, "wt-feature", 1),
      git_branch: "feature-x",
    } as unknown as FolderDetail
    const folders = [folder(1, "Repo"), wt]
    store.activeTabId = null
    store.tabSpec = []
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [conv(11, 1), conv(12, 1), conv(21, 2)],
    })
  })

  it("merges worktree conversations flat under the parent when off", () => {
    render(wtTree(false))
    // Only the repo gets a header; the worktree child is hidden and its
    // conversation is merged into the repo bucket — no container/root split.
    expect(folderHeaderIds()).toEqual([1])
    const text = document.body.textContent ?? ""
    expect(text).toContain("conv-11")
    expect(text).toContain("conv-12")
    expect(text).toContain("conv-21")
    // No worktree header → no branch label; no root sub-group (probes.root===0,
    // the unambiguous check — the "root" label is a generic word to match on).
    expect(text).not.toContain("feature-x")
    expect(probes.root).toBe(0)
  })

  it("splits the repo into a container + root sub-group + worktree sub-group when on", () => {
    render(wtTree(true))
    // Container header (repo id 1) → root sub-group header (also repo id 1, its
    // own sessions) → worktree header (id 2). The repo id appears twice: the
    // container and its root sub-group both carry it.
    expect(folderHeaderIds()).toEqual([1, 1, 2])
    const text = document.body.textContent ?? ""
    // Order: container "Repo" → "root" sub-group + its own convs → worktree
    // branch "feature-x" + the worktree's conv.
    const iRoot = text.indexOf("root")
    const iRepoConv = text.indexOf("conv-11")
    const iBranch = text.indexOf("feature-x")
    const iWtConv = text.indexOf("conv-21")
    expect(iRoot).toBeGreaterThanOrEqual(0)
    expect(iRepoConv).toBeGreaterThan(iRoot)
    expect(iBranch).toBeGreaterThan(iRepoConv)
    expect(iWtConv).toBeGreaterThan(iBranch)
    // Exactly one container header (FolderOpen) + one root sub-group (FolderRoot).
    expect(probes.folder).toBe(1)
    expect(probes.root).toBe(1)
  })

  it("collapsing the root sub-group hides the repo's own sessions but keeps the worktree", () => {
    render(wtTree(true))
    expect(document.body.textContent).toContain("conv-11")

    // Toggle the root sub-group header (the SECOND data-folder-id=1 button, after
    // the container). Its own sessions collapse; the worktree stays visible.
    const repoHeaders = document.querySelectorAll('[data-folder-id="1"]')
    expect(repoHeaders).toHaveLength(2)
    act(() => {
      fireEvent.click(repoHeaders[1] as HTMLElement)
    })

    const text = document.body.textContent ?? ""
    expect(text).not.toContain("conv-11")
    expect(text).not.toContain("conv-12")
    // The worktree sub-group is untouched.
    expect(text).toContain("feature-x")
    expect(text).toContain("conv-21")
  })

  it("labels a worktree sub-group `branch [ directory ]`", () => {
    // What a worktree registered through `open_worktree_folder_core` looks like:
    // the alias was seeded with the branch it was created on. `git_branch` on the
    // folder row is never written by the folder flow, so without the alias every
    // worktree fell back to its (long, derived) directory name alone.
    const cur = useAppWorkspaceStore.getState()
    const aliased = cur.allFolders.map((f) =>
      f.id === 2
        ? ({
            ...f,
            git_branch: null,
            alias: "feature-x",
          } as unknown as FolderDetail)
        : f
    )
    useAppWorkspaceStore.setState({ folders: aliased, allFolders: aliased })
    render(wtTree(true))

    // Same two-part label a repo header renders: what the worktree IS in front,
    // where it lives on disk bracketed behind it.
    expect(document.body.textContent ?? "").toContain(
      "feature-x [ wt-feature ]"
    )
  })

  it("leaves a worktree with no branch or alias on its bare directory name", () => {
    const cur = useAppWorkspaceStore.getState()
    const bare = cur.allFolders.map((f) =>
      f.id === 2
        ? ({ ...f, git_branch: null, alias: null } as unknown as FolderDetail)
        : f
    )
    useAppWorkspaceStore.setState({ folders: bare, allFolders: bare })
    render(wtTree(true))

    const text = document.body.textContent ?? ""
    expect(text).toContain("wt-feature")
    // No alias to lead with, so no empty brackets trailing the name either.
    expect(text).not.toContain("[ wt-feature ]")
  })

  it("keeps the connector spine continuous through an empty worktree sub-group", () => {
    // Add a second worktree (folder 3) with NO conversations → it renders the
    // empty-folder hint. That empty row must still draw the container spine
    // (ancestor rail) so the vertical connector doesn't break at "no
    // conversations".
    const wtEmpty = {
      ...folder(3, "wt-empty", 1),
      git_branch: "feature-y",
    } as unknown as FolderDetail
    const cur = useAppWorkspaceStore.getState()
    useAppWorkspaceStore.setState({
      folders: [...cur.folders, wtEmpty],
      allFolders: [...cur.allFolders, wtEmpty],
    })
    render(wtTree(true))

    const hint = enMessages.Folder.sidebar.emptyFolderHint
    const hintSpan = Array.from(document.querySelectorAll("span")).find(
      (s) => s.textContent === hint
    )
    expect(hintSpan).toBeTruthy()
    // The empty row (the hint span's row container) carries an ancestor rail.
    const row = hintSpan!.closest("div")
    expect(row?.querySelector("[data-subsession-rail]")).not.toBeNull()
  })

  it("keeps the single-status-event budget (1 card, 0 headers) with worktrees on", () => {
    render(wtTree(true))
    // Initial mount: all three conversations render a card.
    expect(probes.card).toBe(3)

    // Replace exactly the worktree's conversation (conv 21) with a new object;
    // every other summary keeps its identity (mirrors updateConversationLocal).
    const prev = useAppWorkspaceStore.getState().conversations
    const next = prev.slice()
    const idx = next.findIndex((c) => c.id === 21)
    next[idx] = { ...next[idx], status: "completed" }

    probes.card = 0
    probes.folder = 0
    probes.root = 0
    act(() => {
      useAppWorkspaceStore.setState({ conversations: next })
    })
    act(() => wtHarness.rerender())

    // Only the changed card re-renders; the container header AND the root
    // sub-group header (both keyed off `folders`, unchanged by a status event)
    // bail out, so the container split costs nothing extra per event. (The
    // worktree header shares the same memo + folder-derived props, so 0 root/
    // folder re-renders is sufficient evidence it bails too.)
    expect(probes.card).toBe(1)
    expect(probes.folder).toBe(0)
    expect(probes.root).toBe(0)
  })
})

describe("SidebarConversationList — Recent section", () => {
  function recentTree(showRecent: boolean) {
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SidebarConversationList
          showCompleted
          showRecent={showRecent}
          sortMode="created"
        />
      </NextIntlClientProvider>
    )
  }

  const RECENT = enMessages.Folder.sidebar.sectionRecent

  beforeEach(() => {
    probes.card = 0
    const folders = [folder(1, "Repo")]
    store.activeTabId = null
    store.tabSpec = []
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: [
        conv(11, 1),
        // A folderless chat-mode conversation and a conversation whose folder
        // is NOT open — Recent must take the first and drop the second.
        conv(12, 99, { kind: "chat" }),
        conv(13, 42),
      ],
    })
  })

  it("renders nothing for the section when showRecent is off", () => {
    render(recentTree(false))
    expect(document.body.textContent).not.toContain(RECENT)
    // Each conversation renders exactly one card (no Recent duplicates).
    expect(probes.card).toBe(2)
  })

  it("lists folder and chat conversations together, without duplicate React keys", () => {
    // A duplicated key would make React drop one of the two rows and log an
    // error; assert on the console as well as the card count.
    const errors: unknown[][] = []
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args)
      })
    try {
      render(recentTree(true))
      // 2 reachable conversations × (canonical row + Recent row) = 4 cards.
      expect(probes.card).toBe(4)
      expect(errors).toEqual([])
    } finally {
      spy.mockRestore()
    }

    expect(document.body.textContent).toContain(RECENT)
    // conv-13 lives in a folder that is not open, so it is unreachable in the
    // Folders section and must stay out of Recent too.
    expect(document.body.textContent).not.toContain("conv-13")
  })

  it("collapses independently of the other sections", () => {
    render(recentTree(true))
    const header = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === RECENT
    )
    expect(header).toBeTruthy()
    act(() => {
      fireEvent.click(header!)
    })
    // Its rows are gone; the Folders section's copies remain.
    expect(probes.card).toBe(4)
    expect(document.body.textContent).toContain("conv-11")
    expect(
      Array.from(document.querySelectorAll("[data-conversation-id]"))
    ).toHaveLength(2)
  })
})

describe("SidebarConversationList — folder paging", () => {
  const SHOW_MORE = enMessages.Folder.sidebar.showMoreFolder

  beforeEach(() => {
    probes.card = 0
    const folders = [folder(1, "Repo")]
    store.activeTabId = null
    store.tabSpec = []
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: Array.from({ length: 22 }, (_, i) => conv(i + 1, 1)),
    })
  })

  it("shows 10 conversations then another page on each Show more click", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SidebarConversationList showCompleted sortMode="created" />
      </NextIntlClientProvider>
    )

    expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(10)
    const first = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === SHOW_MORE
    )
    expect(first).toBeTruthy()

    act(() => {
      fireEvent.click(first!)
    })
    expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(20)
    const second = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === SHOW_MORE
    )
    expect(second).toBeTruthy()

    act(() => {
      fireEvent.click(second!)
    })
    expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(22)
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent === SHOW_MORE
      )
    ).toBe(false)
  })

  it("resets to the first 10 after the folder is collapsed and reopened", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SidebarConversationList showCompleted sortMode="created" />
      </NextIntlClientProvider>
    )

    const showMore = () =>
      Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === SHOW_MORE
      )

    act(() => {
      fireEvent.click(showMore()!)
    })
    expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(20)

    const header = document.querySelector('[data-folder-id="1"]') as HTMLElement
    act(() => {
      fireEvent.click(header)
    })
    expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(0)

    const reopened = document.querySelector(
      '[data-folder-id="1"]'
    ) as HTMLElement
    act(() => {
      fireEvent.click(reopened)
    })
    expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(10)
    expect(showMore()).toBeTruthy()
  })
})
