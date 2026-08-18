"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUpToLine,
  BrainCog,
  CheckIcon,
  Coins,
  CopyIcon,
  ListTodo,
  Timer,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useMessageScroll } from "@/components/message/message-scroll-context"
import { useCreateTaskFromMessage } from "./use-create-task-from-message"
import { formatElapsedLabel } from "@/lib/format-elapsed"
import { formatTokenCount } from "@/lib/token-format"
import { cn, copyTextToClipboard } from "@/lib/utils"
import type { TurnUsage } from "@/lib/types"

interface TurnStatsProps {
  usage?: TurnUsage | null
  duration_ms?: number | null
  model?: string | null
  models?: string[]
  previousUserIndex?: number | null
  /** ISO timestamp of the preceding user prompt — used to infer duration. */
  previousUserAt?: string | null
  isResponseComplete?: boolean
  copyText?: string
  /** ISO timestamp marking when the assistant reply finished. */
  completedAt?: string | null
}

/** Prefer the agent-reported span; otherwise prompt → completion. */
export function resolveTurnDurationMs(
  duration_ms?: number | null,
  completedAt?: string | null,
  previousUserAt?: string | null
): number | null {
  if (typeof duration_ms === "number" && duration_ms > 0) return duration_ms
  if (!completedAt || !previousUserAt) return null
  const end = new Date(completedAt).getTime()
  const start = new Date(previousUserAt).getTime()
  if (Number.isNaN(end) || Number.isNaN(start)) return null
  const ms = end - start
  return ms > 0 ? ms : null
}

