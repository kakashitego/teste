import type { Plugin } from "vite"
import { Readable } from "node:stream"

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
