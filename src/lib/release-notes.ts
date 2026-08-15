/**
 * codeg publishes every release in two languages inside one markdown body: the
 * English notes, a thematic break on its own line, then the Chinese
 * translation. Rendering the whole document means half of it is always a
 * translation the reader can't use — and in the status-bar popover, which shows
 * the notes in a 320px column, that half is what they have to scroll past to
 * reach the buttons. So the UI keeps the half that matches the interface
 * language.
 *
 * The boundary is the long rule the publishing format puts between the halves,
 * and nothing subtler. Guessing it instead — from where the Chinese starts, or
 * from which sections look alike — cannot be made safe: a section written in
 * Chinese at the end of otherwise English notes puts all the Han on one side of
 * a rule exactly like a translation does, and it can carry the same heading, the
 * same shape, even the same version number. Every such guess has a document that
 * defeats it, and defeating it truncates the notes for both readers, which is
 * worse than showing both languages. The rule is instead something the author
 * types on purpose, so it is read as what it is: a marker.
 *
 * What counts as one is a rule far longer than the `---` anyone writes to divide
 * a section — see {@link LANGUAGE_SEPARATOR}. Notes that don't carry one, or
 * whose halves don't actually read in different languages, render whole, as they
 * did before this existed.
 */

/**
 * The rule separating the two languages: a run of at least twelve dashes,
 * asterisks or underscores on a line of its own. Releases are published with
 * twenty-nine dashes and carry no other rule at all, so length is what tells the
 * marker from ordinary punctuation — a `---` dividing two English sections is
 * not a language boundary, and treating it as one hides everything below it.
 * Twelve sits clear of both: well past anything typed to break up a paragraph,
 * well short of the published separator.
 *
 * Matching the line is not enough on its own; see {@link isSeparatorAt}.
 */
const LANGUAGE_SEPARATOR =
  /^ {0,3}(?:(?:-[ \t]*){12,}|(?:\*[ \t]*){12,}|(?:_[ \t]*){12,})$/

/**
 * A line opening or closing a fenced code block, captured as the delimiter run
 * plus whatever follows it. Both are needed to apply CommonMark's closing rules
 * — see the fence bookkeeping in {@link splitBilingualReleaseNotes}.
 */
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * Han ideographs, plus the CJK punctuation and fullwidth forms Chinese prose is
 * written with (、。「」（）). All of it is absent from the English half, which
 * is what makes it the signal the split is scored on.
 */
const CJK_CHARS =
  /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uffef]/g

const LATIN_LETTERS = /[A-Za-z]/g

/**
 * How much more Chinese one side must be than the other before the break
 * between them counts as the language boundary. Across every release published
 * so far the real boundary scores 0.58 or higher, while a horizontal rule
 * inside a single-language section scores near zero.
 */
const MIN_LANGUAGE_CONTRAST = 0.3

export interface BilingualReleaseNotes {
  /** The English half, or null when the body isn't bilingual. */
  english: string | null
  /** The Chinese half, or null when the body isn't bilingual. */
  chinese: string | null
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/**
 * Whether `lines[index]` is the separator rather than a line that merely looks
 * like one. A run of dashes written directly under a paragraph is not a rule at
 * all — CommonMark reads it as that paragraph's heading underline — so a line
 * can match {@link LANGUAGE_SEPARATOR} while the document has no break there to
 * split on. Requiring the blank line above is what tells the two apart, and
 * every release publishes its separator that way.
 */
function isSeparatorAt(lines: string[], index: number): boolean {
  if (!LANGUAGE_SEPARATOR.test(lines[index])) return false
  return index === 0 || lines[index - 1].trim() === ""
}

/** Share of the text's letters that are Chinese, ignoring digits and markup. */
function cjkRatio(text: string): number {
  const cjk = count(text, CJK_CHARS)
  if (cjk === 0) return 0
  return cjk / (cjk + count(text, LATIN_LETTERS))
}

/**
 * Split a bilingual release body into its two halves, dropping the separator
 * between them. Returns both halves as null when the body carries no separator,
 * or carries one that doesn't divide two languages — an English-only release, or
 * notes not published in the bilingual format.
 */
export function splitBilingualReleaseNotes(
  body: string
): BilingualReleaseNotes {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")
  const section = (start: number, end?: number) =>
    lines.slice(start, end).join("\n").trim()

  let best: { english: string; chinese: string; score: number } | null = null
  let openFence: { char: string; length: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // A separator inside a fenced block is sample text — so the fence has to be
    // tracked by CommonMark's rules, not just by "seen a fence line". A run
    // shorter than the opening one, or one carrying an info string, is content
    // within the block; treating it as the close would expose the lines below it
    // and let one of them split the notes.
    const fence = CODE_FENCE.exec(line)
    if (fence) {
      const [, run, rest] = fence
      const char = run[0]
      if (openFence === null) {
        // A backtick fence may not carry a backtick in its info string; such a
        // line is ordinary text, and opening a block on it would swallow the
        // rest of the notes.
        if (char !== "`" || !rest.includes("`")) {
          openFence = { char, length: run.length }
        }
      } else if (
        char === openFence.char &&
        run.length >= openFence.length &&
        rest.trim() === ""
      ) {
        openFence = null
      }
      continue
    }
    if (openFence !== null || !isSeparatorAt(lines, i)) continue

    const before = section(0, i)
    const after = section(i + 1)
    if (!before || !after) continue

    // Which half is which, and a floor under how differently the two read: a
    // separator with the same language on both sides is dividing sections, not
    // translations, and splitting there would hide one of them.
    const beforeRatio = cjkRatio(before)
    const afterRatio = cjkRatio(after)
    const score = Math.abs(afterRatio - beforeRatio)
    if (score < MIN_LANGUAGE_CONTRAST) continue

    const chineseIsSecond = afterRatio > beforeRatio

    // An equal score keeps the LATER separator, which is what pushes a stray one
    // sitting next to the real one into the discarded middle rather than into
    // the half that follows it.
    if (best !== null && score < best.score) continue
    best = {
      english: chineseIsSecond ? before : after,
      chinese: chineseIsSecond ? after : before,
      score,
    }
  }

  return best
    ? { english: best.english, chinese: best.chinese }
    : { english: null, chinese: null }
}

/**
 * Whether `locale` reads the Chinese half. Both Chinese locales the app ships
 * (`zh-CN`, `zh-TW`) do; every other language falls back to English, the only
 * other half a release carries. Accepts the app's own `zh_cn` spelling as well
 * as the BCP-47 tag next-intl hands out.
 */
export function prefersChineseReleaseNotes(locale: string): boolean {
  return locale.toLowerCase().split(/[-_]/)[0] === "zh"
}

/**
 * The half of `body` to render for `locale` — or the whole body, when it isn't
 * the bilingual shape releases are published in.
 */
export function localizeReleaseNotes(body: string, locale: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ""

  const { english, chinese } = splitBilingualReleaseNotes(trimmed)
  const preferred = prefersChineseReleaseNotes(locale) ? chinese : english
  return preferred ?? trimmed
}
