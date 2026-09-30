import type { Plugin } from "vite"
import { Readable } from "node:stream"

export function viteCorsProxyPlugin(): Plugin {
  return {
    name: "vite-cors-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/proxy")) {
          return next()
        }

        try {
          const urlObj = new URL(req.url, "http://localhost:3000")
          const target = urlObj.searchParams.get("url")

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

          const fetchHeaders: Record<string, string> = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          }

          if (req.headers["range"]) {
            fetchHeaders["Range"] = String(req.headers["range"])
          }

          const upstream = await fetch(target, {
            method: req.method || "GET",
            headers: fetchHeaders,
          })

          res.statusCode = upstream.status

          res.setHeader("Access-Control-Allow-Origin", "*")
          res.setHeader("Access-Control-Allow-Headers", "*")
          res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")

          upstream.headers.forEach((val, key) => {
            const k = key.toLowerCase()
            if (k !== "content-encoding" && k !== "transfer-encoding") {
              try {
                res.setHeader(key, val)
              } catch {}
            }
          })

          if (upstream.body) {
            // @ts-ignore
            Readable.fromWeb(upstream.body).pipe(res)
          } else {
            res.end()
          }
        } catch (err: any) {
          res.statusCode = 502
          res.setHeader("Content-Type", "text/plain")
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.end(err?.message || "Proxy upstream error")
        }
      })
    },
  }
}
