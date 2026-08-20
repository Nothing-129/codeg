import type { MetadataRoute } from "next"

// Required for `output: "export"`: metadata routes must be fully static.
export const dynamic = "force-static"

// PWA manifest, consumed by browsers in server / Docker / remote-desktop web
// mode (Tauri desktop ignores it). Follows the pi-web recipe: only
// purpose "any" (no maskable — Android otherwise adaptive-crops 66%),
// pre-rounded plate with transparent corners. `?v=` busts icon cache.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MaxCode",
    short_name: "MaxCode",
    description: "AI Coding Agent Conversation Manager",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#2a3348",
    theme_color: "#09090b",
    icons: [
      {
        src: "/icon-192.png?v=13",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png?v=13",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  }
}
