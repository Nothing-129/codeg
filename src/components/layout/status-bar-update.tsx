"use client"

import { type ReactNode, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { ArrowUp, ArrowUpCircle, Check, CircleAlert } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { useAppUpdate } from "@/components/providers/update-provider"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { openUrl } from "@/lib/platform"
import {
  appUpdateErrorMessageKey,
  normalizeAppUpdateError,
} from "@/lib/updater"
import {
  readDismissedVersion,
  readNotifiedVersion,
  writeNotifiedVersion,
} from "@/lib/update-check-storage"
import { cn } from "@/lib/utils"

// The markdown stack is a settings-side dependency; keep it out of the
// workspace's first load and pull it in only when someone opens the popover.
const ReleaseNotes = dynamic(
  async () => {
    const mod = await import("@/components/settings/release-notes")
    return { default: mod.ReleaseNotes }
  },
  { ssr: false }
)

const RELEASES_URL = "https://github.com/Nothing-129/maxcode/releases/latest"

function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={`animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none ${className}`}
    />
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Which stage of the install the lifecycle is in, for the step rail. */
type Step = "download" | "install" | "restart"
const STEP_ORDER: Step[] = ["download", "install", "restart"]

/**
 * Three-dot rail visualising download → install → restart. Steps before the
 * current one read as done, the current one pulses, later ones stay muted — so
 * a glance at the popover says both "where are we" and "what's left".
 */
function StepRail({ current }: { current: Step }) {
  const t = useTranslations("SystemSettings")
  const labels: Record<Step, string> = {
    download: t("stepDownload"),
    install: t("stepInstall"),
    restart: t("stepRestart"),
  }
  const currentIndex = STEP_ORDER.indexOf(current)

  return (
    <ol className="flex items-center gap-1.5 text-[11px]">
      {STEP_ORDER.map((step, i) => {
        const isDone = i < currentIndex
        const isCurrent = i === currentIndex
        return (
          <li key={step} className="flex items-center gap-1.5">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-3",
                  isDone || isCurrent ? "bg-primary/60" : "bg-border"
                )}
              />
            )}
            <span
              className={cn(
                "flex items-center gap-1",
                isCurrent && "text-primary font-medium",
                isDone && "text-muted-foreground",
                !isDone && !isCurrent && "text-muted-foreground/50"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  isCurrent &&
                    "bg-primary animate-pulse motion-reduce:animate-none",
                  isDone && "bg-primary/50",
                  !isDone && !isCurrent && "bg-border"
                )}
              />
              {labels[step]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * App-wide update indicator in the status bar. Both halves of the flow live in
 * the {@link useAppUpdate} provider — the periodic availability check and the
 * backend-owned download/install lifecycle — so this stays in sync no matter
 * which surface started it, and a new release surfaces here even when the
 * settings page was never opened (the same pattern as VS Code / JetBrains).
 *
 * Every state is a popover trigger: the compact pill says what is happening,
 * and clicking it reveals the release details plus the one action that makes
 * sense right now. The running version remains visible even while idle, making
 * the same stable control the place to check manually and to discover updates.
 */
export function StatusBarUpdate() {
  const t = useTranslations("SystemSettings")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const update = useAppUpdate()

  const availableVersion = update?.available?.version ?? null
  const dismissedVersion = update?.dismissedVersion ?? null
  useEffect(() => {
    if (!availableVersion || dismissedVersion === availableVersion) return
    // The persisted dismissal can hydrate one effect after a cached offer.
    // Read it directly as well so a waved-away release never flashes a toast.
    if (readDismissedVersion() === availableVersion) return
    if (readNotifiedVersion() === availableVersion) return
    writeNotifiedVersion(availableVersion)
    toast.info(t("foundUpdate", { version: availableVersion }), {
      action: {
        label: t("viewRelease", { version: availableVersion }),
        onClick: () => setOpen(true),
      },
    })
  }, [availableVersion, dismissedVersion, t])

  if (!update) return null

  const {
    state,
    isUpdating,
    restartCountdown,
    isRestarting,
    isBusy,
    available,
    currentVersion,
    checking,
    checkError,
    lastCheckedAt,
    canInstallInPlace,
    runtime,
    selfUpdateSupported,
    dismissAvailable,
    checkNow,
    startUpdate,
    restart,
  } = update

  // A relaunch is in progress: the countdown, the backend `restarting` event,
  // or the brief desktop window right after the click.
  const restarting =
    restartCountdown !== null || state.status === "restarting" || isRestarting
  const ready = state.status === "ready_to_restart"
  const failed = state.status === "error"
  // A release the user could act on right now. An update they already started
  // outranks it, so this only holds while the lifecycle is settled.
  const offering = !!available && !restarting && !ready && !isUpdating
  // Dismissed: keep it reachable but strip the badge to a muted icon — no
  // accent colour, no label. It stops asking for attention without becoming
  // undiscoverable, which full hiding would (the settings page would be the
  // only way back to a release the user waved away by mistake).
  const muted = offering && available!.version === dismissedVersion
  const showAvailable = offering && !muted && !failed

  // ─── Trigger ─────────────────────────────────────────────────────────────

  const downloadPercent =
    state.status === "downloading" && state.total && state.total > 0
      ? Math.min(100, Math.round(((state.downloaded ?? 0) / state.total) * 100))
      : null

  let triggerIcon: ReactNode
  let triggerStatus: string | null
  let triggerTitle: string | undefined
  let accented = false
  let destructive = false
  if (restarting) {
    triggerIcon = <Spinner className="h-3 w-3" />
    triggerStatus =
      restartCountdown !== null && restartCountdown > 0
        ? t("restartingIn", { seconds: restartCountdown })
        : t("restarting")
  } else if (ready) {
    triggerIcon = <ArrowUpCircle className="h-3.5 w-3.5" />
    triggerStatus = t("restartToUpdate")
    accented = true
  } else if (isUpdating) {
    triggerIcon = <Spinner className="h-3 w-3" />
    triggerStatus =
      state.status === "downloading"
        ? downloadPercent !== null
          ? `${t("downloading")} ${downloadPercent}%`
          : t("downloading")
        : t("updating")
  } else if (failed) {
    triggerIcon = <CircleAlert className="h-3.5 w-3.5" />
    triggerStatus = t("updateFailedStatus")
    destructive = true
  } else if (offering) {
    const badge = t("newVersionBadge", { version: available!.version })
    triggerIcon = <ArrowUp className="h-3.5 w-3.5" />
    triggerStatus = muted ? null : badge
    triggerTitle = badge
    accented = !muted
  } else {
    triggerIcon = null
    triggerStatus = null
  }
  const runningVersion = currentVersion ? `v${currentVersion}` : "v—"
  const triggerLabel = [runningVersion, triggerStatus ?? triggerTitle]
    .filter(Boolean)
    .join(", ")

  // ─── Popover body ────────────────────────────────────────────────────────

  const targetVersion = available?.version ?? state.version
  const formattedDate = (() => {
    if (!available?.date) return null
    const parsed = new Date(available.date)
    if (Number.isNaN(parsed.getTime())) return available.date
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      parsed
    )
  })()
  const formattedLastChecked = (() => {
    if (!lastCheckedAt) return null
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(lastCheckedAt)
  })()

  const activeStep: Step =
    state.status === "downloading"
      ? "download"
      : restarting || ready
        ? "restart"
        : "install"
  const showRail = restarting || ready || isUpdating

  const lifecycleError = failed && state.error ? state.error : null
  const errorMessage = lifecycleError
    ? t(
        appUpdateErrorMessageKey(
          normalizeAppUpdateError(lifecycleError).kind,
          "install"
        )
      )
    : null
  const checkErrorMessage = checkError
    ? t(
        appUpdateErrorMessageKey(
          normalizeAppUpdateError(checkError).kind,
          "check"
        )
      )
    : null

  const handleLater = () => {
    dismissAvailable()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={triggerLabel}
          title={triggerTitle}
          className={cn(
            "flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-1.5 font-mono tabular-nums transition-colors duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            destructive
              ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
              : accented
                ? "border border-amber-500/50 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:border-amber-400/50 dark:text-amber-300"
                : "hover:bg-accent hover:text-foreground"
          )}
        >
          <span>{runningVersion}</span>
          {triggerIcon}
          {triggerStatus && (
            <span className="hidden sm:inline">{triggerStatus}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 gap-3 p-3">
        <div className="space-y-1">
          <div className="text-xs font-medium">
            {/* A relaunch can also be a rollback, which has no release on
                offer — don't announce one. */}
            {ready
              ? t("updateReadyHint")
              : offering
                ? t("updateAvailableTitle")
                : t("versionTitle")}
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">
              {currentVersion ? `v${currentVersion}` : "—"}
              {targetVersion ? ` → v${targetVersion}` : ""}
            </span>
            {formattedDate && <span>{formattedDate}</span>}
          </div>
          {formattedLastChecked && !formattedDate && (
            <div className="text-[11px] text-muted-foreground">
              {t("lastChecked", { time: formattedLastChecked })}
            </div>
          )}
        </div>

        {showRail && (
          <div className="space-y-2">
            <StepRail current={activeStep} />
            {state.status === "downloading" && (
              <>
                <div
                  role="progressbar"
                  aria-label={t("downloading")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={downloadPercent ?? undefined}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  {downloadPercent !== null ? (
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {formatBytes(state.downloaded ?? 0)}
                  {state.total ? ` / ${formatBytes(state.total)}` : ""}
                </div>
              </>
            )}
            {state.status === "installing" && (
              <div
                role="progressbar"
                aria-label={t("updating")}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
              </div>
            )}
            {restarting && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Spinner className="h-3 w-3" />
                {restartCountdown !== null && restartCountdown > 0
                  ? t("restartingIn", { seconds: restartCountdown })
                  : t("waitingForServer")}
              </div>
            )}
            {ready && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Check className="h-3 w-3 text-primary" />
                {t("updateReadyHint")}
              </div>
            )}
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-400"
          >
            {t("updateError", { message: errorMessage })}
          </div>
        )}

        {checkErrorMessage && !errorMessage && (
          <div
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-400"
          >
            {t("checkUpdateFailed", { message: checkErrorMessage })}
          </div>
        )}

        {available && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              {t("releaseNotesTitle")}
            </div>
            <ReleaseNotes
              notes={available.body}
              emptyLabel={t("none")}
              className="max-h-48 overflow-auto rounded-md border bg-background/70 px-2.5 py-2 text-xs"
            />
          </div>
        )}

        {/* Docker upgrades only live as long as the container does. */}
        {available && selfUpdateSupported && runtime === "docker" && (
          <p className="text-[11px] leading-5 text-muted-foreground/80">
            {t("dockerUpgradeHint")}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          {showAvailable && (
            <Button size="sm" variant="ghost" onClick={handleLater}>
              {t("remindLater")}
            </Button>
          )}
          {ready ? (
            <Button size="sm" onClick={() => void restart()} disabled={isBusy}>
              <ArrowUpCircle className="h-3.5 w-3.5" />
              {t("restartToUpdate")}
            </Button>
          ) : failed ? (
            <Button
              size="sm"
              onClick={() => void startUpdate()}
              disabled={isBusy}
            >
              {t("retry")}
            </Button>
          ) : offering ? (
            // Still offered after a dismissal — hiding the badge must not take
            // the action away with it.
            // In-place install only where this client can drive it; an older
            // remote server falls back to the release page.
            canInstallInPlace ? (
              <Button
                size="sm"
                onClick={() => void startUpdate()}
                disabled={isBusy}
              >
                <ArrowUpCircle className="h-3.5 w-3.5" />
                {t("upgradeTo", { version: available!.version })}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void openUrl(RELEASES_URL)}>
                <ArrowUpCircle className="h-3.5 w-3.5" />
                {t("viewRelease", { version: available!.version })}
              </Button>
            )
          ) : (
            <Button
              size="sm"
              onClick={() => void checkNow({ silent: false })}
              disabled={checking || isBusy}
            >
              {checking && <Spinner className="h-3 w-3" />}
              {checking ? t("checking") : t("checkUpdate")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
