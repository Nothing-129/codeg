import type { MetadataRoute } from "next"

// Required for `output: "export"`: metadata routes must be fully static.
export const dynamic = "force-static"

// PWA manifest, consumed by browsers in server / Docker / remote-desktop web
// mode (Tauri desktop ignores it). Icons are full-bleed near-black so the
// install splash blends into the app's dark theme; the maskable variants keep
// the mark inside the platform safe zone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Codeg",
    short_name: "Codeg",
    description: "AI Coding Agent Conversation Manager",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#000105",
    theme_color: "#09090b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
