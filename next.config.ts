import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const isProd = process.env.NODE_ENV === "production"
const internalHost = process.env.TAURI_DEV_HOST || "localhost"
const withNextIntl = createNextIntlPlugin({
  requestConfig: "./src/i18n/request.ts",
  experimental: {
    messages: {
      path: "./src/i18n/messages",
      format: "json",
      locales: [
        "en",
        "zh-CN",
        "zh-TW",
        "ja",
        "ko",
        "es",
        "de",
        "fr",
        "pt",
        "ar",
      ],
      precompile: true,
    },
  },
})

// Tauri desktop webview loads the Next dev server from localhost:3000.
// Phone / LAN / tunnel preview must use relative URLs (`ASSET_PREFIX=`),
// otherwise the HTML points scripts at the phone's own localhost.
const assetPrefix =
  process.env.ASSET_PREFIX !== undefined
    ? process.env.ASSET_PREFIX || undefined
    : isProd
      ? undefined
      : `http://${internalHost}:3000`

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  assetPrefix,
}

export default withNextIntl(nextConfig)
