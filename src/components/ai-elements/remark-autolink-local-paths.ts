// Agents constantly mention local files as PLAIN TEXT — a build-artifact table
// row like `src-tauri/target/release/bundle/dmg/Codeg_0.26.1_aarch64.dmg`, a
// `~/notes.md`, a `/var/log/x.log` — none of which markdown links. Those paths
// had no affordance at all: nothing to click, nothing to right-click, so the
// file couldn't be opened or revealed from the conversation.
//
// This plugin turns path-shaped text into real mdast `link` nodes so the
// EXISTING file-link machinery picks them up end to end: link-safety classifies
// the href as a local file, `MarkdownLink` renders it as an inline file badge,
// a left click opens it in the workspace panel, and the right-click
// `FileReferenceActions` menu reveals it in the OS file manager / copies its
// paths — zero changes needed in any of those layers.
//
// The emitted urls deliberately reuse href forms that already survive the
// downstream sanitize/harden gauntlet (see remark-file-uri-links):
//   - POSIX-absolute (`/var/log/x.log`) is emitted as-is — a leading `/`
//     keeps the href through rehype-harden and classifies as a local file;
//   - Windows drive paths are emitted slash-prefixed (`/C:/…` / `/C:\…`) so
//     `C:` stays out of protocol position for rehype-sanitize;
//   - everything relative (`src/foo.ts`, `./x.ts`, `../a.js`, `~/notes.md`)
//     cannot travel as a plain href: Streamdown re-resolves relatives against
//     the webview origin (`./src/a.ts` → `/src/a.ts` — now a wrong absolute
//     path), and a `~/…` href fails harden's `new URL` parse ("[blocked]").
//     Those are wrapped in the app's own reference grammar instead —
//     `codeg://file/<encoded path>` — which rehype-allow-codeg already lets
//     through sanitize and which MarkdownLink renders as an openable file
//     badge (same transport the composer's reference chips use);
//   - UNC (`\\server\share\…`) is NOT linkified — no href form for it
//     survives the pipeline (see the known limitation pinned in
//     message-windows-file-link.test.tsx), so the text stays plain there.
//
// Detection is deliberately conservative — a false link is worse than a missed
// one, because a click routes into local file IO:
//   - only `text` nodes are scanned; inline code, fenced code, math, html and
//     the labels of existing links are skipped (their subtree isn't visited);
//   - prose pairs like `and/or`, `TCP/IP`, `input/output` are rejected — a
//     bare-relative token must have ≥2 non-empty segments AND a final segment
//     with a file extension (`\.[A-Za-z0-9]{1,8}`);
//   - a bare-relative whose FIRST segment looks like a domain
//     (`example.com/a/b.ts`) is rejected so schemeless urls stay inert;
//   - explicitly-relative (`./`, `../`), home (`~/`) and POSIX-absolute forms
//     state path intent on their own, so they don't need an extension — but an
//     absolute path must carry ≥2 segments (`/a/b`), never just `/a`;
//   - glued CJK prose (`路径src/foo.ts。`) is trimmed at both ends before
//     validation, mirroring how remark-cjk-autolink-tail treats autolinks.

import { buildFilePathReferenceUri } from "@/components/chat/composer/reference-uri"

type MdastNodeLike = {
  type: string
  url?: unknown
  value?: unknown
  children?: unknown
}

/** Subtrees whose text must never become a link. */
const SKIP_SUBTREE = new Set([
  "link",
  "linkReference",
  "image",
  "imageReference",
  "code",
  "inlineCode",
  "math",
  "inlineMath",
  "html",
])

// One run of path-plausible characters. Everything else (spaces, quotes,
// parentheses, `,`, `;`, `!`, `?`, `=`, `&`, `#`…) is a hard boundary, so
// sentence punctuation terminates a token by construction. `:` participates
// for the drive-letter form (`E:/…`) and is vetted by pathUrlFor — prose
// times (`14:30`) and schemes (`http://…`) fail its form rules. Non-ASCII
// (CJK, fullwidth punctuation, emoji via surrogates) participates so a path
// with Chinese segments stays whole, then gets trimmed off the ENDS where it
// can only be glued prose.
const PATH_RUN = /[~A-Za-z0-9_\-.+@%:\\\u0080-\uffff/]+/g

const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/
const DOMAIN_LIKE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

/** Non-ASCII (glued prose) that may sit at either end of a matched run. */
const GLUED_LEAD = /^[\u0080-\uffff]+/
const GLUED_TAIL = /[\u0080-\uffff]+$/

/**
 * Cut a matched run down to its path token: strip glued non-ASCII prose from
 * both ends, then any sentence-period dots that survived at the tail. Returns
 * the token plus its offset within the run, or null for nothing usable.
 */
