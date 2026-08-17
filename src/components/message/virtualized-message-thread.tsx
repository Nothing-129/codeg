"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode, RefObject } from "react"
import { Virtualizer, type VirtualizerHandle } from "virtua"
import { useStickToBottomContext } from "use-stick-to-bottom"
import { Loader2 } from "lucide-react"
import {
  MessageThreadContent,
  type MessageThreadContentProps,
} from "@/components/ai-elements/message-thread"
import { cn } from "@/lib/utils"
import {
  MessageScrollProvider,
  type MessageScrollContextValue,
} from "@/components/message/message-scroll-context"

/**
 * Scroll offset (px from the top) under which a reverse-infinite-scroll load
 * is triggered. Fired on the downward CROSSING of this threshold (scrolling
 * up), never on absolute position — so the initial instant stick-to-bottom
 * (which starts at offset 0 before the first layout) and short lists that
 * never scroll cannot auto-trigger a cascade of page loads.
 */
const LOAD_OLDER_THRESHOLD_PX = 240

interface VirtualizedMessageThreadProps<T> {
  /** Data to virtualise — each entry becomes one virtual row. */
  items: T[]
  /** Stable key for a given item (used as React key). */
  getItemKey: (item: T, index: number) => string
  /** Render the content of one row. */
  renderItem: (item: T, index: number) => ReactNode
  /** Shown when `items` is empty. */
  emptyState?: ReactNode
  /**
   * Hint for the initial height (px) of an unmeasured item.
   * Virtua auto-measures every item once mounted, so this only
   * affects the very first paint — omit it if you don't care.
   */
  itemSize?: number
  /**
   * Pixels of overscan around the viewport (virtua `bufferSize`).
   * Larger values reduce blank flashes during fast scroll on tall rows
   * at the cost of more off-screen reconciliation. @default 800
   */
  bufferSize?: number
  /** Vertical gap between items in px. @default 16 */
  gap?: number
  /** Vertical padding before the first / after the last item. @default 16 */
  padding?: number
  /** Extra className on every item's inner wrapper (the `max-w-3xl` div). */
  className?: string
  /** Extra className on the MessageThreadContent shell. */
  contentClassName?: string
  /** Extra props forwarded to MessageThreadContent. */
  contentProps?: Omit<MessageThreadContentProps, "children" | "className">
  /**
   * Publishes the virtualizer scroll handle to an ancestor so siblings that
   * live outside the `MessageScrollProvider` subtree (e.g. the conversation
   * message navigator) can drive `scrollToIndex`.
   */
  scrollApiRef?: RefObject<MessageScrollContextValue | null>
  /**
   * Reverse infinite scroll: older items exist above `items[0]`. Renders a
   * loader row above the list and arms the near-top trigger. The row is also
   * a button, so a window shorter than the viewport (nothing to scroll) can
   * still page in history.
   */
  hasOlder?: boolean
  /** An older-page request is in flight (spinner state on the loader row). */
  isLoadingOlder?: boolean
  /** Called on the near-top crossing / loader click to page in history. */
  onLoadOlder?: () => void
  /** Loader-row labels (i18n: idle button text / loading text). */
  loadOlderLabel?: string
  loadingOlderLabel?: string
  /**
   * Explicit prepend signal driving virtua's `shift`: bumped by the data
   * layer on every render whose `items` gained prepended history, scoped by
   * `prependScopeKey` (a conversation id) so a scope switch — a different
   * conversation's list replacing this one wholesale — never reads as a
   * prepend. An explicit signal, NOT a key heuristic: a window starting
   * mid-way through a consecutive-assistant run merges with prepended turns
   * into one render item whose key changes, so "did the old first key
   * survive" is false on exactly the render that must shift.
   */
  prependEpoch?: number
  prependScopeKey?: string | number
}

/**
 * `shift` decision for one render: same scope, epoch advanced. Exported for
 * unit tests.
 */
export function shouldShiftForPrepend(
  prev: { scope: string | number | undefined; epoch: number },
  next: { scope: string | number | undefined; epoch: number }
): boolean {
  return prev.scope === next.scope && next.epoch !== prev.epoch
}

