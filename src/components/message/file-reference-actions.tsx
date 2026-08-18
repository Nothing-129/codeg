"use client"

import type { ReactNode } from "react"
import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { parseLocalFileTarget } from "@/components/ai-elements/link-safety"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { toErrorMessage } from "@/lib/app-error"
import { expandHomePath, isHomeRelativePath } from "@/lib/file-open-target"
import {
  toAbsoluteFilePath,
  toFolderRelativePath,
} from "@/lib/file-path-display"
import { isLocalDesktop, openPath, revealItemInDir } from "@/lib/platform"
import { copyTextFromMenu } from "@/lib/utils"

/** The two path forms offered by the badge's action menu. */
export interface FileReferencePaths {
  /**
   * Absolute filesystem path (slash-normalized), or a `~/`-rooted path — the
   * home directory only resolves through the backend, so the tilde form is
   * kept here and expanded at reveal time.
   */
  absolute: string
  /** Path relative to the active folder; null when the file lives outside it. */
  relative: string | null
}

/**
 * Resolve a rendered file reference — a `file://` uri (user-message badge) or a
 * local path (assistant markdown link, already rewritten by
 * remark-file-uri-links) — into its absolute and folder-relative forms.
 *
 * Returns null when the target isn't a local file at all (a web link, an
 * embedded `codeg://` attachment badge) or when a relative target can't be made
 * absolute for lack of an active folder — in those cases the badge shows no
 * action button, since none of the three actions could do anything.
 *
 * Parsing goes through link-safety's {@link parseLocalFileTarget} so the menu
 * resolves the same path a click on the badge would open (line suffixes like
 * `#L10-25` / `:12` are dropped — a path is copied, not a location).
 */
export function resolveFileReferenceTarget(
  rawTarget: string,
  folderPath?: string | null
): FileReferencePaths | null {
  const target = parseLocalFileTarget(rawTarget)
  if (!target) return null
  return resolveLocalPaths(target.path, folderPath)
}

/**
 * Resolve an already-trusted local path (absolute, `~/…`, or folder-relative)
 * into its absolute and folder-relative forms. Shared by the url-parsing
 * {@link resolveFileReferenceTarget} and the `path` prop mode below, whose
 * paths arrive pre-validated (minted by remark-autolink-local-paths) and so
 * skip `parseLocalFileTarget` — which rejects bare-relative paths that are
 * perfectly valid here.
 */
function resolveLocalPaths(
  path: string,
  folderPath?: string | null
): FileReferencePaths | null {
  if (isHomeRelativePath(path)) {
    return { absolute: path, relative: null }
  }

  const absolute = toAbsoluteFilePath(path, folderPath ?? undefined)
  if (!absolute) return null

  // `toFolderRelativePath` returns the absolute path unchanged when the file
  // lives outside the folder — that's "no relative form", not a relative path.
  const relative = folderPath
    ? toFolderRelativePath(absolute, folderPath)
    : null
  return {
    absolute,
    relative: relative && relative !== absolute ? relative : null,
  }
}

/** The reveal label matching the host OS, mirroring the file tree's "Open in". */
export function systemFileManagerLabelKey():
  | "openInFinder"
  | "openInExplorer"
  | "openInFileManager" {
  if (typeof navigator === "undefined") return "openInFileManager"
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  if (platform.includes("mac")) return "openInFinder"
  if (platform.includes("win")) return "openInExplorer"
  return "openInFileManager"
}

/**
 * The menu body. Mounted only while the menu is open, so a badge sitting in the
 * transcript pays for neither the active-folder subscription, the path
 * resolution, nor a translator.
 */