const iconButtonClass =
  "inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export function TurnStats({
  usage,
  duration_ms,
  model,
  models,
  previousUserIndex,
  previousUserAt,
  isResponseComplete = true,
  copyText = "",
  completedAt,
}: TurnStatsProps) {
  const locale = useLocale()
  const t = useTranslations("Folder.chat.messageList")
  // Reuse the live timer's elapsed-unit strings so the per-turn duration
  // tooltip renders the exact same localized "Xh Ym Zs" format.
  const tLive = useTranslations("Folder.chat.liveTurnStats")
  const tTasks = useTranslations("Tasks")
  const scroll = useMessageScroll()
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)
  const shortTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale]
  )
  const fullTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    [locale]
  )

  const completedAtDate = useMemo(() => {
    if (!isResponseComplete) return null
    if (!completedAt) return null
    const ms = new Date(completedAt).getTime()
    if (Number.isNaN(ms)) return null
    return new Date(ms)
  }, [completedAt, isResponseComplete])
  const completedLabel = completedAtDate
    ? shortTimeFormatter.format(completedAtDate)
    : null
  const completedTooltip = completedAtDate
    ? fullTimeFormatter.format(completedAtDate)
    : null

  const displayModels = models?.length ? models : model ? [model] : []
  const resolvedDurationMs = resolveTurnDurationMs(
    duration_ms,
    completedAt,
    previousUserAt
  )
  const hasCopy = copyText.trim().length > 0
  const hasUsage = Boolean(usage)
  const hasDuration = resolvedDurationMs != null
  const hasCompletedAt = Boolean(completedLabel)
  // Usage OR duration: some agents (Cursor) never report per-turn token
  // usage, but a turn with a duration chip is still a substantial reply
  // worth jumping back from.
  const hasJump =
    isResponseComplete &&
    (hasUsage || hasDuration) &&
    typeof previousUserIndex === "number" &&
    Boolean(scroll?.scrollToIndex)

  const handleJump = useCallback(() => {
    if (typeof previousUserIndex !== "number") return
    scroll?.scrollToIndex(previousUserIndex, { align: "start", smooth: true })
  }, [previousUserIndex, scroll])

  const getTaskText = useCallback(() => copyText ?? "", [copyText])
  const handleCreateTask = useCreateTaskFromMessage(getTaskText)

  const handleCopy = useCallback(async () => {
    if (isCopied || !hasCopy) return
    window.clearTimeout(timeoutRef.current)
    const ok = await copyTextToClipboard(copyText)
    if (!ok) return
    setIsCopied(true)
    timeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000)
  }, [copyText, hasCopy, isCopied])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    []
  )

  if (!isResponseComplete) return null
  if (!hasCopy && !hasUsage && !hasDuration && !hasCompletedAt && !hasJump)
    return null

  return (
    <div className="mt-2 -ms-[0.3125rem] flex items-center justify-start gap-1 text-xs text-muted-foreground">
      <TooltipProvider delayDuration={150}>
        {hasCopy && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCopy}
                className={iconButtonClass}
                aria-label={isCopied ? t("copied") : t("copyMessage")}
              >
                {isCopied ? (
                  <CheckIcon aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <CopyIcon aria-hidden="true" className="h-3.5 w-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isCopied ? t("copied") : t("copyMessage")}
            </TooltipContent>
          </Tooltip>
        )}
        {hasCopy && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCreateTask}
                className={iconButtonClass}
                aria-label={tTasks("createFromMessage")}
              >
                <ListTodo aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {tTasks("createFromMessage")}
            </TooltipContent>
          </Tooltip>
        )}
        {displayModels.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(iconButtonClass, "cursor-default")}
                aria-label={t("model")}
              >
                <BrainCog aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs break-words">
              <span className="font-medium" translate="no">
                {displayModels.join(", ")}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
        {hasUsage && usage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(iconButtonClass, "cursor-default")}
                aria-label={t("tokenStats")}
              >
                <Coins aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <div className="flex flex-col gap-0.5">
                <div className="flex justify-between gap-3">
                  <span>{t("tokenInput")}</span>
                  <span className="font-mono tabular-nums">
                    {formatTokenCount(usage.input_tokens)}
                  </span>
                </div>
                {/* An agent that reports no output split at all would otherwise
                    show a misleading "Output: 0" row. Symmetric with the cache
                    rows' `> 0` gating below. */}
                {usage.output_tokens > 0 && (
                  <div className="flex justify-between gap-3">
                    <span>{t("tokenOutput")}</span>
                    <span className="font-mono tabular-nums">
                      {formatTokenCount(usage.output_tokens)}
                    </span>
                  </div>
                )}
                {usage.cache_read_input_tokens > 0 && (
                  <div className="flex justify-between gap-3">
                    <span>{t("tokenCacheRead")}</span>
                    <span className="font-mono tabular-nums">
                      {formatTokenCount(usage.cache_read_input_tokens)}
                    </span>
                  </div>
                )}
                {usage.cache_creation_input_tokens > 0 && (
                  <div className="flex justify-between gap-3">
                    <span>{t("tokenCacheWrite")}</span>
                    <span className="font-mono tabular-nums">
                      {formatTokenCount(usage.cache_creation_input_tokens)}
                    </span>
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        {hasDuration && resolvedDurationMs != null && (
          <span
            className="inline-flex h-6 items-center gap-1 px-1.5 tabular-nums"
            aria-label={`${t("duration")}: ${formatElapsedLabel(resolvedDurationMs, tLive)}`}
          >
            <Timer aria-hidden="true" className="h-3.5 w-3.5" />
            {formatElapsedLabel(resolvedDurationMs, tLive)}
          </span>
        )}
        {hasJump && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleJump}
                className={iconButtonClass}
                aria-label={t("jumpToPreviousUserMessage")}
              >
                <ArrowUpToLine aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t("jumpToPreviousUserMessage")}
            </TooltipContent>
          </Tooltip>
        )}
        {hasCompletedAt && completedTooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-6 cursor-default items-center rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={`${t("completedAt")}: ${completedTooltip}`}
              >
                <span aria-hidden="true">{completedLabel}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">
                  {t("completedAt")}
                </span>
                <span className="font-mono tabular-nums">
                  {completedTooltip}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </TooltipProvider>
    </div>
  )
}
