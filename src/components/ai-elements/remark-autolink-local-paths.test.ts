import { describe, expect, it } from "vitest"
import { remarkAutolinkLocalPaths } from "./remark-autolink-local-paths"
import {
  buildFilePathReferenceUri,
  parseFilePathReferenceUri,
} from "@/components/chat/composer/reference-uri"

// Minimal mdast node shapes for the transform.
type Node = {
  type: string
  url?: string
  value?: string
  children?: Node[]
}

function textTree(value: string): Node {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value }],
      },
    ],
  }
}

function run(tree: Node): void {
  remarkAutolinkLocalPaths()(tree)
}

/** All minted links as `url|label` pairs, in document order. */
function links(tree: Node): string[] {
  const found: string[] = []
  const walk = (n: Node) => {
    if (n.type === "link" && n.url) {
      const label = (n.children ?? []).map((c) => c.value ?? "").join("")
      found.push(`${n.url}|${label}`)
    }
    n.children?.forEach(walk)
  }
  walk(tree)
  return found
}

/** Concatenation of all text outside links (the kept prose). */
function keptText(tree: Node): string {
  const parts: string[] = []
  const walk = (n: Node) => {
    // A link's label is display text, not kept prose.
    if (n.type === "link") return
    if (n.type === "text" && n.value) parts.push(n.value)
    n.children?.forEach(walk)
  }
  walk(tree)
  return parts.join("")
}

function autolink(value: string): { links: string[]; text: string } {
  const tree = textTree(value)
  run(tree)
  return { links: links(tree), text: keptText(tree) }
}

const file = (path: string) => buildFilePathReferenceUri(path)

describe("remarkAutolinkLocalPaths — linkified forms", () => {
  it("wraps a bare-relative agent-table path in a codeg://file uri", () => {
    const path = "src-tauri/target/release/bundle/dmg/Codeg_0.26.1_aarch64.dmg"
    const { links: out, text } = autolink(path)
    // A plain href would be re-resolved against the webview origin
    // (`./src-tauri/…` → `/src-tauri/…`); the codeg://file transport keeps
    // the folder-relative semantics intact. The label stays exactly as typed.
    expect(out).toEqual([`${file(path)}|${path}`])
    expect(text).toBe("")
  })

  it("round-trips the wrapped path through the uri grammar", () => {
    expect(parseFilePathReferenceUri(file("src/a b/手册.ts"))).toBe(
      "src/a b/手册.ts"
    )
  })

  it("links a plain two-segment relative path", () => {
    expect(autolink("see src/foo.ts for details").links).toEqual([
      `${file("src/foo.ts")}|src/foo.ts`,
    ])
  })

  it("links POSIX-absolute paths with ≥2 segments, href unchanged", () => {
    expect(autolink("log at /var/log/app.log").links).toEqual([
      "/var/log/app.log|/var/log/app.log",
    ])
  })

  it("rejects a single-segment absolute path", () => {
    expect(autolink("chmod /etc").links).toEqual([])
  })

  it("wraps ~/ and ./ ../ forms (plain hrefs for them don't survive)", () => {
    expect(autolink("见 ~/notes.md").links).toEqual([
      `${file("~/notes.md")}|~/notes.md`,
    ])
    expect(autolink("run ./build.sh").links).toEqual([
      `${file("./build.sh")}|./build.sh`,
    ])
    expect(autolink("from ../lib/a.js").links).toEqual([
      `${file("../lib/a.js")}|../lib/a.js`,
    ])
  })

  it("leaves Windows drive paths inert (forward and back slashes)", () => {
    expect(autolink("打开 C:\\Users\\a\\手册.docx").links).toEqual([])
    expect(autolink("open E:/Desktop/docs/G.docx").links).toEqual([])
  })
})

describe("remarkAutolinkLocalPaths — rejected prose", () => {
  it("leaves slash-joined word pairs alone", () => {
    expect(autolink("and/or").links).toEqual([])
    expect(autolink("TCP/IP").links).toEqual([])
    expect(autolink("input/output").links).toEqual([])
  })

  it("leaves a bare filename (no slash) alone", () => {
    expect(autolink("generated 手册.docx here").links).toEqual([])
  })

  it("leaves extension-less relative paths alone", () => {
    expect(autolink("see docs/archive").links).toEqual([])
  })

  it("leaves domain-led and web-ish tokens alone", () => {
    expect(autolink("fetch example.com/a/b.ts").links).toEqual([])
    expect(autolink("via https://example.com/a.ts").links).toEqual([])
    expect(autolink("//host/share/a.ts").links).toEqual([])
    expect(autolink("\\\\server\\share\\a.ts").links).toEqual([])
  })

  it("keeps a sentence period out of the token", () => {
    const { links: out, text } = autolink("see src/foo.ts.")
    expect(out).toEqual([`${file("src/foo.ts")}|src/foo.ts`])
    expect(text).toBe("see .")
  })
})

describe("remarkAutolinkLocalPaths — glued CJK prose", () => {
  it("trims CJK prose glued to both ends", () => {
    const { links: out, text } = autolink(
      "产物在src-tauri/target/dmg.codeg.dmg。收好"
    )
    expect(out).toEqual([
      `${file("src-tauri/target/dmg.codeg.dmg")}|src-tauri/target/dmg.codeg.dmg`,
    ])
    expect(text).toBe("产物在。收好")
  })

  it("keeps a Chinese Windows path inert", () => {
    expect(autolink("文件在 E:/桌面/使用手册/G手册.docx 处").links).toEqual([])
  })
})

describe("remarkAutolinkLocalPaths — subtree skips", () => {
  it("does not touch inline code, fenced code, html, or link labels", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "inlineCode", value: "src/foo.ts" },
            { type: "text", value: " then " },
            { type: "html", value: "<b>src/bar.ts</b>" },
            {
              type: "link",
              url: "https://example.com",
              children: [{ type: "text", value: "src/baz.ts" }],
            },
            { type: "text", value: " real src/qux.ts" },
          ],
        },
        { type: "code", value: "src/fenced.ts" },
      ],
    }
    run(tree)
    // The pre-existing link survives untouched (same url, label not
    // re-linkified); the only minted link is the free-standing text.
    expect(links(tree)).toEqual([
      "https://example.com|src/baz.ts",
      `${file("src/qux.ts")}|src/qux.ts`,
    ])
  })

  it("recurses through inline containers (emphasis, table cells)", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "tableCell",
          children: [
            {
              type: "emphasis",
              children: [{ type: "text", value: "row src/cell/a.ts end" }],
            },
          ],
        },
      ],
    }
    run(tree)
    expect(links(tree)).toEqual([`${file("src/cell/a.ts")}|src/cell/a.ts`])
  })
})