function FileReferenceActionsMenu({
  target,
  path,
}: {
  target?: string
  path?: string
}) {
  const t = useTranslations("Folder.chat.fileActions")
  const { activeFolder } = useActiveFolder()
  const folderPath = activeFolder?.path
  const paths = useMemo(
    () =>
      path !== undefined
        ? resolveLocalPaths(path, folderPath)
        : target !== undefined
          ? resolveFileReferenceTarget(target, folderPath)
          : null,
    [target, path, folderPath]
  )

  const handleReveal = () => {
    if (!paths) return
    void (async () => {
      try {
        const absolute = isHomeRelativePath(paths.absolute)
          ? await expandHomePath(paths.absolute)
          : paths.absolute
        await revealItemInDir(absolute)
      } catch (error) {
        toast.error(t("openFailed"), { description: toErrorMessage(error) })
      }
    })()
  }

  // Open the file with the OS default application — the "double-click it in
  // the file manager" action. Most useful for binary artifacts (installer /
  // archive / media) the in-app preview can't render.
  const handleOpenWithSystemApp = () => {
    if (!paths) return
    void (async () => {
      try {
        const absolute = isHomeRelativePath(paths.absolute)
          ? await expandHomePath(paths.absolute)
          : paths.absolute
        await openPath(absolute)
      } catch (error) {
        toast.error(t("openFailed"), { description: toErrorMessage(error) })
      }
    })()
  }

  const handleCopy = (value: string | null) => {
    if (!value) return
    // `copyTextFromMenu` defers the write until this menu has closed, so the
    // execCommand fallback still works in non-secure web contexts.
    void copyTextFromMenu(value).then((ok) => {
      if (ok) toast.success(t("pathCopied"))
      else toast.error(t("copyPathFailed"))
    })
  }

  return (
    <>
      {/* `openPath` / `revealItemInDir` are no-ops in web mode and for a
          desktop window bound to a remote workspace, so those rows are
          hidden rather than dead. */}
      {isLocalDesktop() && (
        <>
          <ContextMenuItem disabled={!paths} onSelect={handleOpenWithSystemApp}>
            {t("openWithDefaultApp")}
          </ContextMenuItem>
          <ContextMenuItem disabled={!paths} onSelect={handleReveal}>
            {t(systemFileManagerLabelKey())}
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem
        disabled={!paths?.relative}
        onSelect={() => handleCopy(paths?.relative ?? null)}
      >
        {t("copyRelativePath")}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!paths?.absolute}
        onSelect={() => handleCopy(paths?.absolute ?? null)}
      >
        {t("copyAbsolutePath")}
      </ContextMenuItem>
    </>
  )
}

/**
 * Wraps an inline file badge in the transcript (user messages via
 * PlainTextWithBadges, assistant markdown via MarkdownLink) so that right-
 * clicking the file name opens its actions: reveal in the OS file manager, copy
 * relative path, copy absolute path. A non-file target renders its children
 * untouched, with no menu attached.
 *
 * A context menu (not a hover popover, and not a click target of its own) is
 * what leaves the badge's own behaviour intact: a left click still opens the
 * file in the workspace panel, reading past a file name pops nothing, and Radix
 * gives the long-press gesture on touch, keyboard navigation and Escape for
 * free.
 *
 * The conversation panel wraps the whole transcript in its own context menu
 * (copy text / new conversation / export / …, see
 * conversations/conversation-detail-panel.tsx), so the badge's trigger STOPS the
 * event from bubbling — otherwise both menus open at once. Right-clicking a file
 * name is therefore about that file; right-clicking anywhere else in the
 * transcript still gets the conversation menu.
 */
export function FileReferenceActions({
  target,
  path,
  children,
}: {
  /**
   * A url-shaped target — a `file://` uri (user-message badge) or a local
   * path (assistant markdown link) — parsed with `parseLocalFileTarget`
   * before use.
   */
  target?: string
  /**
   * A trusted local path carried by a `codeg://file/…` badge (an autolinked
   * plain-text path, see remark-autolink-local-paths). Used as-is, no url
   * parsing — bare-relative paths are valid here.
   */
  path?: string
  children: ReactNode
}) {
  // Folder-independent: whether this target is a local file at all. The full
  // resolution (which needs the active folder) happens inside the open menu.
  const isLocalFile = useMemo(
    () =>
      (path !== undefined && path !== "") ||
      (target !== undefined && parseLocalFileTarget(target) !== null),
    [target, path]
  )

  if (!isLocalFile) return <>{children}</>

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          data-file-actions=""
          className="inline-flex max-w-full items-center align-middle"
          // Radix's own handler still runs (it is merged onto this same
          // element); only the ancestor conversation-panel trigger is cut off.
          onContextMenu={(event) => event.stopPropagation()}
          // Touch/pen open a context menu from a long press, which is armed on
          // pointerdown — stop that press from arming the ancestor trigger too.
          // Mouse presses keep bubbling, so the panel's selection bookkeeping is
          // untouched.
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse") event.stopPropagation()
          }}
        >
          {children}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FileReferenceActionsMenu target={target} path={path} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
