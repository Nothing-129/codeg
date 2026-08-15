import { describe, expect, it } from "vitest"
import type { WorkTask } from "@/lib/types"
import {
  hasNothingToMerge,
  isFolderMerging,
  isMergeQueued,
  isWorktreeGone,
  mergeQueueRanks,
  worktreeWasRemoved,
} from "./task-acceptance"

/** A parked merge, reduced to what the queue helpers actually read. */
function queued(at: string): WorkTask["merge_queued"] {
  return { message: null, delete_worktree: true, queued_at: at }
}

function task(overrides?: Partial<WorkTask>): WorkTask {
  return {
    id: 7,
    folder_id: 1,
    title: "Answer the question",
    config: null,
    status: "review",
    failure_reason: null,
    last_error: null,
    run_seq: 1,
    sort_order: 1,
    worktree_folder_id: 9,
    conversation_id: 3,
    connection_id: null,
    base_branch: "main",
    base_sha: "abc",
    work_branch: "task/7",
    cleanup_state: null,
    verdict: null,
    result_summary: null,
    files_changed: 0,
    additions: 0,
    deletions: 0,
    merge_commit: null,
    preflight: null,
    archived_at: null,
    scheduled_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    started_at: null,
    settled_at: null,
    finished_at: null,
    ...overrides,
  }
}

describe("hasNothingToMerge", () => {
  it("is true for a reviewed task whose diff came back empty", () => {
    expect(hasNothingToMerge(task())).toBe(true)
  })

  it("is false once anything changed", () => {
    expect(hasNothingToMerge(task({ files_changed: 1 }))).toBe(false)
  })

  it("keeps merge as the default when the stats are unknown", () => {
    // `null` = the engine could not read the worktree, NOT "nothing changed".
    expect(hasNothingToMerge(task({ files_changed: null }))).toBe(false)
  })

  it("only speaks for tasks that are actually up for review", () => {
    expect(hasNothingToMerge(task({ status: "running" }))).toBe(false)
    expect(hasNothingToMerge(task({ status: "done" }))).toBe(false)
  })

  it("offers complete when the worktree is gone — merge could only fail", () => {
    // Detached entirely (removed via the app)…
    expect(
      hasNothingToMerge(task({ files_changed: 3, worktree_folder_id: null }))
    ).toBe(true)
    // …or recorded but no longer usable (folder/dir removed behind the app).
    expect(
      hasNothingToMerge(task({ files_changed: 3, worktree_missing: true }))
    ).toBe(true)
    // Still only in review: elsewhere the state carries no acceptance.
    expect(
      hasNothingToMerge(
        task({ status: "running", files_changed: 3, worktree_missing: true })
      )
    ).toBe(false)
  })
})

describe("the merge queue", () => {
  it("marks only reviewed tasks that actually took a place in line", () => {
    expect(isMergeQueued(task())).toBe(false)
    expect(
      isMergeQueued(task({ merge_queued: queued("2026-08-01T10:00:00Z") }))
    ).toBe(true)
    // A dispatched merge left the queue: the row is `merging` now, and the
    // stamp it may still carry must not read as "still waiting".
    expect(
      isMergeQueued(
        task({
          status: "merging",
          merge_queued: queued("2026-08-01T10:00:00Z"),
        })
      )
    ).toBe(false)
  })

  it("numbers each project's queue by request order, ties broken by id", () => {
    const ranks = mergeQueueRanks([
      task({ id: 1, merge_queued: queued("2026-08-01T10:00:02Z") }),
      task({ id: 2, merge_queued: queued("2026-08-01T10:00:01Z") }),
      // Same instant as #2 — the backend breaks the tie by id, and so does the
      // display.
      task({ id: 3, merge_queued: queued("2026-08-01T10:00:01Z") }),
      // Another project keeps its own line.
      task({
        id: 4,
        folder_id: 2,
        merge_queued: queued("2026-08-01T10:00:05Z"),
      }),
      // Not queued at all.
      task({ id: 5 }),
    ])
    expect(ranks.get(2)).toBe(1)
    expect(ranks.get(3)).toBe(2)
    expect(ranks.get(1)).toBe(3)
    expect(ranks.get(4)).toBe(1)
    expect(ranks.has(5)).toBe(false)
  })

  it("orders by instant, not by the text of the timestamp", () => {
    // RFC 3339 with a variable number of fractional digits: "…:00Z" sorts
    // AFTER "…:00.5Z" as a string, and before it as a time.
    const ranks = mergeQueueRanks([
      task({ id: 1, merge_queued: queued("2026-08-01T10:00:00.500Z") }),
      task({ id: 2, merge_queued: queued("2026-08-01T10:00:00Z") }),
    ])
    expect(ranks.get(2)).toBe(1)
    expect(ranks.get(1)).toBe(2)
  })

  it("knows when a project's merge slot is busy", () => {
    const tasks = [task({ id: 1 }), task({ id: 2, status: "merging" })]
    expect(isFolderMerging(tasks, 1)).toBe(true)
    expect(isFolderMerging(tasks, 2)).toBe(false)
  })
})

describe("isWorktreeGone", () => {
  it("reads either the detached pointer or the backend's missing stamp", () => {
    expect(isWorktreeGone(task())).toBe(false)
    expect(isWorktreeGone(task({ worktree_folder_id: null }))).toBe(true)
    expect(isWorktreeGone(task({ worktree_missing: true }))).toBe(true)
  })
})

describe("worktreeWasRemoved", () => {
  it("tells a deleted worktree from one that never existed", () => {
    // Ran and detached — the branch is the witness a worktree once existed.
    expect(
      worktreeWasRemoved(task({ status: "done", worktree_folder_id: null }))
    ).toBe(true)
    // Recorded but no longer usable on disk.
    expect(worktreeWasRemoved(task({ worktree_missing: true }))).toBe(true)
    // Intact worktree — nothing was removed.
    expect(worktreeWasRemoved(task())).toBe(false)
    // Just created, never initialized: nothing existed to remove.
    expect(
      worktreeWasRemoved(
        task({
          status: "todo",
          worktree_folder_id: null,
          work_branch: null,
          base_branch: null,
          base_sha: null,
        })
      )
    ).toBe(false)
  })
})
