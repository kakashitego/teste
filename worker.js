export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy para contornar CORS e Mixed Content (HTTP em páginas HTTPS) no Cloudflare Workers
    if (url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url');
      if (!target) {
        return new Response('Missing url parameter', { status: 400 });
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      try {
        const upstreamResp = await fetch(target, {
          method: request.method,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          redirect: 'follow',
        });

        const newHeaders = new Headers(upstreamResp.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        newHeaders.set('Access-Control-Allow-Headers', '*');

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
