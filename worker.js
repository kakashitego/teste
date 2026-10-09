function rewriteM3u8(content, baseUrl) {
  const lines = content.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
          try {
            const absolute = new URL(uri, baseUrl).href;
            return `URI="/api/proxy?url=${encodeURIComponent(absolute)}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
      }
      return line;
    }
    try {
      const absolute = new URL(trimmed, baseUrl).href;
      return `/api/proxy?url=${encodeURIComponent(absolute)}`;
    } catch {
      return line;
    }
  });
  return rewritten.join("\n");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy para contornar CORS, Range requests e Mixed Content (HTTP em páginas HTTPS) no Cloudflare Workers
    if (url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url');
      if (!target) {
        return new Response('Missing url parameter', { status: 400 });
      }

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
        'Access-Control-Max-Age': '86400',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      try {
        const fetchHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };

        // Encaminha cabeçalho Range (essencial para Safari no iOS e seek no player)
        const range = request.headers.get('range');
        if (range) {
          fetchHeaders['Range'] = range;
        }

        const upstreamResp = await fetch(target, {
          method: request.method,
          headers: fetchHeaders,
          redirect: 'follow',
        });

        const newHeaders = new Headers(upstreamResp.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        newHeaders.set('Access-Control-Allow-Headers', '*');
        newHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type');
        if (!newHeaders.has('Accept-Ranges')) {
          newHeaders.set('Accept-Ranges', 'bytes');
        }

        const finalUrl = upstreamResp.url || target;
        const contentType = (upstreamResp.headers.get('content-type') || '').toLowerCase();
        const isM3u8 =
          contentType.includes('mpegurl') ||
          target.toLowerCase().includes('.m3u8') ||
          finalUrl.toLowerCase().includes('.m3u8');

        // Reescreve playlists HLS para que os segmentos .ts continuem passando pelo proxy
        if (isM3u8 && (upstreamResp.status === 200 || upstreamResp.status === 206)) {
          const text = await upstreamResp.text();
          if (text.includes('#EXTM3U')) {
            const rewritten = rewriteM3u8(text, finalUrl);
            newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
            return new Response(rewritten, {
              status: upstreamResp.status,
              statusText: upstreamResp.statusText,
              headers: newHeaders,
            });
          }
        }

        return new Response(upstreamResp.body, {
          status: upstreamResp.status,
          statusText: upstreamResp.statusText,
          headers: newHeaders,
        });
      } catch (err) {
        return new Response(String(err?.message || err), {
          status: 502,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
          },
        });
      }
    }

    // Tenta servir o arquivo estático da pasta dist (Astro)
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return response;
    }
    // Se não encontrar (ex: rotas internas de SPA), serve o index.html
    url.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }
};
