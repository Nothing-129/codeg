/**
 * Always-on selected chrome for the conversation composer.
 *
 * Both conversation locations render this through `<ChatInput>` →
 * `<MessageInput>`:
 *   1. the new-conversation (welcome) input in the empty-state column
 *   2. the same input after the first send, docked at the bottom of the thread
 *
 * The box already looks ready to type. Do not add a click-only
 * `focus-within` ring — that is the style this module replaces.
 */
export const COMPOSER_CHROME_BOX_CLASS =
  "codeg-composer-chrome relative rounded-2xl border border-foreground/15"

export const COMPOSER_CHROME_SHADOW_CLASS =
  "shadow-[0_1px_3px_rgba(15,23,42,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]"

/** Opaque surface that still goes transparent over a workspace background. */
export const COMPOSER_CHROME_SURFACE_CLASS = "bg-background ws-transparent-bg"
