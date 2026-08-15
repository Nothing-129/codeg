import { describe, expect, it } from "vitest"
import {
  localizeReleaseNotes,
  prefersChineseReleaseNotes,
  splitBilingualReleaseNotes,
} from "./release-notes"

const ENGLISH = `# Release version 0.24.0

Make codeg yours: recolor any theme, round every corner, or write your own CSS.

## Fixed

- **Cline 3.0.50 and newer work again.** A single unrecognized config option was
  failing the whole session handshake, leaving the agent unusable (#426).`

const CHINESE = `# 发布版本 0.24.0

这一版让 codeg 长成你喜欢的样子：改配色、调圆角，或者直接写自己的 CSS。

## 修复

- **Cline 3.0.50 及以上恢复可用。** 一个无法识别的配置项导致整个会话握手失败，
  该智能体完全不可用（#426）。`

/** The separator every published release carries: twenty-nine dashes. */
const RULE = "-".repeat(29)

/** The shape every published release uses: English, separator, then Chinese. */
const BILINGUAL = `${ENGLISH}\n\n${RULE}\n\n${CHINESE}`

describe("splitBilingualReleaseNotes", () => {
  it("splits a published release body at its separator", () => {
    expect(splitBilingualReleaseNotes(BILINGUAL)).toEqual({
      english: ENGLISH,
      chinese: CHINESE,
    })
  })

  it("accepts the other separator spellings and CRLF line endings", () => {
    for (const rule of [
      RULE,
      "*".repeat(29),
      "_".repeat(29),
      "- ".repeat(29),
    ]) {
      const body = `${ENGLISH}\n\n${rule}\n\n${CHINESE}`.replace(/\n/g, "\r\n")
      expect(splitBilingualReleaseNotes(body), rule).toEqual({
        english: ENGLISH,
        chinese: CHINESE,
      })
    }
  })

  it("keeps an English-only release whole, separator and all", () => {
    const body = `${ENGLISH}\n\n${RULE}\n\nMore English, no translation here.`
    expect(splitBilingualReleaseNotes(body)).toEqual({
      english: null,
      chinese: null,
    })
  })

  it("ignores an ordinary rule dividing the English half", () => {
    const body = `${ENGLISH}\n\n---\n\nStill English.\n\n${RULE}\n\n${CHINESE}`
    const split = splitBilingualReleaseNotes(body)
    expect(split.english).toContain("Still English.")
    expect(split.chinese).toBe(CHINESE)
  })

  it("ignores a separator inside a fenced code block", () => {
    const sample = `\`\`\`\n${RULE}\n\`\`\``
    const body = `${ENGLISH}\n\n${sample}\n\n${RULE}\n\n${CHINESE}`
    const split = splitBilingualReleaseNotes(body)
    expect(split.english).toBe(`${ENGLISH}\n\n${sample}`)
    expect(split.chinese).toBe(CHINESE)
  })

  it("keeps a long fence open across a shorter fence line inside it", () => {
    // CommonMark closes a block only on a run at least as long as the opener,
    // so the inner ``` and the separator under it are both still sample text.
    const sample = `\`\`\`\`\n\`\`\`\n${RULE}\n\`\`\`\``
    const body = `${ENGLISH}\n\n${sample}\n\n${RULE}\n\n${CHINESE}`
    const split = splitBilingualReleaseNotes(body)
    expect(split.english).toBe(`${ENGLISH}\n\n${sample}`)
    expect(split.chinese).toBe(CHINESE)
  })

  it("does not open a block on a backtick run carrying backticks", () => {
    const body = `${ENGLISH}\n\n\`\`\`a\`b\n\n${RULE}\n\n${CHINESE}`
    expect(splitBilingualReleaseNotes(body).chinese).toBe(CHINESE)
  })

  it("does not close a block on a fence line carrying an info string", () => {
    const sample = `\`\`\`\n${RULE}\n\`\`\`json\n{ "still": "inside" }\n\`\`\``
    const body = `${ENGLISH}\n\n${sample}\n\n${RULE}\n\n${CHINESE}`
    const split = splitBilingualReleaseNotes(body)
    expect(split.english).toBe(`${ENGLISH}\n\n${sample}`)
    expect(split.chinese).toBe(CHINESE)
  })

  it("keeps English-only notes whole when they end with a Chinese section", () => {
    // All the Han sits on one side of the rule, exactly as in a translated body,
    // and the section can be built like the notes above it — same heading level,
    // even the same version. Only the separator itself tells the two apart.
    for (const heading of [
      "## zh-CN example",
      "# zh-CN example",
      "## zh-CN example for 1.0",
      "# zh-CN example for 1.0",
    ]) {
      const body = [
        "# Release version 1.0",
        "",
        "Improved localization handling.",
        "",
        "---",
        "",
        heading,
        "",
        "更新检查现在显示正确的版本号。",
      ].join("\n")
      expect(splitBilingualReleaseNotes(body), heading).toEqual({
        english: null,
        chinese: null,
      })
      expect(localizeReleaseNotes(body, "zh-CN"), heading).toBe(body)
      expect(localizeReleaseNotes(body, "en"), heading).toBe(body)
    }
  })

  it("does not split a separator with the same language on both sides", () => {
    const body = `${ENGLISH}\n\n${RULE}\n\n${ENGLISH}`
    expect(splitBilingualReleaseNotes(body)).toEqual({
      english: null,
      chinese: null,
    })
  })

  it("ignores an ordinary rule dividing the Chinese half", () => {
    const body = `${ENGLISH}\n\n${RULE}\n\n${CHINESE}\n\n---\n\n另有说明，见文档。`
    const split = splitBilingualReleaseNotes(body)
    expect(split.english).toBe(ENGLISH)
    expect(split.chinese).toBe(`${CHINESE}\n\n---\n\n另有说明，见文档。`)
  })

  it("reads the halves in either order", () => {
    const body = `${CHINESE}\n\n${RULE}\n\n${ENGLISH}`
    expect(splitBilingualReleaseNotes(body)).toEqual({
      english: ENGLISH,
      chinese: CHINESE,
    })
  })

  it("splits a hotfix release down to one line per language", () => {
    const english = "# Release version 0.24.1\n\nFixed a crash on launch."
    const chinese = "# 发布版本 0.24.1\n\n修复了启动时的崩溃。"
    expect(
      splitBilingualReleaseNotes(`${english}\n\n${RULE}\n\n${chinese}`)
    ).toEqual({ english, chinese })
  })

  it("does not mistake a passing Chinese word for a translated half", () => {
    const body = `${ENGLISH}\n\n${RULE}\n\nThe 中文 locale files moved.`
    expect(splitBilingualReleaseNotes(body)).toEqual({
      english: null,
      chinese: null,
    })
  })

  it("does not split a body with no separator at all", () => {
    expect(splitBilingualReleaseNotes(`${ENGLISH}\n\n${CHINESE}`)).toEqual({
      english: null,
      chinese: null,
    })
  })

  it("does not split on a dash run underlining a paragraph", () => {
    // CommonMark reads this as a heading underline for the line above it, so
    // there is no break here to split on however long the run is.
    const body = [
      "# Release version 1.0",
      "",
      "Improved localization handling.",
      "",
      "zh-CN example for 1.0",
      RULE,
      "",
      "更新检查现在显示正确的版本号。",
    ].join("\n")
    expect(splitBilingualReleaseNotes(body)).toEqual({
      english: null,
      chinese: null,
    })
    expect(localizeReleaseNotes(body, "zh-CN")).toBe(body)
    expect(localizeReleaseNotes(body, "en")).toBe(body)
  })

  it("does not split on a rule too short to be the separator", () => {
    for (const rule of ["---", "-".repeat(11)]) {
      expect(
        splitBilingualReleaseNotes(`${ENGLISH}\n\n${rule}\n\n${CHINESE}`),
        rule
      ).toEqual({ english: null, chinese: null })
    }
  })

  it("needs text on both sides of the separator", () => {
    expect(splitBilingualReleaseNotes(`${CHINESE}\n\n${RULE}\n`)).toEqual({
      english: null,
      chinese: null,
    })
  })

  it("keeps the later of two adjacent separators", () => {
    const body = `${ENGLISH}\n\n${RULE}\n\n${RULE}\n\n${CHINESE}`
    expect(splitBilingualReleaseNotes(body).chinese).toBe(CHINESE)
  })
})

