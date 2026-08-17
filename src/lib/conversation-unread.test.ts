import { describe, expect, it } from "vitest"
import {
  ROOT_GROUP_ID,
  splitGroup,
  singleGroupLayout,
} from "@/lib/tab-group-layout"
import {
  collectViewedConversationIds,
  isConversationActivity,
} from "./conversation-unread"

describe("isConversationActivity", () => {
  const running = { message_count: 2, status: "in_progress", child_count: 0 }
  const idle = { message_count: 2, status: "completed", child_count: 0 }

  it("is false when the activity fields are unchanged", () => {
    expect(isConversationActivity(idle, { ...idle })).toBe(false)
  })

  it("is false while the thread is still executing", () => {
    expect(
      isConversationActivity(running, { ...running, message_count: 3 })
    ).toBe(false)
    expect(
      isConversationActivity(idle, { ...idle, status: "in_progress" })
    ).toBe(false)
    expect(
      isConversationActivity(running, { ...running, child_count: 1 })
    ).toBe(false)
  })

  it("is true for settled new messages, status flips, or child-count changes", () => {
    expect(isConversationActivity(idle, { ...idle, message_count: 3 })).toBe(
      true
    )
    expect(
      isConversationActivity(running, { ...running, status: "completed" })
    ).toBe(true)
    expect(isConversationActivity(idle, { ...idle, child_count: 1 })).toBe(true)
  })
})

describe("collectViewedConversationIds", () => {
  const main = ROOT_GROUP_ID
  const tabs = [
    { id: "t1", conversationId: 1 },
    { id: "t2", conversationId: 2 },
    { id: "draft", conversationId: null },
  ]

  it("returns nothing off the conversations route", () => {
    expect(
      collectViewedConversationIds({
        isConversationsRoute: false,
        tabs,
        groupLayout: singleGroupLayout(main),
        groupOf: {},
        groupSelection: { [main]: "t1" },
        tileByGroup: {},
      })
    ).toEqual([])
  })

  it("returns the selected tab in a single group, ignoring drafts", () => {
    expect(
      collectViewedConversationIds({
        isConversationsRoute: true,
        tabs,
        groupLayout: singleGroupLayout(main),
        groupOf: {},
        groupSelection: { [main]: "t1" },
        tileByGroup: {},
      })
    ).toEqual([1])
  })

  it("returns every tab in a tiled group", () => {
    expect(
      collectViewedConversationIds({
        isConversationsRoute: true,
        tabs,
        groupLayout: singleGroupLayout(main),
        groupOf: {},
        groupSelection: { [main]: "t1" },
        tileByGroup: { [main]: true },
      })
    ).toEqual([1, 2])
  })

  it("returns each split group's selected conversation", () => {
    const other = "g-other"
    const layout = splitGroup(singleGroupLayout(main), main, "right", other)
    expect(
      collectViewedConversationIds({
        isConversationsRoute: true,
        tabs,
        groupLayout: layout,
        groupOf: { t1: main, t2: other },
        groupSelection: { [main]: "t1", [other]: "t2" },
        tileByGroup: {},
      })
    ).toEqual([1, 2])
  })
})
