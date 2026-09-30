export default {
  async fetch(request, env) {
    // Tenta servir o arquivo estático da pasta dist (Astro)
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return response;
    }
    // Se não encontrar (ex: rotas internas de SPA), serve o index.html
    const url = new URL(request.url);
    url.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }
};