describe("prefersChineseReleaseNotes", () => {
  it("covers both Chinese locales in both spellings", () => {
    for (const locale of ["zh-CN", "zh-TW", "zh_cn", "zh_tw", "zh", "ZH-CN"]) {
      expect(prefersChineseReleaseNotes(locale)).toBe(true)
    }
  })

  it("leaves every other shipped locale on English", () => {
    for (const locale of ["en", "ja", "ko", "es", "de", "fr", "pt", "ar"]) {
      expect(prefersChineseReleaseNotes(locale)).toBe(false)
    }
  })
})

describe("localizeReleaseNotes", () => {
  it("gives a Chinese interface the Chinese half", () => {
    expect(localizeReleaseNotes(BILINGUAL, "zh-CN")).toBe(CHINESE)
    expect(localizeReleaseNotes(BILINGUAL, "zh-TW")).toBe(CHINESE)
  })

  it("gives every other interface the English half", () => {
    for (const locale of ["en", "ja", "de", "ar"]) {
      expect(localizeReleaseNotes(BILINGUAL, locale)).toBe(ENGLISH)
    }
  })

  it("falls back to the whole body when it isn't bilingual", () => {
    for (const body of [
      `${ENGLISH}\n\n${RULE}\n\nMore English.`, // separator, one language
      `${ENGLISH}\n\n---\n\n${CHINESE}`, // two languages, no separator
    ]) {
      expect(localizeReleaseNotes(body, "zh-CN"), body).toBe(body)
      expect(localizeReleaseNotes(body, "en"), body).toBe(body)
    }
  })

  it("returns nothing for a release with no notes", () => {
    expect(localizeReleaseNotes("", "en")).toBe("")
    expect(localizeReleaseNotes("   \n\n ", "zh-CN")).toBe("")
  })
})
