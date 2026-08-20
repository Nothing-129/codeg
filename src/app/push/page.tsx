"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
const getCurrentWindow = async () => {
  const m = await import("@tauri-apps/api/window")
  return m.getCurrentWindow()
}
import { Loader2 } from "lucide-react"
import { PushWorkspace } from "@/components/layout/push-workspace"
import { AppTitleBar } from "@/components/layout/app-title-bar"
import { AppToaster } from "@/components/ui/app-toaster"
import { getFolder } from "@/lib/api"
import type { FolderDetail } from "@/lib/types"
import { RemoteConnectionGate } from "@/contexts/remote-connection-context"

const TOAST_DURATION_MS = 6000

interface FolderLoadState {
  loadedId: number | null
  folder: FolderDetail | null
  error: string | null
}

function PushPageInner() {
  const t = useTranslations("Folder.pushWindow")
  const searchParams = useSearchParams()
  const [state, setState] = useState<FolderLoadState>({
    loadedId: null,
    folder: null,
    error: null,
  })

  const closeWindow = useCallback(async () => {
    try {
      const win = await getCurrentWindow()
      await win.close()
    } catch (err) {
      console.error("[PushPage] failed to close window:", err)
    }
  }, [])

  const folderId = Number(searchParams.get("folderId") ?? "0")
  const normalizedFolderId = Number.isFinite(folderId) ? folderId : 0
  // Set when the window was opened for a specific branch (the branch selector's
  // per-branch push); absent means "whatever is checked out".
  const initialBranch = searchParams.get("branch") || null
  const hasValidFolderId = normalizedFolderId > 0
  const loading = hasValidFolderId && state.loadedId !== normalizedFolderId
  const folder = state.loadedId === normalizedFolderId ? state.folder : null
  const error = state.loadedId === normalizedFolderId ? state.error : null

  useEffect(() => {
    if (!hasValidFolderId) return

    let cancelled = false

    getFolder(normalizedFolderId)
      .then((detail) => {
        if (!cancelled) {
          setState({
            loadedId: normalizedFolderId,
            folder: detail,
            error: null,
          })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            loadedId: normalizedFolderId,
            folder: null,
            error: String(err),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [hasValidFolderId, normalizedFolderId])

  const pageTitle = folder ? `${t("title")} · ${folder.name}` : t("title")

  useEffect(() => {
    document.title = `${pageTitle} - MaxCode`
  }, [pageTitle])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppTitleBar
        center={
          <div className="text-sm font-semibold tracking-tight">
            {t("title")}
            {hasValidFolderId && folder ? ` · ${folder.name}` : ""}
          </div>
        }
      />

      <main className="min-h-0 flex-1">
        {!hasValidFolderId ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Invalid folder ID
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : folder ? (
          <PushWorkspace
            folderPath={folder.path}
            folderName={folder.name}
            folderId={folder.id}
            initialBranch={initialBranch}
            onPushed={closeWindow}
          />
        ) : null}
      </main>

      <AppToaster
        position="bottom-right"
        duration={TOAST_DURATION_MS}
        closeButton
      />
    </div>
  )
}

export default function PushPage() {
  return (
    <Suspense>
      <RemoteConnectionGate>
        <PushPageInner />
      </RemoteConnectionGate>
    </Suspense>
  )
}
