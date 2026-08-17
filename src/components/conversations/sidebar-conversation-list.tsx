"use client"

import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Virtualizer, type VirtualizerHandle } from "virtua"
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FolderClosed,
  FolderGit2,
  FolderOpen,
  FolderOpenDot,
  FolderRoot,
  Link2,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Palette,
  Rocket,
  SquarePen,
  Tag,
  XCircle,
} from "lucide-react"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useThemeColor, useZoomLevel } from "@/hooks/use-appearance"
import { useSortedAvailableAgents } from "@/hooks/use-sorted-available-agents"
import { useImeGuard } from "@/hooks/use-ime-guard"
import {
  openImportSessionsWindow,
  openProjectBootWindow,
  updateConversationTitle,
  updateConversationStatus,
  updateConversationPinned,
  updateFolderColor,
  updateFolderAlias,
  updateFolderDefaultAgent,
  deleteConversation,
  listChildConversations,
} from "@/lib/api"
import { isDesktop, revealItemInDir } from "@/lib/platform"
import type {
  AgentType,
  ConversationStatus,
  DbConversationSummary,
  FolderDetail,
} from "@/lib/types"
import { getAgentLabel } from "@/lib/custom-agents"
import {
  loadFolderExpanded,
  saveFolderExpanded,
  loadSectionCollapsed,
  saveSectionCollapsed,
  loadConversationExpanded,
  saveConversationExpanded,
  DEFAULT_SECTION_ORDER,
  type SidebarSectionCollapsed,
  type SidebarSectionKey,
  type SidebarSortMode,
  type SidebarSectionOrder,
} from "@/lib/sidebar-view-mode-storage"
import {
  FOLDER_THEME_COLOR_INHERIT,
  THEME_COLOR_PREVIEW,
  THEME_COLORS,
  normalizeFolderThemeColor,
  type FolderThemeColor,
  type ThemeColor,
} from "@/lib/theme-presets"
import {
  SidebarConversationCard,
  SubsessionAncestorRails,
  CONV_RAIL_DEPTH_STEP,
} from "./sidebar-conversation-card"
import {
  buildOwnerHeaderIndex,
  buildRows,
  computeStickyState,
  flatIndexOfConversation,
  folderHeaderFlatIndices,
  formatRelative,
  groupByFolderWithReuse,
  headerIndexForFolder,
  mergeChildrenById,
  nextHeaderAfter,
  reuseSelected,
  reuseSet,
  selectChatConversationsWithReuse,
  selectPinnedWithReuse,
  selectRecentConversationsWithReuse,
  worktreeChildrenByParent,
  worktreeHeaderAlias,
  type SidebarRow,
} from "./sidebar-conversation-grouping"
import { useSubsessionSync } from "@/hooks/use-subsession-sync"
import { SidebarSectionHeader } from "./sidebar-section-header"
import { ConversationManageDialog } from "./conversation-manage-dialog"
import { CloneDialog } from "@/components/layout/clone-dialog"
import { WorkspaceFolderDialog } from "@/components/layout/workspace-folder-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { FolderAliasLabel } from "./folder-alias-label"
import { toErrorMessage } from "@/lib/app-error"

// Layout effect on the client (so the sticky overlay is positioned before
// paint) but a no-op-safe passive effect during the static-export prerender.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect

// Shared empty merge map used when "Show worktrees" is on: worktree children
// then keep their own conversation bucket / count / theme instead of being
// folded into the parent. A module constant so the reference is stable across
// renders (the `byFolder` / `folderTotalCounts` memos depend on it).
const EMPTY_CHILD_TO_PARENT: ReadonlyMap<number, number> = new Map()

// Shared empty container map used when "Show worktrees" is off: no repo is a
// worktree container, so every folder renders flat. Stable reference so the
// `containerChildren` memo (and buildRows through it) doesn't churn.
const EMPTY_CONTAINER_CHILDREN: ReadonlyMap<number, readonly number[]> =
  new Map()

// How many conversations the "Recent" section shows before its "show more" row,
// and how many each click adds. Recent deliberately re-lists what the Folders /
// Chat sections already show, so an unbounded one pushes every section below it
// off the screen — a page keeps it a glance-able "where was I" list.
const RECENT_PAGE_SIZE = 15

// How many conversations a folder body shows before its "show more" row, and
// how many each click adds. Codex-style paging so a busy folder does not
// bury every sibling below it; per-folder so expanding one does not page
// the others.
const FOLDER_PAGE_SIZE = 10

// Trackpad taps on WebKit report as pointerType "mouse", fire pointerdown,
// then synthesize a delayed `click` after this header remounts (virtua
// recycle / overlay flip). A per-instance ref dies with that remount, so the
// leftover click would toggle the folder a second time. Module-level so it
// outlives the node.
let lastPointerToggleFolderId = Number.NaN
let lastPointerToggleAt = 0
const POINTER_TOGGLE_GUARD_MS = 400

function rememberPointerToggle(folderId: number) {
  lastPointerToggleFolderId = folderId
  lastPointerToggleAt = Date.now()
}

function wasRecentPointerToggle(folderId: number) {
  return (
    folderId === lastPointerToggleFolderId &&
    Date.now() - lastPointerToggleAt < POINTER_TOGGLE_GUARD_MS
  )
}

/** Test-only: fake timers reuse one `Date.now()`, so a leftover guard would
 *  swallow the next test's `click`. */
export function resetFolderPointerToggleGuardForTests() {
  lastPointerToggleFolderId = Number.NaN
  lastPointerToggleAt = 0
}

