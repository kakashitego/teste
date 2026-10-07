import type { Plugin } from "vite"
import { Readable } from "node:stream"
import fs from "node:fs"
import path from "node:path"

let lastHlsHost = "http://38.246.34.131:8080"

function rewriteM3u8(content: string, baseUrl: string): string {
  const lines = content.split(/\r?\n/)
  const rewritten = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return line
    if (trimmed.startsWith("#")) {
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
          try {
            const absolute = new URL(uri, baseUrl).href
            return `URI="/api/proxy?url=${encodeURIComponent(absolute)}"`
          } catch {
            return `URI="${uri}"`
          }
        })
      }
      return line
    }
    try {
      const absolute = new URL(trimmed, baseUrl).href
      return `/api/proxy?url=${encodeURIComponent(absolute)}`
    } catch {
      return line
    }
  })
  return rewritten.join("\n")
}

function handleProxyRequest(req: any, res: any, next: any) {
  if (req.url?.startsWith("/api/admin/categories")) {
    const configPath = path.resolve(process.cwd(), "src/config/default-playlist.json")
    if (req.method === "GET") {
      try {
        const raw = fs.readFileSync(configPath, "utf-8")
        const parsed = JSON.parse(raw)
        res.statusCode = 200
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ ok: true, hiddenCategories: parsed.hiddenCategories || { live: [], vod: [], series: [] } }))
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ ok: false, error: err?.message }))
      }
      return
    }

    if (req.method === "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Headers", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

      const processPayload = (rawBody: string) => {
        try {
          const payload = JSON.parse(rawBody || "{}")
          const providedPassword = req.headers["x-admin-password"] || payload.password
          if (providedPassword !== "2702") {
            res.statusCode = 401
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: false, error: "Senha de administrador incorreta" }))
            return
          }
          const raw = fs.readFileSync(configPath, "utf-8")
          const parsed = JSON.parse(raw)
          parsed.hiddenCategories = {
            live: Array.isArray(payload.hiddenCategories?.live) ? payload.hiddenCategories.live : (parsed.hiddenCategories?.live || []),
            vod: Array.isArray(payload.hiddenCategories?.vod) ? payload.hiddenCategories.vod : (parsed.hiddenCategories?.vod || []),
            series: Array.isArray(payload.hiddenCategories?.series) ? payload.hiddenCategories.series : (parsed.hiddenCategories?.series || []),
          }
          fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8")

          try {
            const { execSync } = require("node:child_process")
            execSync(`git add "${configPath}" && git commit -m "chore: atualizar categorias ocultas globais" || true`, { stdio: "ignore" })
          } catch {}

          res.statusCode = 200
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ ok: true, hiddenCategories: parsed.hiddenCategories }))
        } catch (err: any) {
          res.statusCode = 500
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ ok: false, error: err?.message }))
        }
      }

      if (req.body && typeof req.body === "object") {
        processPayload(JSON.stringify(req.body))
      } else if (typeof req.body === "string" && req.body.length > 0) {
        processPayload(req.body)
      } else {
        let body = ""
        req.on("data", (chunk: any) => { body += chunk })
        req.on("end", () => processPayload(body))
        req.on("error", (err: any) => {
          res.statusCode = 500
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ ok: false, error: err?.message }))
        })
        req.resume?.()
      }
      return
    }
  }

  let target: string | null = null

  if (req.url?.startsWith("/api/proxy")) {
    try {
      const urlObj = new URL(req.url, "http://localhost:3000")
      target = urlObj.searchParams.get("url")
    } catch {}
  } else if (req.url?.startsWith("/hls/")) {
    target = `${lastHlsHost}${req.url}`
  } else {
    return next()
  }

  if (!target) {
    res.statusCode = 400
    res.setHeader("Content-Type", "text/plain")
    res.end("Missing url parameter")
    return
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "*")
    res.setHeader("Access-Control-Max-Age", "86400")
    res.end()
    return
  }

  ;(async () => {
    try {
      const fetchHeaders: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }

      if (req.headers["range"]) {
        fetchHeaders["Range"] = String(req.headers["range"])
      }

      const upstream = await fetch(target!, {
        method: req.method || "GET",
        headers: fetchHeaders,
        redirect: "follow",
      })

      const finalUrl = upstream.url || target!
      try {
        const u = new URL(finalUrl)
        if (u.protocol.startsWith("http")) {
          lastHlsHost = u.origin
        }
      } catch {}

      const contentType = upstream.headers.get("content-type") || ""
      const isM3u8 =
        contentType.toLowerCase().includes("mpegurl") ||
        target!.toLowerCase().includes(".m3u8") ||
        finalUrl.toLowerCase().includes(".m3u8")

      if (isM3u8 && (upstream.status === 200 || upstream.status === 206)) {
        const text = await upstream.text()
        if (text.includes("#EXTM3U")) {
          const rewritten = rewriteM3u8(text, finalUrl)
          res.statusCode = upstream.status
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.setHeader("Access-Control-Allow-Headers", "*")
          res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
          res.setHeader("Content-Length", Buffer.byteLength(rewritten, "utf-8"))
          res.end(rewritten)
          return
        }
      }

      res.statusCode = upstream.status
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Headers", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")

      const hasEncoding = upstream.headers.has("content-encoding")
      upstream.headers.forEach((val, key) => {
        const k = key.toLowerCase()
        if (
          k === "content-encoding" ||
          k === "transfer-encoding" ||
          (k === "content-length" && hasEncoding)
        ) {
          return
        }
        try {
          res.setHeader(key, val)
        } catch {}
      })

      if (req.method === "HEAD" || !upstream.body) {
        res.end()
        return
      }

      // @ts-ignore
      Readable.fromWeb(upstream.body).pipe(res)
    } catch (err: any) {
      res.statusCode = 502
      res.setHeader("Content-Type", "text/plain")
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.end(err?.message || "Proxy upstream error")
    }
  })()
}

export function viteCorsProxyPlugin(): Plugin {
  return {
    name: "vite-cors-proxy",
    configureServer(server) {
      server.middlewares.use(handleProxyRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleProxyRequest)
    },
  }
}