function VirtualizedMessageThreadImpl<T>({
  items,
  getItemKey,
  renderItem,
  emptyState,
  itemSize,
  bufferSize = 800,
  gap = 16,
  padding = 16,
  className,
  contentClassName,
  contentProps,
  scrollApiRef,
  hasOlder = false,
  isLoadingOlder = false,
  onLoadOlder,
  loadOlderLabel,
  loadingOlderLabel,
  prependEpoch = 0,
  prependScopeKey,
}: VirtualizedMessageThreadProps<T>) {
  const { scrollRef } = useStickToBottomContext()
  const virtualizerHandleRef = useRef<VirtualizerHandle>(null)

  // The loader row occupies virtua index 0 when present, shifting every data
  // item's virtual index by one — account for it in scrollToIndex so nav
  // targets (computed over `items`) keep landing on the right row. Mirrored
  // into a ref post-commit (see the sync effect below); scrollToIndex only
  // runs from user interactions, so it always reads a committed value.
  const rowOffset = hasOlder ? 1 : 0
  const rowOffsetRef = useRef(rowOffset)

  const scrollToIndex = useCallback<MessageScrollContextValue["scrollToIndex"]>(
    (index, opts) => {
      virtualizerHandleRef.current?.scrollToIndex(
        index + rowOffsetRef.current,
        opts
      )
    },
    []
  )
  const scrollContextValue = useMemo<MessageScrollContextValue>(
    () => ({ scrollToIndex }),
    [scrollToIndex]
  )

  // Mirror the (stable) scroll handle into the caller-owned ref so a sibling
  // rendered outside this provider can call it. Runs once since the value is
  // referentially stable.
  useEffect(() => {
    if (!scrollApiRef) return
    scrollApiRef.current = scrollContextValue
    return () => {
      scrollApiRef.current = null
    }
  }, [scrollApiRef, scrollContextValue])

  // virtua's `shift` for reverse infinite scroll, derived from the explicit
  // prepend signal (see the prop doc — key heuristics fail under cross-page
  // assistant-run merges). Derived-state-during-render pattern (not a ref —
  // refs must not be read in render): when the signal moves, re-render
  // immediately so the COMMITTED render of the prepended children carries
  // `shift=true` and virtua anchors the viewport to the end instead of
  // jumping. The stored flag persists only across renders with an identical
  // signal (subsequent renders reuse the same children or replace them via a
  // signal-less update, where shift must read false again once items move).
  const [prependMark, setPrependMark] = useState<{
    scope: string | number | undefined
    epoch: number
    items: T[]
    shift: boolean
  }>({ scope: prependScopeKey, epoch: prependEpoch, items, shift: false })
  if (
    prependMark.items !== items ||
    prependMark.epoch !== prependEpoch ||
    prependMark.scope !== prependScopeKey
  ) {
    setPrependMark({
      scope: prependScopeKey,
      epoch: prependEpoch,
      items,
      shift: shouldShiftForPrepend(
        { scope: prependMark.scope, epoch: prependMark.epoch },
        { scope: prependScopeKey, epoch: prependEpoch }
      ),
    })
  }
  const shift =
    prependMark.items === items &&
    prependMark.epoch === prependEpoch &&
    prependMark.scope === prependScopeKey
      ? prependMark.shift
      : false

  // Near-top trigger, armed only on the downward CROSSING of the threshold —
  // see LOAD_OLDER_THRESHOLD_PX. Prop values are mirrored into a ref
  // post-commit so the scroll handler stays referentially stable across
  // streaming re-renders; scroll events only fire after commit.
  const loadOlderStateRef = useRef({ hasOlder, isLoadingOlder, onLoadOlder })
  useEffect(() => {
    rowOffsetRef.current = rowOffset
    loadOlderStateRef.current = { hasOlder, isLoadingOlder, onLoadOlder }
  })
  const prevScrollOffsetRef = useRef<number | null>(null)
  const handleScroll = useCallback((offset: number) => {
    const prev = prevScrollOffsetRef.current
    prevScrollOffsetRef.current = offset
    const s = loadOlderStateRef.current
    if (!s.hasOlder || s.isLoadingOlder || !s.onLoadOlder) return
    if (
      offset < LOAD_OLDER_THRESHOLD_PX &&
      prev !== null &&
      prev >= LOAD_OLDER_THRESHOLD_PX
    ) {
      s.onLoadOlder()
    }
  }, [])

  // Make the scroll viewport focusable so the browser's native keyboard
  // scrolling (Arrow keys, PageUp/PageDown, Home/End, Space) works — matching
  // the sidebar conversation list, whose card <button>s are focusable and let
  // the browser scroll their scrollable ancestor. A left-click on
  // non-interactive transcript content focuses the viewport so the keys engage,
  // without stealing focus from interactive controls (links, buttons, inputs)
  // or breaking text selection (focus() doesn't clear a selection).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.tabIndex = 0
    const onPointerDown = (e: PointerEvent) => {
      // Ignore right-click and macOS ctrl-click (both open the context menu).
      if (e.button !== 0 || e.ctrlKey) return
      const target = e.target as HTMLElement | null
      // Don't steal focus from interactive/editable elements — they manage
      // their own focus (some do it in pointerdown). We deliberately do NOT
      // match a bare `[tabindex]` here: the viewport itself has tabIndex=0, so
      // an ancestor match would suppress focusing on every transcript click.
      if (
        target?.closest(
          'a[href],button,input,textarea,select,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[role="textbox"],[role="menuitem"],[role="option"],[role="combobox"],[role="slider"]'
        )
      )
        return
      el.focus({ preventScroll: true })
    }
    el.addEventListener("pointerdown", onPointerDown)
    return () => {
      el.removeEventListener("pointerdown", onPointerDown)
    }
  }, [scrollRef])

  // Pre-compute the three possible padding styles so every render reuses
  // the same object references (avoids allocating per-item on each frame).
  const styles = useMemo(() => {
    const halfGap = gap / 2
    return {
      only: { paddingTop: padding, paddingBottom: padding } as CSSProperties,
      first: { paddingTop: padding, paddingBottom: halfGap } as CSSProperties,
      middle: { paddingTop: halfGap, paddingBottom: halfGap } as CSSProperties,
      last: { paddingTop: halfGap, paddingBottom: padding } as CSSProperties,
    }
  }, [gap, padding])

  const itemStyle = (index: number, total: number) => {
    if (total === 1) return styles.only
    if (index === 0) return styles.first
    if (index === total - 1) return styles.last
    return styles.middle
  }

  return (
    <MessageScrollProvider value={scrollContextValue}>
      <MessageThreadContent
        className={cn("mx-0 max-w-none p-0", contentClassName)}
        scrollClassName="scrollbar-thin overscroll-contain [overflow-anchor:none] outline-none"
        {...contentProps}
      >
        {items.length === 0 ? (
          (emptyState ?? null)
        ) : (
          <Virtualizer
            ref={virtualizerHandleRef}
            scrollRef={scrollRef as unknown as RefObject<HTMLElement | null>}
            itemSize={itemSize}
            bufferSize={bufferSize}
            shift={shift}
            onScroll={handleScroll}
          >
            {hasOlder ? (
              <div key="load-older-row" style={styles.first}>
                <div className={cn("mx-auto max-w-3xl px-4", className)}>
                  <button
                    type="button"
                    onClick={isLoadingOlder ? undefined : onLoadOlder}
                    disabled={isLoadingOlder}
                    className="mx-auto flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-muted/40"
                  >
                    {isLoadingOlder ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {loadingOlderLabel}
                      </>
                    ) : (
                      loadOlderLabel
                    )}
                  </button>
                </div>
              </div>
            ) : null}
            {items.map((item, index) => (
              <div
                key={getItemKey(item, index)}
                style={itemStyle(index, items.length)}
              >
                <div className={cn("mx-auto max-w-3xl px-4", className)}>
                  {renderItem(item, index)}
                </div>
              </div>
            ))}
          </Virtualizer>
        )}
      </MessageThreadContent>
    </MessageScrollProvider>
  )
}

// Memoized so a cross-tab broadcast render of MessageListView with an
// unchanged `items` reference (see getTimelineTurns memoization) skips the
// per-row React element creation entirely. The streaming tab's `items`
// reference changes every flush, so it re-renders as before. `getItemKey` /
// `renderItem` are stabilized by the caller; default shallow prop comparison
// is sufficient. The `as` cast preserves the generic call signature that
// `memo` would otherwise erase.
export const VirtualizedMessageThread = memo(
  VirtualizedMessageThreadImpl
) as typeof VirtualizedMessageThreadImpl