const FolderHeader = memo(function FolderHeader({
  folderId,
  folderName,
  folderAlias,
  folderPath,
  runningCount,
  expanded,
  themeColor,
  appThemeColor,
  currentDefaultAgent,
  availableAgents,
  availableAgentsFresh,
  onToggle,
  onRemoveFromWorkspace,
  onNewConversation,
  onImport,
  onManageConversations,
  onManageLinks,
  onChangeColor,
  onSetAlias,
  onSetDefaultAgent,
  onOpenInSystemExplorer,
  onOpenInTerminal,
  suppressed = false,
  depth = 0,
  variant = "repo",
  worktreeBranch = null,
}: {
  folderId: number
  folderName: string
  /** User-set alias, or null. When present the header shows `alias [name]`. */
  folderAlias: string | null
  folderPath: string
  /**
   * How many of this group's sessions are currently RUNNING (`in_progress`) —
   * not how many it holds. Zero renders no badge at all: the header's job is to
   * flag live activity you'd otherwise have to expand the folder to notice, and
   * a total-count chip on every row was noise (expanding shows the rows).
   */
  runningCount: number
  expanded: boolean
  themeColor: FolderThemeColor
  appThemeColor: ThemeColor
  currentDefaultAgent: AgentType | null
  availableAgents: AgentType[]
  /**
   * False while `useSortedAvailableAgents` is still serving the
   * localStorage seed (i.e. `acpListAgents()` has not yet succeeded this
   * session). The "Set default agent" submenu disables agent selection
   * while not fresh — otherwise the user could persist a folder default
   * pointing at a stale/uninstalled agent. The "No default" option stays
   * usable since clearing a default doesn't depend on the live list.
   */
  availableAgentsFresh: boolean
  onToggle: (folderId: number) => void
  onRemoveFromWorkspace: (folderId: number) => void
  onNewConversation: (folderId: number) => void
  onImport: (folderId: number) => void
  onManageConversations: (folderId: number) => void
  onManageLinks: (folderId: number) => void
  onChangeColor: (folderId: number, color: FolderThemeColor) => void
  onSetAlias: (folderId: number, alias: string | null) => void
  onSetDefaultAgent: (folderId: number, agentType: AgentType | null) => void
  onOpenInSystemExplorer: (folderId: number) => void
  onOpenInTerminal: (folderId: number) => void
  /**
   * True for the in-list copy of the folder whose floating sticky overlay is
   * currently showing. The overlay is the accessible control (`aria-hidden` +
   * `tabIndex={-1}` on this copy) so AT does not announce the folder twice
   * while virtua still keeps the in-list row mounted in its buffer.
   *
   * Do NOT use `inert` here: a header that is only a few pixels into the
   * viewport is still visible and clickable, and `inert` makes that press a
   * no-op — the "first click does nothing, second click works" gesture.
   */
  suppressed?: boolean
  /**
   * Nesting depth of the header row. 0 for a top-level repo / plain folder / repo
   * container; 1 for a worktree or "root" sub-group shown under its container
   * when "Show worktrees" is on. Drives the left indent and the connector-spine
   * ancestor rails (a pure function of this number), mirroring the conversation
   * card's per-level rail step.
   */
  depth?: number
  /**
   * Which glyph + label this header renders:
   * - `repo` (default): a top-level repo / plain folder / repo container — the
   *   FolderOpen/FolderClosed glyph and the repo-name alias label.
   * - `worktree`: a git worktree sub-group — the FolderGit2 glyph and the same
   *   `alias [ name ]` label as a repo, with the branch standing in for the
   *   alias (see {@link worktreeHeaderAlias}).
   * - `root`: a repo container's own-sessions sub-group — the FolderRoot glyph
   *   and a fixed, non-localized "root" label.
   */
  variant?: "repo" | "worktree" | "root"
  /** The worktree's branch name (its own `git_branch`), used as the alias when
   *  none is set. Leaves the bare folder name when absent. */
  worktreeBranch?: string | null
}) {
  // Own the translations here rather than receiving `t` as a prop: next-intl
  // returns a fresh `t` on every parent render, so passing it down would defeat
  // this component's memo and re-render every header on each status event.
  const t = useTranslations("Folder.sidebar")
  const ime = useImeGuard()
  // Only flag a stale default once the live list is known; before fresh,
  // `availableAgents` is the localStorage seed and may legitimately omit a
  // newly-enabled agent.
  const showStaleDefault =
    availableAgentsFresh &&
    currentDefaultAgent !== null &&
    !availableAgents.includes(currentDefaultAgent)
  const tFileTree = useTranslations("Folder.fileTreeTab")
  const systemExplorerLabel =
    typeof navigator === "undefined"
      ? tFileTree("openInFileManager")
      : (() => {
          const platform =
            `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
          if (platform.includes("mac")) return tFileTree("openInFinder")
          if (platform.includes("win")) return tFileTree("openInExplorer")
          return tFileTree("openInFileManager")
        })()
  // `revealItemInDir` only works inside Tauri; in web mode it is a no-op,
  // so disable the entry there to avoid silent failures.
  const isDesktopMode = isDesktop()

  // Alias dialog: controlled Dialog rendered as a sibling of the ContextMenu so
  // it survives the menu closing on select (mirrors the conversation card's
  // rename dialog). Seeded from the current alias on open.
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false)
  const [aliasValue, setAliasValue] = useState("")
  const openAliasDialog = useCallback(() => {
    setAliasValue(folderAlias ?? "")
    setAliasDialogOpen(true)
  }, [folderAlias])
  const confirmAlias = useCallback(() => {
    // Empty / whitespace clears the alias (null); the backend re-normalizes too.
    const trimmed = aliasValue.trim()
    onSetAlias(folderId, trimmed ? trimmed : null)
    setAliasDialogOpen(false)
  }, [aliasValue, folderId, onSetAlias])

  const handleTogglePointerDown = (event: React.PointerEvent) => {
    if (event.button) return
    // Toggle on press — a trackpad tap on WebKit often remounts this button
    // (virtua / sticky overlay) before `click`, so waiting for `click` drops
    // the first tap. Mouse `click` is sync and would be fine either way.
    rememberPointerToggle(folderId)
    event.preventDefault()
    event.stopPropagation()
    onToggle(folderId)
  }
  const handleToggleClick = () => {
    // Trackpad still synthesizes a delayed `click` after pointerdown, and
    // preventDefault does not cancel it in WebKit. The guard is module-level
    // so it survives the remount that wipes a per-instance ref — without it
    // the leftover click flips the folder back (first tap looks like a no-op).
    if (wasRecentPointerToggle(folderId)) return
    onToggle(folderId)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            aria-hidden={suppressed || undefined}
            className="relative h-[2rem]"
          >
            <div
              className={cn(
                "group flex h-[1.9375rem] w-full items-center",
                "rounded-full",
                "transition-colors duration-150",
                "hover:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_2%)]"
              )}
            >
              <button
                type="button"
                data-folder-id={folderId}
                tabIndex={suppressed ? -1 : undefined}
                onPointerDown={handleTogglePointerDown}
                onClick={handleToggleClick}
                title={folderPath}
                aria-expanded={expanded}
                className={cn(
                  "relative flex h-full min-w-0 flex-1 items-center pr-[0.5rem] outline-none",
                  "rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "text-sidebar-foreground cursor-pointer"
                )}
                style={{
                  paddingLeft: `calc(var(--conv-rail-axis) + 0.875rem + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
                }}
              >
                {/* Connector spine (Show worktrees): a depth-1 sub-group header
                    draws its container's vertical rail at the depth-0 axis, so
                    stacked across the container's children (root + worktree
                    headers and their session cards) it forms one continuous line
                    down from the container. Renders nothing at depth 0. */}
                <SubsessionAncestorRails depth={depth} />
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute flex items-center justify-center text-muted-foreground/75"
                  )}
                  style={{
                    top: "50%",
                    left: `calc(var(--conv-rail-axis) + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
                    width: "0.875rem",
                    height: "0.875rem",
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {variant === "worktree" ? (
                    <FolderGit2 className="h-[0.875rem] w-[0.875rem]" />
                  ) : variant === "root" ? (
                    <FolderRoot className="h-[0.875rem] w-[0.875rem]" />
                  ) : expanded ? (
                    <FolderOpen className="h-[0.875rem] w-[0.875rem]" />
                  ) : (
                    <FolderClosed className="h-[0.875rem] w-[0.875rem]" />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-[0.5rem]">
                  <span
                    className={cn(
                      "min-w-0 flex-shrink truncate text-left text-[0.875rem] font-normal text-sidebar-foreground/75"
                    )}
                  >
                    {variant === "worktree" ? (
                      // Branch as the alias, directory as the name — the same
                      // two-part label a repo header renders.
                      <FolderAliasLabel
                        name={folderName}
                        alias={worktreeHeaderAlias(folderAlias, worktreeBranch)}
                        bracketClassName="text-sidebar-foreground"
                      />
                    ) : variant === "root" ? (
                      // The container repo's own-sessions sub-group is labeled
                      // with a fixed, non-localized "root" (its glyph is
                      // FolderRoot); it stands for the repo root regardless of UI
                      // language.
                      "root"
                    ) : (
                      <FolderAliasLabel
                        name={folderName}
                        alias={folderAlias}
                        bracketClassName="text-sidebar-foreground"
                      />
                    )}
                  </span>
                  {/* Live-activity badge: the number of RUNNING sessions in this
                      group, and nothing at all when none are. Amber (not the
                      primary tint the old total-count chip used) is the same
                      "running" semantic the conversation cards spin in amber, so
                      the two read as one signal. amber-700 (not the card's
                      amber-600) carries the light-mode fill: at 0.625rem this is
                      small text, and amber-600 on the tinted surface lands near
                      3:1 — under the AA floor amber-700 (~4.7:1) clears. */}
                  {runningCount > 0 && (
                    <span
                      title={t("runningCountBadge", { count: runningCount })}
                      className={cn(
                        "inline-flex shrink-0 items-center justify-center",
                        "h-[0.9375rem] min-w-[1rem] rounded-[0.3125rem] px-[0.25rem]",
                        "text-[0.625rem] font-semibold leading-none tabular-nums",
                        "bg-amber-500/12 text-amber-700",
                        "dark:bg-amber-400/15 dark:text-amber-300"
                      )}
                    >
                      <span aria-hidden>{runningCount}</span>
                      <span className="sr-only">
                        {t("runningCountBadge", { count: runningCount })}
                      </span>
                    </span>
                  )}
                  {/* Disclosure chevron mirrors the section headers: hover-revealed,
                    rotates on expand. The persistent open/closed state still reads
                    from the folder icon on the left, which is why the chevron can
                    stay hidden at rest in BOTH states (collapsed included) — it is
                    a redundant affordance, not the only one. Touch keeps it pinned
                    on, since there is no hover to reveal it there.
                    NOTE: `group-focus-within` (not `group-focus-visible` like the
                    section header) is intentional — here the `group` is the outer
                    row wrapper and focus lands on a child (the toggle button or the
                    sibling ⋯ menu button), so the reveal must react to focus
                    anywhere inside the row. The section header's `group` IS its
                    button, so it uses `group-focus-visible`. Don't "normalize". */}
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground/60",
                      "transition-[transform,opacity] duration-200 ease-out",
                      "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                      "[@media(hover:none)]:opacity-100",
                      expanded && "rotate-90"
                    )}
                  />
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  // Re-open the SAME context menu as right-click (single source of
                  // truth — the menu has 3 submenus, duplicating it would drift).
                  // Dispatch a synthetic contextmenu event from this button; it
                  // bubbles to the enclosing <ContextMenuTrigger>, which Radix opens
                  // at the given coords — anchored just under the button.
                  const rect = e.currentTarget.getBoundingClientRect()
                  e.currentTarget.dispatchEvent(
                    new MouseEvent("contextmenu", {
                      bubbles: true,
                      cancelable: true,
                      button: 2,
                      clientX: rect.left,
                      clientY: rect.bottom,
                    })
                  )
                }}
                title={t("moreOptions")}
                aria-label={t("moreOptions")}
                aria-haspopup="menu"
                tabIndex={suppressed ? -1 : undefined}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-end",
                  // Shares the card action-icon palette: default /90 is the lightest
                  // muted shade clearing 3:1 non-text contrast (incl. on touch, where
                  // this stays visible); hover deepens to full foreground.
                  "rounded-[0.375rem] cursor-pointer outline-none text-muted-foreground/90",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                  "transition-[opacity,color] duration-150 hover:text-sidebar-foreground"
                )}
              >
                <MoreHorizontal className="h-[0.875rem] w-[0.875rem]" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onNewConversation(folderId)
                }}
                title={t("newConversation")}
                aria-label={t("newConversation")}
                tabIndex={suppressed ? -1 : undefined}
                className={cn(
                  // Mirrors the ⋯ button's action-icon palette and hover-reveal so
                  // the two read as one trailing control cluster. As the rightmost
                  // control it carries the right-edge margin that lines this cluster
                  // up with the other sidebar affordances: 0.375rem + the list's
                  // px-1.5 (0.375rem) = a uniform 0.75rem inset from the border,
                  // matching the section-header actions and conversation-card badges.
                  // h-6 (not h-7) keeps every action-icon centre on the same axis, and
                  // justify-end flushes the glyph to that 0.75rem edge so the visible
                  // icon — not the transparent button box — lines up with the badges.
                  "mr-[0.375rem] flex h-6 w-6 shrink-0 items-center justify-end",
                  "rounded-[0.375rem] cursor-pointer outline-none text-muted-foreground/90",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                  "transition-[opacity,color] duration-150 hover:text-sidebar-foreground"
                )}
              >
                <SquarePen className="h-[0.875rem] w-[0.875rem]" />
              </button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onNewConversation(folderId)}>
            <SquarePen className="h-4 w-4" />
            {t("newConversation")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onImport(folderId)}>
            <Download className="h-4 w-4" />
            {t("importLocalSessions")}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExternalLink className="h-4 w-4" />
              {tFileTree("openIn")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                disabled={!isDesktopMode}
                onSelect={() => onOpenInSystemExplorer(folderId)}
              >
                {systemExplorerLabel}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onOpenInTerminal(folderId)}>
                {tFileTree("openInTerminal")}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onManageConversations(folderId)}>
            <ListChecks className="h-4 w-4" />
            {t("folderHeaderMenu.manageConversations")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onManageLinks(folderId)}>
            <Link2 className="h-4 w-4" />
            {t("folderHeaderMenu.manageLinks")}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Bot className="h-4 w-4" />
              {t("folderHeaderMenu.setDefaultAgent")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[12rem]">
              <ContextMenuItem
                onSelect={() => onSetDefaultAgent(folderId, null)}
                className="gap-2"
              >
                <span className="min-w-0 flex-1 truncate">
                  {t("folderHeaderMenu.defaultAgentNone")}
                </span>
                {currentDefaultAgent === null ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : null}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {availableAgentsFresh ? (
                <>
                  {availableAgents.map((agent) => {
                    const active = currentDefaultAgent === agent
                    return (
                      <ContextMenuItem
                        key={agent}
                        onSelect={() => onSetDefaultAgent(folderId, agent)}
                        className="gap-2"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {getAgentLabel(agent)}
                        </span>
                        {active ? (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        ) : null}
                      </ContextMenuItem>
                    )
                  })}
                  {showStaleDefault && currentDefaultAgent !== null ? (
                    <ContextMenuItem
                      key={currentDefaultAgent}
                      disabled
                      className="gap-2 opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {`${getAgentLabel(currentDefaultAgent)} ${t("folderHeaderMenu.agentUnavailableSuffix")}`}
                      </span>
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    </ContextMenuItem>
                  ) : null}
                </>
              ) : (
                <ContextMenuItem disabled className="gap-2 opacity-60">
                  <span className="min-w-0 flex-1 truncate">
                    {t("folderHeaderMenu.loadingAgents")}
                  </span>
                </ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Palette className="h-4 w-4" />
              {t("folderHeaderMenu.changeColor")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[12rem] p-2">
              <ContextMenuItem
                onSelect={() =>
                  onChangeColor(folderId, FOLDER_THEME_COLOR_INHERIT)
                }
                className="gap-2"
              >
                <span
                  aria-hidden
                  className="h-[1.125rem] w-[1.125rem] shrink-0 rounded-[0.25rem] border border-border"
                  style={{
                    backgroundColor: THEME_COLOR_PREVIEW[appThemeColor],
                  }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {t("folderHeaderMenu.useThemeColor")}
                </span>
                {themeColor === FOLDER_THEME_COLOR_INHERIT ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : null}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <div className="grid grid-cols-6 gap-1">
                {THEME_COLORS.map((color) => {
                  const active = color === themeColor
                  return (
                    <button
                      key={color}
                      type="button"
                      title={color}
                      aria-label={color}
                      onClick={() => onChangeColor(folderId, color)}
                      className={cn(
                        "h-[1.125rem] w-[1.125rem] cursor-pointer rounded-[0.25rem]",
                        "outline-none ring-offset-1 ring-offset-popover",
                        "transition-[box-shadow,transform] duration-100 hover:scale-110",
                        active && "ring-2 ring-foreground/60"
                      )}
                      style={{ backgroundColor: THEME_COLOR_PREVIEW[color] }}
                    />
                  )
                })}
              </div>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={openAliasDialog}>
            <Tag className="h-4 w-4" />
            {t("folderHeaderMenu.setAlias")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => onRemoveFromWorkspace(folderId)}
          >
            <XCircle className="h-4 w-4" />
            {t("folderHeaderMenu.removeFromWorkspace")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={aliasDialogOpen} onOpenChange={setAliasDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("folderHeaderMenu.setAliasTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={aliasValue}
            onChange={(e) => setAliasValue(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return
              if (e.key === "Enter") confirmAlias()
            }}
            placeholder={t("folderHeaderMenu.setAliasPlaceholder")}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAliasDialogOpen(false)}>
              {t("folderHeaderMenu.setAliasCancel")}
            </Button>
            <Button onClick={confirmAlias}>
              {t("folderHeaderMenu.setAliasSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})

export interface SidebarConversationListHandle {
  scrollToActive: () => void
  expandAll: () => void
  collapseAll: () => void
}

export interface SidebarConversationListProps {
  showCompleted?: boolean
  sortMode?: SidebarSortMode
  sectionOrder?: SidebarSectionOrder
  /** When on, each repo's worktree child folders render as indented sub-groups
   *  instead of being merged flat into the parent group. Defaults to off. */
  showWorktrees?: boolean
  /** When on, the flat "Recent" section is rendered at its slot in
   *  `sectionOrder`. Defaults to off here; the Sidebar passes the user's
   *  preference, whose product default is ON. */
  showRecent?: boolean
}

export function SidebarConversationList({
  ref,
  showCompleted = true,
  sortMode = "created",
  sectionOrder = DEFAULT_SECTION_ORDER,
  showWorktrees = false,
  showRecent = false,
}: SidebarConversationListProps & {
  ref?: Ref<SidebarConversationListHandle>
}) {
  const t = useTranslations("Folder.sidebar")
  const tCommon = useTranslations("Folder.common")
  const tFolderDropdown = useTranslations("Folder.folderNameDropdown")
  const tFileTree = useTranslations("Folder.fileTreeTab")
  const { resolvedTheme } = useTheme()
  const { themeColor: appThemeColor } = useThemeColor()
  const { createTerminalInDirectory } = useTerminalContext()
  useZoomLevel()
  const folders = useAppWorkspaceStore((s) => s.folders)
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  const conversations = useAppWorkspaceStore((s) => s.conversations)
  const loading = useAppWorkspaceStore((s) => s.conversationsLoading)
  const error = useAppWorkspaceStore((s) => s.conversationsError)
  const refreshConversations = useAppWorkspaceStore(
    (s) => s.refreshConversations
  )
  const updateConversationLocal = useAppWorkspaceStore(
    (s) => s.updateConversationLocal
  )
  const removeFolderFromWorkspace = useAppWorkspaceStore(
    (s) => s.removeFolderFromWorkspace
  )
  const refreshFolder = useAppWorkspaceStore((s) => s.refreshFolder)
  const refreshing = loading
  const { activeFolder } = useActiveFolder()

  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const {
    openTab,
    closeConversationTab,
    closeTabsByFolder,
    openNewConversationTab,
    openChatModeTab,
  } = useTabActions()
  const { openConversations } = useWorkbenchRoute()

  const folderIndex = useMemo(() => {
    const map = new Map<
      number,
      {
        name: string
        alias: string | null
        path: string
        color: string
        defaultAgentType: AgentType | null
        gitBranch: string | null
      }
    >()
    for (const f of allFolders)
      map.set(f.id, {
        name: f.name,
        alias: f.alias,
        path: f.path,
        color: f.color,
        defaultAgentType: f.default_agent_type,
        gitBranch: f.git_branch,
      })
    return map
  }, [allFolders])

  // `tabs` gets a fresh array reference on every `conversations` change (the tab
  // context re-derives titles/status), so these two derivations would otherwise
  // hand a new object / Set to every FolderGroupItem on each status event and
  // defeat its memo. Reuse the previous reference when the content is unchanged
  // (render-phase ref cache; idempotent under StrictMode's double invoke).
  const selectedConvRef = useRef<{ id: number; agentType: string } | null>(null)
  const selectedConversation = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const next =
      !activeTab || activeTab.conversationId == null
        ? null
        : { id: activeTab.conversationId, agentType: activeTab.agentType }
    const reused = reuseSelected(selectedConvRef.current, next)
    selectedConvRef.current = reused
    return reused
  }, [tabs, activeTabId])

  const openTabKeysRef = useRef<Set<string>>(new Set())
  const openTabKeys = useMemo(() => {
    const next = new Set<string>()
    for (const tab of tabs) {
      if (tab.conversationId != null) {
        next.add(`${tab.agentType}:${tab.conversationId}`)
      }
    }
    const reused = reuseSet(openTabKeysRef.current, next)
    openTabKeysRef.current = reused
    return reused
  }, [tabs])

  const { sortedTypes: availableAgents, fresh: availableAgentsFresh } =
    useSortedAvailableAgents()
  const [folderExpanded, setFolderExpanded] = useState<Record<number, boolean>>(
    {}
  )
  // Mirror used by the stable `toggleFolder` callback. It is refreshed from
  // rendered state here and advanced synchronously by the callback so a second
  // click can see the first click's pending intent.
  const folderExpandedRef = useRef(folderExpanded)
  folderExpandedRef.current = folderExpanded
  // Repo ids whose "root" sub-group (a container repo's own sessions, shown only
  // under "Show worktrees") is collapsed. Session-only, not persisted: the
  // container's own collapse — which hides the whole subtree — IS persisted via
  // `folderExpanded`, so this indented sub-toggle is kept deliberately
  // lightweight. Default (absent) = expanded.
  const [rootGroupCollapsed, setRootGroupCollapsed] = useState<Set<number>>(
    () => new Set()
  )
  // Collapsed state of the two top-level sections ("Pinned", "Folders"). Absent
  // key = expanded (default). Hydrated from localStorage after mount.
  const [sectionCollapsed, setSectionCollapsed] =
    useState<SidebarSectionCollapsed>({})
  const pinnedExpanded = !sectionCollapsed.pinned
  const foldersExpanded = !sectionCollapsed.folders
  const chatsExpanded = !sectionCollapsed.chats
  const recentExpanded = !sectionCollapsed.recent
  // How many Recent rows are currently revealed. Session-only (not persisted):
  // "show me more of this list right now" is a reading gesture, not a setting —
  // and a fresh sidebar should open short again.
  const [recentLimit, setRecentLimit] = useState(RECENT_PAGE_SIZE)
  const revealMoreRecent = useCallback(
    () => setRecentLimit((n) => n + RECENT_PAGE_SIZE),
    []
  )
  // Per-folder revealed count. Session-only, same reason as `recentLimit`:
  // "show me more of this folder right now" is a reading gesture. Absent key
  // = the default page size.
  const [folderLimitById, setFolderLimitById] = useState<
    Record<number, number>
  >({})
  const revealMoreFolder = useCallback((folderId: number) => {
    setFolderLimitById((prev) => ({
      ...prev,
      [folderId]: (prev[folderId] ?? FOLDER_PAGE_SIZE) + FOLDER_PAGE_SIZE,
    }))
  }, [])
  // ── Per-conversation delegation sub-session expansion ───────────────────
  // Default COLLAPSED (unlike folders): only ids the user opened are tracked
  // and persisted. Hydrated from localStorage after mount. `childrenByParent`
  // is the lazily-fetched child cache (key absent = not fetched → renders a
  // loading row; empty array = no live children → renders nothing, self-heals
  // on the next refresh). The ref mirror lets the lazy-fetch dedupe read the
  // latest cache without re-creating its callback.
  const [conversationExpanded, setConversationExpanded] = useState<Set<number>>(
    () => new Set()
  )
  const [childrenByParent, setChildrenByParent] = useState<
    Map<number, DbConversationSummary[]>
  >(() => new Map())
  const childrenByParentRef = useRef(childrenByParent)
  childrenByParentRef.current = childrenByParent
  const childrenInFlightRef = useRef<Set<number>>(new Set())
  // In-flight parent fetches → drives the loading spinner. A placeholder empty
  // array is written into `childrenByParent` before the fetch so concurrent child
  // upserts buffer into it (closing the lost-update race); `childrenLoading` then
  // distinguishes "still fetching" from a settled-empty (stale-count) subtree.
  const [childrenLoading, setChildrenLoading] = useState<Set<number>>(
    () => new Set()
  )
  // Tombstones for soft-deleted child ids (FIFO-bounded in the sync hook) so a
  // stale fetch snapshot or out-of-order upsert can't resurrect a deleted child —
  // the child-cache analog of the context's root deletion guard.
  const deletedChildIdsRef = useRef<Set<number>>(new Set())

  // Keep the lazily-loaded sub-session cache live in real time: route child
  // upsert/status/deleted events into `childrenByParent` (roots stay with the
  // AppWorkspace context). child_count converges via backend parent re-emits.
  useSubsessionSync({ setChildrenByParent, deletedChildIdsRef })
  const [removeConfirm, setRemoveConfirm] = useState<{
    folderId: number
    folderName: string
  } | null>(null)
  // Folder the "manage conversations" dialog opens on — its initial scope; the
  // dialog itself can then widen to the workspace or point at another folder.
  const [manageFolderId, setManageFolderId] = useState<number | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  // Folder whose links are being managed (context menu -> Linked folders).
  const [linksFolder, setLinksFolder] = useState<FolderDetail | null>(null)

  // Floating sticky folder header. `stickyFolderId` is the ONLY new render
  // state and changes solely when the scroll crosses into a different folder —
  // never on a status event or the per-minute `now` tick — so the card/header
  // memo budget is untouched. The per-frame handoff translateY is written
  // straight to the overlay node (no re-render); see `recomputeSticky`.
  const [stickyFolderId, setStickyFolderId] = useState<number | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const stickyRafRef = useRef<number | null>(null)

  useEffect(() => {
    // Hydrate from localStorage after mount to keep SSR/CSR markup consistent.

    setFolderExpanded(loadFolderExpanded())
    setSectionCollapsed(loadSectionCollapsed())
    setConversationExpanded(new Set(loadConversationExpanded()))
  }, [])

  const toggleSection = useCallback((section: SidebarSectionKey) => {
    setSectionCollapsed((prev) => {
      const next = { ...prev, [section]: !prev[section] }
      saveSectionCollapsed(next)
      return next
    })
  }, [])

  const handleChangeFolderColor = useCallback(
    async (folderId: number, color: FolderThemeColor) => {
      try {
        await updateFolderColor(folderId, color)
        await refreshFolder(folderId)
      } catch (err) {
        const msg = toErrorMessage(err)
        toast.error(t("toasts.changeFolderColorFailed", { message: msg }))
      }
    },
    [refreshFolder, t]
  )

  const handleSetFolderAlias = useCallback(
    async (folderId: number, alias: string | null) => {
      try {
        await updateFolderAlias(folderId, alias)
        await refreshFolder(folderId)
      } catch (err) {
        const msg = toErrorMessage(err)
        toast.error(t("toasts.setFolderAliasFailed", { message: msg }))
      }
    },
    [refreshFolder, t]
  )

  const handleChangeFolderDefaultAgent = useCallback(
    async (folderId: number, agentType: AgentType | null) => {
      try {
        await updateFolderDefaultAgent(folderId, agentType)
        await refreshFolder(folderId)
      } catch (err) {
        const msg = toErrorMessage(err)
        toast.error(
          t("toasts.changeFolderDefaultAgentFailed", { message: msg })
        )
      }
    },
    [refreshFolder, t]
  )

  const handleOpenFolderInSystemExplorer = useCallback(
    (folderId: number) => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      void revealItemInDir(folder.path).catch(() => {
        toast.error(tFileTree("toasts.openDirectoryFailed"))
      })
    },
    [folderIndex, tFileTree]
  )

  const handleOpenFolderInTerminal = useCallback(
    async (folderId: number) => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      const title = tFileTree("terminalTitle", { name: folder.name })
      const id = await createTerminalInDirectory(folder.path, title)
      if (!id) {
        toast.error(tFileTree("toasts.openBuiltinTerminalFailed"))
      }
    },
    [folderIndex, createTerminalInDirectory, tFileTree]
  )

  // virtua binds to the real OverlayScrollbars viewport element (surfaced via
  // the ScrollArea `onViewportRef` bridge once OS has initialized). We keep both
  // a ref (for the Virtualizer `scrollRef` prop) and a state flag so the
  // Virtualizer only mounts after the viewport exists.
  const viewportRef = useRef<HTMLElement | null>(null)
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null)
  const handleViewportRef = useCallback((element: HTMLElement | null) => {
    viewportRef.current = element
    setViewportEl(element)
  }, [])
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const scrollToActiveRef = useRef<() => void>(() => {})
  const pendingScrollRef = useRef(false)

  // Single "now" shared by every relative time label, refreshed once a minute.
  // Threading one value through all rows (instead of each row calling
  // `Date.now()` during render) keeps `timeLabel` referentially stable within a
  // render tick, so a single status event re-renders only the affected card.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  // Folder grouping source: pinned conversations are surfaced in the dedicated
  // Pinned section, and folderless chat conversations in the dedicated Chat
  // section, so exclude both here; then apply the completed filter as before.
  const folderConversations = useMemo(() => {
    const base = conversations.filter(
      (c) => c.pinned_at == null && c.kind !== "chat"
    )
    if (showCompleted) return base
    return base.filter((c) => c.status !== "completed")
  }, [conversations, showCompleted])

  // Flat "Chat" bucket: folderless chat-mode conversations, most-recently-updated
  // first, with reference reuse (so an unrelated status event doesn't rebuild it
  // and defeat the section's memo). Pinned chats live in the Pinned section.
  const chatConvsRef = useRef<DbConversationSummary[]>([])
  const chatConversations = useMemo(() => {
    const next = selectChatConversationsWithReuse(
      conversations,
      showCompleted,
      chatConvsRef.current
    )
    chatConvsRef.current = next
    return next
  }, [conversations, showCompleted])

  // Pinned bucket: the FULL conversation list (ignores "Show completed" — a
  // pinned conversation stays visible regardless), sorted most-recently-pinned
  // first, with reference reuse so an unrelated status event doesn't rebuild it.
  const pinnedRef = useRef<DbConversationSummary[]>([])
  const pinned = useMemo(() => {
    const next = selectPinnedWithReuse(conversations, pinnedRef.current)
    pinnedRef.current = next
    return next
  }, [conversations])

  // Every folder currently open in the workspace (repos and their worktree
  // children alike). Depends only on `folders`, so status events never rebuild
  // it — the Recent bucket below leans on that.
  const openFolderIds = useMemo(
    () => new Set(folders.map((f) => f.id)),
    [folders]
  )

  // Flat "Recent" bucket: every reachable conversation — folder-bound and chat
  // alike — newest first, gated on the folder still being open so closing a
  // folder also removes its sessions here. Reference reuse keeps an unrelated
  // status event from rebuilding it and defeating the section's card memos.
  const recentConvsRef = useRef<DbConversationSummary[]>([])
  const recentConversations = useMemo(() => {
    const next = selectRecentConversationsWithReuse(
      conversations,
      showCompleted,
      sortMode,
      openFolderIds,
      recentConvsRef.current
    )
    recentConvsRef.current = next
    return next
  }, [conversations, showCompleted, sortMode, openFolderIds])

  // Maps each open worktree child folder → its (open) root folder. A child is
  // only redirected when its parent is also open, so a worktree whose root was
  // closed/removed falls back to standing on its own (its conversations stay
  // reachable). The merge is display-only: it never rewrites `conversation.folder_id`.
  const childToParent = useMemo(() => {
    const map = new Map<number, number>()
    for (const f of folders) {
      if (f.parent_id != null && openFolderIds.has(f.parent_id)) {
        map.set(f.id, f.parent_id)
      }
    }
    return map
  }, [folders, openFolderIds])

  // The merge map used for DISPLAY (grouping, counts, theming). When "Show
  // worktrees" is on it is empty, so each worktree child keeps its own bucket /
  // count / theme and renders under its own header. The raw `childToParent`
  // above is still used to know which folders ARE worktree children (nesting
  // order, indent). Off → identical to the historical behavior.
  const displayChildToParent = useMemo(
    () => (showWorktrees ? EMPTY_CHILD_TO_PARENT : childToParent),
    [showWorktrees, childToParent]
  )

  // Hold the previous grouping so unchanged folders keep their bucket array
  // reference across renders (lets memoized FolderGroupItems bail out). Updating
  // the ref inside the memo factory is a deliberate cache, idempotent under
  // StrictMode's double invoke.
  const byFolderRef = useRef<Map<number, DbConversationSummary[]>>(new Map())
  const byFolder = useMemo(() => {
    const grouped = groupByFolderWithReuse(
      folderConversations,
      sortMode,
      byFolderRef.current,
      displayChildToParent
    )
    byFolderRef.current = grouped
    return grouped
  }, [folderConversations, sortMode, displayChildToParent])

  // Counts the unfiltered-but-non-pinned conversations per display group, so the
  // empty-hint renderer distinguishes a truly empty folder from one whose rows
  // are merely hidden by the completed filter. Pinned conversations are excluded
  // (they're not in this folder's bucket), matching `byFolder`.
  const folderTotalCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const conv of conversations) {
      if (conv.pinned_at != null) continue
      const groupId = displayChildToParent.get(conv.folder_id) ?? conv.folder_id
      map.set(groupId, (map.get(groupId) ?? 0) + 1)
    }
    return map
  }, [conversations, displayChildToParent])

  // Running (`in_progress`) sessions per display group — what the folder header
  // badge shows. Counted off the FULL conversation list rather than `byFolder`
  // on purpose: the badge answers "is there work running in here", so neither
  // the "Show completed" filter nor a session being pinned into the Pinned
  // section should be able to hide it. Deliberately NOT a `buildRows` input, so
  // a status event never rebuilds the row model — it only changes one number on
  // one memoized header.
  const folderRunningCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const conv of conversations) {
      if (conv.status !== "in_progress") continue
      const groupId = displayChildToParent.get(conv.folder_id) ?? conv.folder_id
      map.set(groupId, (map.get(groupId) ?? 0) + 1)
    }
    return map
  }, [conversations, displayChildToParent])

  // The top-level folder sequence: worktree child folders are excluded (they
  // follow their parent). When "Show worktrees" is off this is ALSO the display
  // order; when on, `buildRows` nests each repo's worktree children back in.
  // Hidden chat folders never reach this list — the backend already excludes
  // them from the open-folder set (`folder_service::list_open_folder_details`).
  const reorderableFolderIds = useMemo(() => {
    const seen = new Set<number>()
    const ids: number[] = []
    for (const f of folders) {
      if (!seen.has(f.id) && !childToParent.has(f.id)) {
        seen.add(f.id)
        ids.push(f.id)
      }
    }
    return ids
  }, [folders, childToParent])

  // "Show worktrees" container map: repo id → its open worktree child folder ids
  // (sorted). A repo present here renders as a CONTAINER — buildRows nests its
  // own sessions (a "root" sub-group) plus each worktree beneath it, and the
  // whole subtree is gated on the container's own `folderExpanded` entry. Empty
  // when the toggle is off (every folder then renders flat). Depends only on
  // `folders` (+ the toggle), never on `conversations`, so status events don't
  // rebuild it — preserving the single-status-event re-render budget.
  const containerChildren = useMemo(
    () =>
      showWorktrees
        ? worktreeChildrenByParent(reorderableFolderIds, folders)
        : EMPTY_CONTAINER_CHILDREN,
    [showWorktrees, reorderableFolderIds, folders]
  )
  // The repo ids that are containers (have ≥1 open worktree child). Drives the
  // header render's container/plain distinction (total count, subtree toggle).
  const containerRepoIds = useMemo(
    () => new Set(containerChildren.keys()),
    [containerChildren]
  )

  const darkMode = resolvedTheme === "dark"

  // Flat row model for windowing — the pinned section, the folders section, and
  // every conversation live in this ONE array fed to the single Virtualizer (no
  // separate, un-virtualized pinned list). Deliberately excludes `now` (see
  // buildRows): the per-minute label tick must not rebuild rows and break the
  // card memo.
  const rows = useMemo(
    () =>
      buildRows({
        pinned,
        pinnedExpanded,
        // Top-level folders drive the outer order; buildRows nests
        // each container's root sub-group + worktrees via `containerChildren`.
        orderedFolderIds: reorderableFolderIds,
        byFolder,
        folderExpanded,
        folderTotalCounts,
        foldersExpanded,
        chatConversations,
        chatsExpanded,
        recentConversations,
        recentExpanded,
        showRecent,
        recentLimit,
        folderPageSize: FOLDER_PAGE_SIZE,
        folderLimitById,
        sectionOrder,
        conversationExpanded,
        childrenByParent,
        childrenLoading,
        containerChildren,
        rootGroupCollapsed,
      }),
    [
      pinned,
      pinnedExpanded,
      reorderableFolderIds,
      byFolder,
      folderExpanded,
      folderTotalCounts,
      foldersExpanded,
      chatConversations,
      chatsExpanded,
      recentConversations,
      recentExpanded,
      showRecent,
      recentLimit,
      folderLimitById,
      sectionOrder,
      conversationExpanded,
      childrenByParent,
      childrenLoading,
      containerChildren,
      rootGroupCollapsed,
    ]
  )

  // Latest snapshots for the imperative scroll path, refreshed every render so
  // scrollToActive reads current values without being torn down and re-subscribed.
  const rowsRef = useRef<SidebarRow[]>(rows)
  rowsRef.current = rows

  // Sticky-overlay lookup tables, rebuilt only when the flat rows change
  // (folder add/remove/expand, not status events). Consumed exclusively by the
  // imperative scroll handler via refs — never passed to a memoized child — so
  // they have zero effect on the card/header memo path.
  const ownerHeaderIndex = useMemo(() => buildOwnerHeaderIndex(rows), [rows])
  const headerFlatIndices = useMemo(() => folderHeaderFlatIndices(rows), [rows])
  const ownerHeaderIndexRef = useRef(ownerHeaderIndex)
  ownerHeaderIndexRef.current = ownerHeaderIndex
  const headerFlatIndicesRef = useRef(headerFlatIndices)
  headerFlatIndicesRef.current = headerFlatIndices

  useImperativeHandle(ref, () => ({
    scrollToActive() {
      scrollToActiveRef.current()
    },
    expandAll() {
      setFolderExpanded((prev) => {
        const next: Record<number, boolean> = { ...prev }
        for (const id of reorderableFolderIds) next[id] = true
        // Worktree children (containers only) are separate folder ids.
        for (const kids of containerChildren.values())
          for (const id of kids) next[id] = true
        saveFolderExpanded(next)
        return next
      })
      // Expand every container's root sub-group too (session-only state).
      setRootGroupCollapsed((prev) => (prev.size === 0 ? prev : new Set()))
    },
    collapseAll() {
      setFolderExpanded((prev) => {
        const next: Record<number, boolean> = { ...prev }
        for (const id of reorderableFolderIds) next[id] = false
        for (const kids of containerChildren.values())
          for (const id of kids) next[id] = false
        saveFolderExpanded(next)
        return next
      })
    },
  }))

  useEffect(() => {
    scrollToActiveRef.current = () => {
      if (!selectedConversation) return
      const targetId = selectedConversation.id
      const targetAgent = selectedConversation.agentType
      const conv = conversations.find(
        (c) => c.id === targetId && c.agent_type === targetAgent
      )
      if (!conv) return
      // Each expansion step below defers the actual scroll to the next render
      // (the row only exists in the flat model once visible); this effect re-runs
      // on the expansion-state change with the rebuilt rows available via
      // rowsRef, and chains through multiple steps via pendingScrollRef.
      if (conv.pinned_at != null) {
        // Pinned conversations live in the Pinned section — gated only by that
        // section's collapse, never by any folder.
        if (!pinnedExpanded) {
          setSectionCollapsed((prev) => {
            const next = { ...prev, pinned: false }
            saveSectionCollapsed(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
      } else if (conv.kind === "chat") {
        // Chat conversations live in the flat Chat section — gated only by that
        // section's collapse, never by any folder.
        if (!chatsExpanded) {
          setSectionCollapsed((prev) => {
            const next = { ...prev, chats: false }
            saveSectionCollapsed(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
      } else {
        // A folder conversation appears only when the Folders section AND its
        // (display) folder are expanded.
        if (!foldersExpanded) {
          setSectionCollapsed((prev) => {
            const next = { ...prev, folders: false }
            saveSectionCollapsed(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
        // Under "Show worktrees" the conversation may sit inside a container's
        // subtree, which is gated top-down: the container (repo root) must be
        // expanded first, then — for the repo's OWN sessions — its root
        // sub-group. Each step defers the scroll one render (pendingScrollRef).
        if (showWorktrees) {
          const containerRepoId = childToParent.get(conv.folder_id) ?? null
          if (
            containerRepoId != null &&
            !(folderExpanded[containerRepoId] ?? true)
          ) {
            setFolderExpanded((prev) => {
              const next = { ...prev, [containerRepoId]: true }
              saveFolderExpanded(next)
              return next
            })
            pendingScrollRef.current = true
            return
          }
          // The repo's own conversation lives in the indented root sub-group.
          if (containerRepoIds.has(conv.folder_id)) {
            if (!(folderExpanded[conv.folder_id] ?? true)) {
              setFolderExpanded((prev) => {
                const next = { ...prev, [conv.folder_id]: true }
                saveFolderExpanded(next)
                return next
              })
              pendingScrollRef.current = true
              return
            }
            if (rootGroupCollapsed.has(conv.folder_id)) {
              setRootGroupCollapsed((prev) => {
                const next = new Set(prev)
                next.delete(conv.folder_id)
                return next
              })
              pendingScrollRef.current = true
              return
            }
          }
        }
        // A worktree conversation is rendered under its display group's header,
        // so the row's visibility is gated by that group's expansion. With
        // "Show worktrees" off the display group is the parent repo; on, the
        // worktree folder renders its own header, so expand the folder itself.
        const displayFolderId =
          displayChildToParent.get(conv.folder_id) ?? conv.folder_id
        if (!(folderExpanded[displayFolderId] ?? true)) {
          setFolderExpanded((prev) => {
            const next = { ...prev, [displayFolderId]: true }
            saveFolderExpanded(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
      }
      // Off-screen virtualized rows are not in the DOM, so resolve the flat row
      // index and let virtua scroll to it.
      const index = flatIndexOfConversation(
        rowsRef.current,
        targetId,
        targetAgent
      )
      if (index < 0) return
      virtualizerRef.current?.scrollToIndex(index, {
        align: "center",
        smooth: true,
      })
    }

    if (pendingScrollRef.current) {
      pendingScrollRef.current = false
      scrollToActiveRef.current()
    }
  }, [
    selectedConversation,
    conversations,
    folderExpanded,
    displayChildToParent,
    showWorktrees,
    childToParent,
    containerRepoIds,
    rootGroupCollapsed,
    pinnedExpanded,
    foldersExpanded,
    chatsExpanded,
  ])

  const toggleFolder = useCallback((folderId: number) => {
    const currentlyExpanded = folderExpandedRef.current[folderId] ?? true
    const nextExpanded = !currentlyExpanded
    // Update the intent ref before scheduling React state so two clicks that
    // arrive before the next render still toggle from the result of the first
    // click instead of both reading the same committed snapshot.
    folderExpandedRef.current = {
      ...folderExpandedRef.current,
      [folderId]: nextExpanded,
    }
    if (currentlyExpanded) {
      // Collapse can shrink the list under the current scroll offset: virtua
      // then reports "scrolled past this header", the sticky overlay stays
      // up, and the in-list copy is `inert` — the folder looks stuck, clicks
      // do nothing. Pin the header to the top whenever we fold while scrolled
      // through it. CRITICAL: scroll FIRST, shrink SECOND. Scrolling the
      // already-shrunken list (single-rAF after the state flip, in either
      // virtua-`scrollToIndex` or direct `scrollTop` form) desynced virtua's
      // layout from the viewport: an invisible stale wrapper then swallowed
      // clicks anywhere in the list until the next real scroll — the "expand
      // needs two clicks" bug. Scrolling the still-UNCHANGED list keeps the
      // scroll event coherent with the row model; the header's flat index
      // (and therefore its target offset) is identical before and after the
      // collapse, so the pre-collapse pin lands exactly where the post-
      // collapse one meant to. scrollToIndex on unchanged content is the
      // same path scrollToActive uses safely.
      const handle = virtualizerRef.current
      const idx = headerIndexForFolder(rowsRef.current, folderId)
      if (
        handle &&
        idx >= 0 &&
        handle.scrollOffset > handle.getItemOffset(idx)
      ) {
        handle.scrollToIndex(idx, { align: "start", smooth: false })
      }
    }
    setFolderExpanded((prev) => {
      const next = { ...prev, [folderId]: nextExpanded }
      saveFolderExpanded(next)
      return next
    })
  }, [])

  // Toggle a container repo's "root" sub-group (its own sessions). Session-only,
  // so unlike `toggleFolder` there is no persistence write.
  const toggleRootGroup = useCallback((repoId: number) => {
    setRootGroupCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(repoId)) next.delete(repoId)
      else next.add(repoId)
      return next
    })
  }, [])

  // Lazily fetch a conversation's direct delegation children into the cache.
  // Deduped against both the cache and in-flight requests so a re-toggle or the
  // restore-time guard below can call it freely (idempotent, StrictMode-safe).
  const ensureChildrenLoaded = useCallback(async (id: number) => {
    if (childrenByParentRef.current.has(id)) return
    if (childrenInFlightRef.current.has(id)) return
    childrenInFlightRef.current.add(id)
    // Placeholder BEFORE the fetch: `childrenByParent` is the only routing
    // surface for live child upserts, so a concurrent upsert buffers into this
    // entry instead of being dropped, and the fetch merges them — closing the
    // lost-update race. `childrenLoading` keeps the spinner up while empty.
    setChildrenByParent((prev) => {
      if (prev.has(id)) return prev
      const next = new Map(prev)
      next.set(id, [])
      return next
    })
    setChildrenLoading((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      const fetched = await listChildConversations(id)
      setChildrenByParent((prev) => {
        // Drop any child tombstoned while the fetch was in flight — a stale
        // snapshot can still contain a since-deleted child (list_children
        // queried before the soft-delete committed) — then merge the snapshot
        // with live events buffered mid-flight (events win by id) so a child
        // created after the query isn't lost.
        const tomb = deletedChildIdsRef.current
        const liveFetched =
          tomb.size > 0 ? fetched.filter((c) => !tomb.has(c.id)) : fetched
        const buffered = prev.get(id)
        const merged =
          buffered && buffered.length > 0
            ? mergeChildrenById(liveFetched, buffered)
            : liveFetched
        const next = new Map(prev)
        next.set(id, merged)
        return next
      })
    } catch {
      // Roll back the placeholder so a later toggle retries — unless live events
      // already populated it, in which case keep them.
      setChildrenByParent((prev) => {
        const cur = prev.get(id)
        if (cur && cur.length > 0) return prev
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    } finally {
      childrenInFlightRef.current.delete(id)
      setChildrenLoading((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  // Toggle a conversation's sub-session subtree. Expanding kicks off a lazy
  // fetch; the Set identity changes so `rows` rebuilds, but the per-card
  // `expanded` boolean is computed per row at render (never the Set passed in),
  // so only the toggled card's prop flips and every other card memo holds.
  const toggleConversation = useCallback(
    (id: number) => {
      setConversationExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
          void ensureChildrenLoaded(id)
        }
        saveConversationExpanded([...next])
        return next
      })
    },
    [ensureChildrenLoaded]
  )

  // Restore-time lazy load, driven by the RENDERED rows (not the raw persisted
  // set): fetch children for every expanded parent actually visible in `rows`
  // but not yet cached. Iterating `rows` keeps this to the reachable next level —
  // a deep restored expansion re-materializes one level per pass as each level's
  // children arrive and `rows` rebuilds — instead of flooding startup with
  // requests for every persisted (possibly stale/deleted/deep) id. An effect (not
  // a render-time microtask) keeps the side effect out of render; the
  // cache/in-flight dedupe makes the repeated passes cheap and StrictMode-safe.
  useEffect(() => {
    if (loading) return
    for (const row of rows) {
      if (row.kind !== "conversation") continue
      const c = row.conversation
      if (
        c.child_count > 0 &&
        conversationExpanded.has(c.id) &&
        !childrenByParentRef.current.has(c.id) &&
        !childrenInFlightRef.current.has(c.id)
      ) {
        void ensureChildrenLoaded(c.id)
      }
    }
  }, [rows, conversationExpanded, loading, ensureChildrenLoaded])

  // ── Sticky folder header overlay ──────────────────────────────────────────
  // Resolve the folder currently scrolled through and the iOS handoff offset
  // from the live virtua geometry. Imperative + ref-only so its identity stays
  // stable (passing it to `<Virtualizer onScroll>` must not re-subscribe the
  // listener) and so it never participates in the memoized render path.
  const recomputeSticky = useCallback(() => {
    const handle = virtualizerRef.current
    const currentRows = rowsRef.current
    const headers = headerFlatIndicesRef.current
    if (!handle || currentRows.length === 0 || headers.length === 0) {
      setStickyFolderId((prev) => (prev === null ? prev : null))
      return
    }
    const scrollOffset = handle.scrollOffset
    const topIndex = Math.max(
      0,
      Math.min(currentRows.length - 1, handle.findItemIndex(scrollOffset))
    )
    const activeHeaderIndex = ownerHeaderIndexRef.current[topIndex]
    if (activeHeaderIndex < 0) {
      setStickyFolderId((prev) => (prev === null ? prev : null))
      return
    }
    const nextHeaderIndex = nextHeaderAfter(headers, activeHeaderIndex)
    const { visible, translateY } = computeStickyState({
      scrollOffset,
      activeHeaderOffset: handle.getItemOffset(activeHeaderIndex),
      nextHeaderOffset:
        nextHeaderIndex == null ? null : handle.getItemOffset(nextHeaderIndex),
      headerHeight: handle.getItemSize(activeHeaderIndex) || 32,
    })
    if (overlayRef.current) {
      overlayRef.current.style.transform = `translateY(${translateY}px)`
    }
    const activeRow = currentRows[activeHeaderIndex]
    const nextFolderId =
      visible && activeRow.kind === "folder" ? activeRow.folderId : null
    setStickyFolderId((prev) => (prev === nextFolderId ? prev : nextFolderId))
  }, [])

  // virtua fires onScroll synchronously per scroll event; coalesce to one
  // recompute per frame and keep the DOM write frame-aligned.
  const handleVirtuaScroll = useCallback(() => {
    if (stickyRafRef.current != null) return
    stickyRafRef.current = requestAnimationFrame(() => {
      stickyRafRef.current = null
      recomputeSticky()
    })
  }, [recomputeSticky])

  // Overlay and in-list headers share `toggleFolder`. Collapse already pins
  // the header when the list was scrolled through it; expand is a no-scroll.

  // Recompute on anything that shifts geometry without firing a scroll event:
  // expand/collapse, data refresh, viewport ready, and the overlay flip itself
  // (so the freshly-mounted overlay node gets its initial transform).
  // `useLayoutEffect` avoids a one-frame stale overlay.
  useIsomorphicLayoutEffect(() => {
    recomputeSticky()
  }, [rows, folderExpanded, viewportEl, stickyFolderId, recomputeSticky])

  useEffect(
    () => () => {
      if (stickyRafRef.current != null) {
        cancelAnimationFrame(stickyRafRef.current)
      }
    },
    []
  )

  const handleRemoveFolder = useCallback(
    (folderId: number) => {
      const name = folderIndex.get(folderId)?.name ?? String(folderId)
      setRemoveConfirm({ folderId, folderName: name })
    },
    [folderIndex]
  )

  const handleManageConversations = useCallback((folderId: number) => {
    setManageFolderId(folderId)
  }, [])

  const handleManageFolderLinks = useCallback(
    (folderId: number) => {
      const folder = allFolders.find((f) => f.id === folderId)
      if (folder) setLinksFolder(folder)
    },
    [allFolders]
  )

  const handleRemoveFolderConfirm = useCallback(async () => {
    if (!removeConfirm) return
    const { folderId, folderName } = removeConfirm
    try {
      closeTabsByFolder(folderId)
      await removeFolderFromWorkspace(folderId)
      toast.success(t("toasts.folderRemoved", { name: folderName }))
    } catch (e) {
      const msg = toErrorMessage(e)
      toast.error(t("toasts.removeFolderFailed", { message: msg }))
    } finally {
      setRemoveConfirm(null)
    }
  }, [removeConfirm, closeTabsByFolder, removeFolderFromWorkspace, t])

  // The card already holds the full summary, so it passes `folderId` back to
  // these callbacks. That removes the `conversations` closure dependency, which
  // is what keeps these references stable across status events — the linchpin
  // for the card `memo` actually bailing out (see Phase 1 of the perf plan).
  const handleSelect = useCallback(
    (id: number, agentType: string, folderId: number) => {
      // Selecting a conversation returns to the conversation workspace if a
      // workbench route (e.g. Automations) was taking over the content region.
      openConversations()
      openTab(folderId, id, agentType as Parameters<typeof openTab>[2], false)
    },
    [openTab, openConversations]
  )

  const handleDoubleClick = useCallback(
    (id: number, agentType: string, folderId: number) => {
      openConversations()
      openTab(folderId, id, agentType as Parameters<typeof openTab>[2], true)
    },
    [openTab, openConversations]
  )

  const handleRename = useCallback(
    async (id: number, newTitle: string) => {
      await updateConversationTitle(id, newTitle)
      refreshConversations()
    },
    [refreshConversations]
  )

  const handleDelete = useCallback(
    async (id: number, agentType: string, folderId: number) => {
      await deleteConversation(id)
      // No-op if no matching tab is open (the context guards on its tab ref).
      closeConversationTab(
        folderId,
        id,
        agentType as Parameters<typeof openTab>[2]
      )
      refreshConversations()
    },
    [closeConversationTab, refreshConversations]
  )

  const handleStatusChange = useCallback(
    async (id: number, status: ConversationStatus) => {
      updateConversationLocal(id, { status })
      await updateConversationStatus(id, status)
    },
    [updateConversationLocal]
  )

  const handleTogglePin = useCallback(
    async (id: number, nextPinned: boolean) => {
      // Optimistic: instantly move the row into / out of the Pinned section. The
      // upsert echo (emit_conversation_upsert) reconciles the exact server
      // `pinned_at`; on failure the next refresh / WS reconnect corrects it
      // (mirrors handleStatusChange's lenient pattern). Stable callback — only
      // `updateConversationLocal` as a dep — so the card memo keeps bailing out.
      updateConversationLocal(id, {
        pinned_at: nextPinned ? new Date().toISOString() : null,
      })
      await updateConversationPinned(id, nextPinned)
    },
    [updateConversationLocal]
  )

  const handleNewConversation = useCallback(() => {
    // Starting a conversation returns to the conversation workspace if a
    // workbench route (e.g. Automations) was taking over the content region.
    openConversations()
    // With no active folder (all folders closed, or a cold start that recovered
    // to nothing) fall back to folderless chat mode rather than no-op — the
    // same defense the sidebar's own "New chat" row takes, so neither entry
    // point is ever a dead end.
    if (!activeFolder) {
      openChatModeTab()
      return
    }
    openNewConversationTab(activeFolder.id, activeFolder.path)
  }, [activeFolder, openChatModeTab, openNewConversationTab, openConversations])

  const handleNewConversationForFolder = useCallback(
    (folderId: number) => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      // Starting a conversation returns to the conversation workspace if a
      // workbench route (e.g. Automations) was taking over the content region.
      openConversations()
      openNewConversationTab(folderId, folder.path)
    },
    [folderIndex, openNewConversationTab, openConversations]
  )

  // "Import local sessions" now lives in a dedicated picker window (scan →
  // folder-grouped multi-select → batch import). The folder context-menu entry
  // anchors the picker to its own folder; sidebar refresh arrives via the
  // backend's `conversations://bulk-changed` / `folder://changed` broadcasts,
  // so no local busy state or task tracking remains here.
  const handleImportForFolder = useCallback(
    (folderId: number) => {
      const folder = folderIndex.get(folderId)
      void openImportSessionsWindow({ focusPath: folder?.path ?? null })
    },
    [folderIndex]
  )

  const handleOpenImportWindow = useCallback(() => {
    void openImportSessionsWindow()
  }, [])

  // One dialog everywhere: it owns directory selection *and* the follow-up
  // step that links other folders in, so the native picker can't be a separate
  // path that skips half the flow (it is still offered inside the dialog on
  // local desktop). Empty deps — `setBrowserOpen` is a stable setter — so the
  // memoized section header doesn't re-render on every parent render.
  const handleOpenFolderAction = useCallback(() => setBrowserOpen(true), [])

  // Stable trigger for the Clone Repository dialog, passed to the memoized
  // Folders section header. Empty deps (setCloneOpen is a stable setter) so the
  // header doesn't re-render on every parent render.
  const handleOpenCloneDialog = useCallback(() => setCloneOpen(true), [])

  const handleProjectBoot = useCallback(() => {
    openProjectBootWindow().catch((err) => {
      console.error(
        "[SidebarConversationList] failed to open project boot:",
        err
      )
    })
  }, [])

  const showEmptyWorkspaceActions =
    folders.length === 0 && conversations.length === 0

  const folderThemeColor = (folderId: number): FolderThemeColor =>
    normalizeFolderThemeColor(folderIndex.get(folderId)?.color)

  // Folder-section sessions indent one step under the header (`depth >= 1`)
  // but must not grow a spine from the folder icon. Skip that first rail
  // unless this row is pinned / chat / Recent (flat) or a worktree / root
  // sub-group (those keep the container connector).
  const folderRailFrom = (
    conv: DbConversationSummary | undefined,
    recent?: true
  ): number => {
    if (!conv || recent) return 0
    if (conv.kind === "chat" || conv.pinned_at != null) return 0
    if (
      showWorktrees &&
      (childToParent.has(conv.folder_id) ||
        containerRepoIds.has(conv.folder_id))
    ) {
      return 0
    }
    return 1
  }

  // A per-row theme wrapper replaces the old per-folder-group wrapper: it scopes
  // the folder's accent color (and dark-mode flip) to that single virtual row.
  const themeWrap = (folderId: number, child: React.ReactNode) => {
    const themeColor = folderThemeColor(folderId)
    return (
      <div
        className={cn(
          darkMode && themeColor !== FOLDER_THEME_COLOR_INHERIT && "dark"
        )}
        data-theme={
          themeColor === FOLDER_THEME_COLOR_INHERIT ? undefined : themeColor
        }
      >
        {child}
      </div>
    )
  }

  // Running sessions across a container repo and all its worktrees — the count
  // shown on the container header (its own sessions live in the root sub-group,
  // so the bare per-folder number would understate the repo family).
  const containerRunningCount = (repoId: number): number => {
    let total = folderRunningCounts.get(repoId) ?? 0
    const kids = containerChildren.get(repoId)
    if (kids) {
      for (const kid of kids) total += folderRunningCounts.get(kid) ?? 0
    }
    return total
  }

  const folderHeaderElement = (
    folderId: number,
    opts: {
      onToggle?: (folderId: number) => void
      suppressed?: boolean
      /** Render as the container repo's own-sessions "root" sub-group (FolderRoot
       *  glyph, indented, session-only collapse) rather than the repo header. */
      rootGroup?: boolean
    }
  ) => {
    const folderEntry = folderIndex.get(folderId)
    const isRootGroup = opts.rootGroup ?? false
    // A worktree child header (only under "Show worktrees"): indented, FolderGit2
    // glyph, branch label. Keyed off `childToParent` so it matches exactly which
    // folders buildRows nests — an orphan worktree (parent closed) is neither a
    // worktree child nor a container here, so it renders as a plain top-level
    // folder, consistent with its slot.
    const isWorktree =
      !isRootGroup && showWorktrees && childToParent.has(folderId)
    // A container repo (has ≥1 open worktree): plain repo glyph but a count
    // spanning the whole family. Its own sessions render in the root sub-group.
    const isContainer =
      !isRootGroup && showWorktrees && containerRepoIds.has(folderId)
    const variant = isRootGroup ? "root" : isWorktree ? "worktree" : "repo"
    const depth = isRootGroup || isWorktree ? 1 : 0
    const runningCount = isContainer
      ? containerRunningCount(folderId)
      : (folderRunningCounts.get(folderId) ?? 0)
    const expanded = isRootGroup
      ? !rootGroupCollapsed.has(folderId)
      : (folderExpanded[folderId] ?? true)
    return (
      <FolderHeader
        folderId={folderId}
        folderName={folderEntry?.name ?? String(folderId)}
        folderAlias={folderEntry?.alias ?? null}
        folderPath={folderEntry?.path ?? ""}
        runningCount={runningCount}
        expanded={expanded}
        themeColor={folderThemeColor(folderId)}
        appThemeColor={appThemeColor}
        currentDefaultAgent={folderEntry?.defaultAgentType ?? null}
        availableAgents={availableAgents}
        availableAgentsFresh={availableAgentsFresh}
        onToggle={
          opts.onToggle ?? (isRootGroup ? toggleRootGroup : toggleFolder)
        }
        onRemoveFromWorkspace={handleRemoveFolder}
        onNewConversation={handleNewConversationForFolder}
        onImport={handleImportForFolder}
        onManageConversations={handleManageConversations}
        onManageLinks={handleManageFolderLinks}
        onChangeColor={handleChangeFolderColor}
        onSetAlias={handleSetFolderAlias}
        onSetDefaultAgent={handleChangeFolderDefaultAgent}
        onOpenInSystemExplorer={handleOpenFolderInSystemExplorer}
        onOpenInTerminal={handleOpenFolderInTerminal}
        suppressed={opts.suppressed ?? false}
        depth={depth}
        variant={variant}
        worktreeBranch={folderEntry?.gitBranch ?? null}
      />
    )
  }

  const renderRow = (row: SidebarRow) => {
    if (row.kind === "section") {
      // Section headers are not folder-scoped, so they skip themeWrap.
      return (
        <SidebarSectionHeader
          section={row.section}
          expanded={row.expanded}
          onToggle={toggleSection}
          // The chats section gets an always-visible New-chat button (its primary
          // entry point, reachable even when empty). `openChatModeTab` is a stable
          // context callback, so the memo holds. Recent gets the same
          // affordance, but starting a conversation in the ACTIVE FOLDER — the
          // section spans folders and chats alike, and the folder is where a
          // "continue where I left off" list lands you.
          onNewChat={
            row.section === "chats"
              ? openChatModeTab
              : row.section === "recent"
                ? handleNewConversation
                : undefined
          }
          // The folders section gets two right-edge hover actions mirroring the
          // top-of-page NewFolderDropdown: Open Folder and Clone Repository.
          // Both handlers are stable, so the memo holds.
          onOpenFolder={
            row.section === "folders" ? handleOpenFolderAction : undefined
          }
          onCloneRepository={
            row.section === "folders" ? handleOpenCloneDialog : undefined
          }
          // Global "Import local sessions" entry (no folder anchor) — opens
          // the same picker window as the folder context-menu item. Stable
          // callback, so the memo holds.
          onImportSessions={
            row.section === "folders" ? handleOpenImportWindow : undefined
          }
          // Every section header carries a top gap: it separates "Folders" from
          // the "Pinned" section above it, and — now that a fixed New chat /
          // Search region sits above the scrolled list — gives the first section
          // (Pinned, or Folders when nothing is pinned) the same breathing room
          // below that region instead of butting right up against it.
          topGap
        />
      )
    }
    if (row.kind === "folder") {
      return themeWrap(
        row.folderId,
        folderHeaderElement(row.folderId, {
          // While this folder's sticky overlay is showing, the overlay is the
          // accessible control; make the (occluded) in-list copy inert so it is
          // not a duplicate tab stop / announcement.
          suppressed: stickyFolderId === row.folderId,
        })
      )
    }
    if (row.kind === "root-group") {
      // A container repo's own-sessions sub-group. Shares the repo id (for its
      // bucket / count / theme) but is its own row kind with its own toggle.
      return themeWrap(
        row.folderId,
        folderHeaderElement(row.folderId, {
          rootGroup: true,
        })
      )
    }
    if (row.kind === "empty") {
      // Sessions hang one step under the header (plain folder or worktree
      // sub-group). Only a worktree / root-group empty hint draws the
      // container spine — a plain folder stays indented, without a rail.
      const nested =
        showWorktrees &&
        (childToParent.has(row.folderId) || containerRepoIds.has(row.folderId))
      const depth = 1
      return themeWrap(
        row.folderId,
        // Full row height (h-[2rem], the fixed virtua item size) so the
        // container connector spine stays continuous THROUGH an empty
        // worktree ("no conversations") instead of breaking at a shorter box.
        <div
          className="relative flex h-[2rem] items-center text-[0.75rem] text-muted-foreground/70"
          style={{
            paddingLeft: `calc(var(--conv-rail-axis) + 0.875rem + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
          }}
        >
          <SubsessionAncestorRails depth={nested ? depth : 0} />
          <span className="relative truncate">
            {row.totalConversationCount === 0
              ? t("emptyFolderHint")
              : t("noUnfinishedConversations")}
          </span>
        </div>
      )
    }
    if (row.kind === "chats-empty") {
      // Folderless flat hint — no themeWrap, no conversation rail; align with the
      // section header's text inset (px-[0.5rem]) rather than the folder rail.
      return (
        <div className="px-[0.5rem] py-[0.375rem] text-[0.75rem] text-muted-foreground/70">
          {t("noChats")}
        </div>
      )
    }
    if (row.kind === "folders-empty") {
      // Empty "Folders" section hint — mirrors chats-empty (folderless, no rail,
      // aligned with the section header's text inset). The header's own hover
      // actions (Open Folder / Clone / Import) are how you add the first folder.
      return (
        <div className="px-[0.5rem] py-[0.375rem] text-[0.75rem] text-muted-foreground/70">
          {t("noFolders")}
        </div>
      )
    }
    if (row.kind === "recent-empty") {
      // Empty "Recent" section hint — same folderless, rail-less treatment as
      // the other two. Only reachable in a workspace with no conversations at
      // all, since Recent spans every section.
      return (
        <div className="px-[0.5rem] py-[0.375rem] text-[0.75rem] text-muted-foreground/70">
          {t("noRecent")}
        </div>
      )
    }
    if (row.kind === "recent-more") {
      // Footer of the paged Recent section — a row, not a hint: each click
      // reveals another page. Its geometry is the conversation card's, so the
      // section reads as one column — the chevron sits ON the rail axis exactly
      // where a card's agent icon does (same 0.75rem glyph in the same 0.875rem
      // box, centred on the var), and the label starts at the card's title
      // inset (`axis + 0.875rem`). Same row height and full rounding too, so
      // its hover pill is the one the rows above it use.
      return (
        <div className="relative h-[2rem]">
          <button
            type="button"
            onClick={revealMoreRecent}
            className="relative flex h-[1.9375rem] w-full items-center rounded-full pr-[0.25rem] text-left text-[0.75rem] text-muted-foreground/80 outline-none transition-colors duration-[120ms] hover:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_2%)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            style={{
              paddingLeft: "calc(var(--conv-rail-axis, 0.875rem) + 0.875rem)",
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 flex items-center justify-center"
              style={{
                left: "var(--conv-rail-axis, 0.875rem)",
                width: "0.875rem",
                height: "0.875rem",
                transform: "translate(-50%, -50%)",
              }}
            >
              <ChevronDown className="h-[0.75rem] w-[0.75rem]" />
            </span>
            <span className="truncate">
              {t("showMoreRecent", { count: row.remaining })}
            </span>
          </button>
        </div>
      )
    }
    if (row.kind === "folder-more") {
      // Same row as Recent's "show more", but indented with the folder's
      // conversation cards and themed as that folder. Nested worktree /
      // root-group bodies keep the container spine through this footer.
      const nested =
        showWorktrees &&
        (childToParent.has(row.folderId) || containerRepoIds.has(row.folderId))
      return themeWrap(
        row.folderId,
        <div className="relative h-[2rem]">
          {nested ? <SubsessionAncestorRails depth={row.depth} /> : null}
          <button
            type="button"
            onClick={() => revealMoreFolder(row.folderId)}
            className="relative flex h-[1.9375rem] w-full items-center rounded-full pr-[0.25rem] text-left text-[0.75rem] text-muted-foreground/80 outline-none transition-colors duration-[120ms] hover:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_2%)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            style={{
              paddingLeft: `calc(var(--conv-rail-axis, 0.875rem) + 0.875rem + ${row.depth} * ${CONV_RAIL_DEPTH_STEP})`,
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 flex items-center justify-center"
              style={{
                left: `calc(var(--conv-rail-axis, 0.875rem) + ${row.depth} * ${CONV_RAIL_DEPTH_STEP})`,
                width: "0.875rem",
                height: "0.875rem",
                transform: "translate(-50%, -50%)",
              }}
            >
              <ChevronDown className="h-[0.75rem] w-[0.75rem]" />
            </span>
            <span className="relative truncate">{t("showMoreFolder")}</span>
          </button>
        </div>
      )
    }
    if (row.kind === "subsession-loading") {
      // Transient spinner at the child indent while children are fetched. The
      // left inset matches a depth-`row.depth` card's text start: rail axis
      // (0.875rem + depth·CONV_RAIL_DEPTH_STEP) plus the button's extra 0.875rem.
      // Ancestor guide rails keep each parent's vertical line continuous through
      // this placeholder; the content is lifted (relative) above the z-0 rails.
      const parent = conversations.find((c) => c.id === row.parentId)
      return (
        <div
          className="relative py-[0.375rem] text-[0.75rem] text-muted-foreground/70"
          style={{
            paddingLeft: `calc(0.875rem + ${row.depth} * ${CONV_RAIL_DEPTH_STEP} + 0.875rem)`,
          }}
        >
          <SubsessionAncestorRails
            depth={row.depth}
            from={folderRailFrom(parent, row.recent)}
          />
          <span className="relative flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
            {t("loadingSubsessions")}
          </span>
        </div>
      )
    }
    const conv = row.conversation
    // Theme the row by its display group. With "Show worktrees" off a worktree
    // conversation renders under its parent group (themed as the parent); on, it
    // renders under its own worktree header (themed as itself). `displayChildToParent`
    // captures both — empty when the toggle is on.
    const groupId = displayChildToParent.get(conv.folder_id) ?? conv.folder_id
    return themeWrap(
      groupId,
      <SidebarConversationCard
        conversation={conv}
        isSelected={
          selectedConversation?.agentType === conv.agent_type &&
          selectedConversation?.id === conv.id
        }
        isOpenInTab={openTabKeys.has(`${conv.agent_type}:${conv.id}`)}
        timeLabel={formatRelative(
          sortMode === "updated" ? conv.updated_at : conv.created_at,
          now
        )}
        onSelect={handleSelect}
        onDoubleClick={handleDoubleClick}
        onRename={handleRename}
        onDelete={handleDelete}
        onStatusChange={handleStatusChange}
        onNewConversation={handleNewConversationForFolder}
        onTogglePin={handleTogglePin}
        depth={row.depth}
        railFrom={folderRailFrom(conv, row.recent)}
        hasChildren={conv.child_count > 0}
        expanded={conversationExpanded.has(conv.id)}
        onToggleExpand={toggleConversation}
      />
    )
  }

  // Keys must be unique across the WHOLE flat array, and the Recent section
  // deliberately re-lists conversations that also appear under their folder or
  // in Chat — so every row a Recent parent can produce carries a `recent-`
  // prefix to stay distinct from its canonical twin.
  const rowKey = (row: SidebarRow): string => {
    if (row.kind === "section") return `section-${row.section}`
    if (row.kind === "folder") return `folder-${row.folderId}`
    if (row.kind === "root-group") return `rootgroup-${row.folderId}`
    if (row.kind === "empty") return `empty-${row.folderId}`
    if (row.kind === "chats-empty") return "chats-empty"
    if (row.kind === "folders-empty") return "folders-empty"
    if (row.kind === "recent-empty") return "recent-empty"
    if (row.kind === "recent-more") return "recent-more"
    if (row.kind === "folder-more") return `folder-more-${row.folderId}`
    const prefix = row.recent ? "recent-" : ""
    if (row.kind === "subsession-loading") {
      return `${prefix}subloading-${row.parentId}`
    }
    return `${prefix}conv-${row.conversation.agent_type}-${row.conversation.id}`
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      {(loading || refreshing) && (
        // z-20 keeps the refresh spinner above the sticky header overlay (z-10),
        // which lives in a later sibling and would otherwise paint over it.
        <div className="absolute top-0 left-0 right-0 flex items-center justify-center py-1 z-20 pointer-events-none">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </div>
      )}

      {loading && !refreshing ? (
        <div className="px-3 space-y-1.5 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-3">
          <p className="text-destructive text-xs">
            {t("error", { message: error })}
          </p>
        </div>
      ) : showEmptyWorkspaceActions ? (
        <div className="flex-1 flex flex-col items-center justify-center px-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={handleOpenFolderAction}
          >
            <FolderOpenDot className="h-3.5 w-3.5 mr-1.5" />
            {tFolderDropdown("openFolder")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={() => setCloneOpen(true)}
          >
            <FolderGit2 className="h-3.5 w-3.5 mr-1.5" />
            {tFolderDropdown("cloneRepository")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={handleProjectBoot}
          >
            <Rocket className="h-3.5 w-3.5 mr-1.5" />
            {tFolderDropdown("projectBoot")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={handleOpenImportWindow}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {t("importLocalSessions")}
          </Button>
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex-1 min-h-0 relative">
              <ScrollArea
                onViewportRef={handleViewportRef}
                className={cn(
                  "h-full min-h-0 px-1.5 pb-1.5",
                  "[overflow-anchor:none]",
                  "[--conv-rail-axis:0.875rem]"
                )}
              >
                {viewportEl ? (
                  <Virtualizer
                    ref={virtualizerRef}
                    scrollRef={viewportRef}
                    data={rows}
                    itemSize={32}
                    bufferSize={400}
                    onScroll={handleVirtuaScroll}
                  >
                    {(row: SidebarRow) => (
                      <div key={rowKey(row)}>{renderRow(row)}</div>
                    )}
                  </Virtualizer>
                ) : (
                  <div className="flex flex-col gap-1.5 pt-1">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton
                        key={i}
                        className="h-[2rem] w-full rounded-md"
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
              {/*
                Floating sticky folder header. Rendered AFTER ScrollArea so any
                `[data-folder-id]` lookup still resolves the real in-list header
                first (the real one stays mounted within virtua's buffer while
                this overlay also shows). It is a real, accessible control: once
                scrolled past, the in-list header is unmounted by virtua, so the
                overlay is the keyboard/AT path to toggle/act on that folder.
                `bg-sidebar` lives inside themeWrap so it picks up the folder's
                themed background and occludes the rows scrolling beneath it.
              */}
              {stickyFolderId !== null && (
                <div
                  ref={overlayRef}
                  className={cn(
                    "absolute left-0 right-0 top-0 z-10",
                    "px-1.5 [--conv-rail-axis:0.875rem]"
                  )}
                  style={{ willChange: "transform" }}
                >
                  {themeWrap(
                    stickyFolderId,
                    <div className="bg-sidebar">
                      {folderHeaderElement(stickyFolderId, {
                        onToggle: toggleFolder,
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={handleNewConversation}
              disabled={!activeFolder}
            >
              <SquarePen className="h-4 w-4" />
              {t("newConversation")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={handleOpenFolderAction}>
              <FolderOpenDot className="h-4 w-4" />
              {tFolderDropdown("openFolder")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setCloneOpen(true)}>
              <FolderGit2 className="h-4 w-4" />
              {tFolderDropdown("cloneRepository")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleProjectBoot}>
              <Rocket className="h-4 w-4" />
              {tFolderDropdown("projectBoot")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleOpenImportWindow}>
              <Download className="h-4 w-4" />
              {t("importLocalSessions")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}

      <AlertDialog
        open={removeConfirm !== null}
        onOpenChange={(open) => !open && setRemoveConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeFolderConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeFolderConfirmDescription", {
                name: removeConfirm?.folderName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveFolderConfirm}>
              {tCommon("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {manageFolderId != null && (
        <ConversationManageDialog
          open
          onOpenChange={(o) => !o && setManageFolderId(null)}
          folderId={manageFolderId}
        />
      )}

      <CloneDialog open={cloneOpen} onOpenChange={setCloneOpen} />
      <WorkspaceFolderDialog open={browserOpen} onOpenChange={setBrowserOpen} />
      {linksFolder && (
        <WorkspaceFolderDialog
          open
          onOpenChange={(o) => !o && setLinksFolder(null)}
          folder={linksFolder}
        />
      )}
    </div>
  )
}
