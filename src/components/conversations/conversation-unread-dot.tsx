import { cn } from "@/lib/utils"

/** Codex-style unread marker: a thread has new content since last viewed. */
export function ConversationUnreadDot({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span
      data-unread-dot
      className={cn(
        "inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500",
        className
      )}
      title={label}
      aria-label={label}
    />
  )
}