function trimGluedProse(raw: string): { token: string; start: number } | null {
  const lead = GLUED_LEAD.exec(raw)?.[0].length ?? 0
  let token = raw.slice(lead)
  const tail = GLUED_TAIL.exec(token)?.[0].length ?? 0
  if (tail) token = token.slice(0, token.length - tail)
  token = token.replace(/\.+$/, "")
  return token ? { token, start: lead } : null
}

function nonEmptySegments(path: string): string[] {
  return path.split(/[\\/]/).filter((segment) => segment.length > 0)
}

/**
 * The sanitize/harden-safe link url for a detected path token, or null when
 * the token isn't confidently a local path (see the form rules up top).
 */
function pathUrlFor(token: string): string | null {
  // `://` means the run bled into a schemeless url (`//host/…` after a `:`
  // that broke the run) — never local, never ours to link.
  if (token.includes("://")) return null

  const restAfter = (prefix: string) => {
    const rest = token.slice(prefix.length)
    return rest && !rest.startsWith("/") ? rest : null
  }

  // Home-relative and explicitly-relative forms state path intent on their
  // own — one non-empty segment after the prefix is enough, no extension.
  // They travel inside a codeg://file reference uri (see the header comment).
  if (token.startsWith("~/")) {
    return restAfter("~/") ? buildFilePathReferenceUri(token) : null
  }
  if (token.startsWith("./") || token.startsWith("../")) {
    return restAfter(token.startsWith("../") ? "../" : "./")
      ? buildFilePathReferenceUri(token)
      : null
  }

  // POSIX-absolute. `//host/…` is protocol-relative web, not a local path.
  if (token.startsWith("/")) {
    if (token.startsWith("//")) return null
    return nonEmptySegments(token).length >= 2 ? token : null
  }

  // UNC (and any other backslash-led form) — blocked downstream, stay plain.
  if (token.startsWith("\\")) return null

  // Windows drive path — slash-prefix keeps `C:` out of protocol position for
  // rehype-sanitize (mirrors remark-file-uri-links).
  if (DRIVE_PREFIX.test(token)) {
    const segments = nonEmptySegments(token)
    return segments.length >= 2 || FILE_EXTENSION.test(token)
      ? `/${token}`
      : null
  }

  // A backslash outside a drive path is not a path we can speak for.
  if (token.includes("\\")) return null

  // Bare-relative (`src/foo.ts`): the agent-table form. Require real path
  // structure — ≥2 segments, a file extension, and a first segment that
  // doesn't read like a host name.
  const segments = nonEmptySegments(token)
  if (segments.length < 2) return null
  if (!FILE_EXTENSION.test(token)) return null
  if (DOMAIN_LIKE.test(segments[0])) return null
  return buildFilePathReferenceUri(token)
}

type TextOrLink =
  | { type: "text"; value: string }
  | { type: "link"; url: string; children: { type: "text"; value: string }[] }

/**
 * Split one text node's value into kept text and minted path links. Returns
 * null when nothing matched, so the caller can keep the original node (and
 * its identity/position) untouched.
 */
function splitTextValue(value: string): TextOrLink[] | null {
  const parts: TextOrLink[] = []
  let cursor = 0
  let matched = false

  PATH_RUN.lastIndex = 0
  for (let run = PATH_RUN.exec(value); run; run = PATH_RUN.exec(value)) {
    const trimmed = trimGluedProse(run[0])
    if (!trimmed) continue
    const url = pathUrlFor(trimmed.token)
    if (!url) continue

    matched = true
    const start = run.index + trimmed.start
    if (start > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, start) })
    }
    // The visible label keeps the token exactly as typed (no `./` prefix), so
    // the message reads unchanged; only the href carries the safe form.
    parts.push({
      type: "link",
      url,
      children: [{ type: "text", value: trimmed.token }],
    })
    cursor = start + trimmed.token.length
  }

  if (!matched) return null
  if (cursor < value.length) {
    parts.push({ type: "text", value: value.slice(cursor) })
  }
  return parts
}

function autolinkLocalPaths(node: MdastNodeLike): void {
  const { children } = node
  if (!Array.isArray(children)) return

  const rebuilt: MdastNodeLike[] = []
  for (const child of children as MdastNodeLike[]) {
    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitTextValue(child.value)
      if (parts) {
        rebuilt.push(...(parts as MdastNodeLike[]))
        continue
      }
    } else if (!SKIP_SUBTREE.has(child.type)) {
      // Recurse into inline containers (paragraph, tableCell, emphasis, …)
      // but never into link/code/html subtrees.
      autolinkLocalPaths(child)
    }
    rebuilt.push(child)
  }
  node.children = rebuilt
}

export function remarkAutolinkLocalPaths() {
  return (tree: MdastNodeLike) => {
    autolinkLocalPaths(tree)
  }
}
