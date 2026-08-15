"use client"

import { useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { useTheme } from "next-themes"
import { Toaster, type ToasterProps } from "sonner"

/** Client-only gate that survives hydration: `false` on the server AND on the
 *  hydration pass, `true` on the first render after it — so the portal below
 *  never makes the two disagree. */
const subscribeNever = () => () => {}
const onClient = () => true
const onServer = () => false

export function AppToaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()
  const theme = props.theme ?? (resolvedTheme === "dark" ? "dark" : "light")
  const mounted = useSyncExternalStore(subscribeNever, onClient, onServer)

  if (!mounted) return null
  // Portalled to the body, because sonner's z-index is only worth what its
  // stacking context is: the workspace shell's root is `fixed inset-0`, which
  // establishes one, and every dialog portals to the body at z-50 — so a toast
  // raised while a dialog is open (the error that explains why the button did
  // nothing) painted UNDER it. In the body the toaster sits in the root
  // stacking context, above every overlay, wherever it is mounted from.
  return createPortal(<Toaster {...props} theme={theme} />, document.body)
}
