// @ts-check
import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"
import { optimizeTablerIconsImport } from "./src/plugins/vite-plugin-optimize-tabler-icons.ts"
import { viteCorsProxyPlugin } from "./src/plugins/vite-plugin-cors-proxy.ts"
import svelte from "@astrojs/svelte"

const hmrHost = process.env.XTREAM_HMR_HOST

export default defineConfig({
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  vite: {
    plugins: [tailwindcss(), optimizeTablerIconsImport(), viteCorsProxyPlugin()],
    server: {
      host: "0.0.0.0",
      port: 3000,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
      hmr: hmrHost
        ? { host: hmrHost, protocol: "ws", port: 3000 }
        : undefined,
    },
    build: {
      chunkSizeWarningLimit: 800,
    },
    optimizeDeps: {
      exclude: [
        "@tauri-apps/api",
        "@tauri-apps/plugin-process",
        "@tauri-apps/plugin-updater",
        "@tauri-apps/plugin-http",
        "@tauri-apps/plugin-fs",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/plugin-log",
        "tauri-plugin-android-fs-api",
      ],
    },
  },

  integrations: [svelte()],
})
