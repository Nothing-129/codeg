"use client"

import { useEffect } from "react"
import { detectEnvironment } from "@/lib/transport/detect"

/**
 * Registers the PWA service worker in web mode only (standalone server,
 * Docker deploy, remote-desktop access). The Tauri desktop runtime loads
 * pages from a custom scheme where service workers don't apply.
 */
export function PwaRegister() {
  useEffect(() => {
    if (detectEnvironment() !== "web") return
    if (!("serviceWorker" in navigator)) return

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // PWA is an enhancement; ignore registration failures.
      })
    }
    if (document.readyState === "complete") {
      register()
    } else {
      window.addEventListener("load", register, { once: true })
    }
  }, [])

  return null
}
