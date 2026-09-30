# Lista Padrão Global do Projeto com Bloqueio de Adição Manual

Permitir que o proprietário do projeto defina uma lista IPTV padrão (M3U/M3U8 ou Xtream Codes) diretamente em um arquivo JSON simples no código (`src/config/default-playlist.json`). Sempre que qualquer pessoa acessar o site, a lista configurada já estará carregada e ativa automaticamente, sem precisar digitar credenciais ou colar URLs. Além disso, a interface será bloqueada para que visitantes não possam adicionar listas pessoais, e qualquer alteração futura no JSON sincronizará automaticamente a lista para todos os usuários.

## Decisões Confirmadas pelo Usuário

> [!IMPORTANT]
> - **Formato de Lista**: Suportar ambos os formatos — link direto **M3U / M3U8** ou credenciais **Xtream Codes** (URL do servidor, usuário e senha).
> - **Acesso e Restrição**: Travar estritamente na lista padrão do projeto. Visitantes não poderão adicionar ou remover listas; a lista do projeto será a única fonte de catálogo.
> - **Configuração Simples**: Gerenciamento através de um arquivo de configuração JSON direto no projeto (`src/config/default-playlist.json`), permitindo trocar a lista ou credenciais facilmente a qualquer momento.

---

## 1. Visão Geral e Experiência do Usuário

- **Experiência de Primeiro Acesso**:
  Ao abrir o site pela primeira vez (ou em aba anônima), o visitante não verá mais a tela de boas-vindas pedindo para adicionar uma lista manualmente nem será levado para a tela de login. O catálogo de canais ao vivo, filmes e séries da lista configurada começará a carregar imediatamente.
- **Experiência de Navegação Trancada**:
  - Os botões de adicionar nova lista ("Adicionar lista", "Try a demo playlist", etc.) na barra lateral, no alternador de listas e nas configurações serão desativados/ocultados.
  - Se um usuário tentar acessar diretamente a rota `/login`, ele será redirecionado para a página inicial (`/`).
  - O alternador de listas exibirá o nome da lista oficial do projeto com status ativo e opção de recarregar/atualizar.
- **Atualização Fácil pelo Desenvolvedor**:
  - Bastará abrir `src/config/default-playlist.json`, preencher os campos do seu servidor/lista (URL, usuário, senha ou link M3U) e salvar.
  - Um mecanismo de versionamento e comparação (`version` ou `hash`) garantirá que visitantes que já tinham uma versão anterior no cache do navegador recebam a nova lista automaticamente.

---

## 2. Arquitetura e Estratégia de Dados

```
┌─────────────────────────────────────────────────────────────┐
│                 src/config/default-playlist.json            │
│  - enabled: true                                            │
│  - lockToDefault: true                                      │
│  - version: 1                                               │
│  - entry: { type: "m3u" | "xtream", title, url, ... }       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         src/scripts/lib/default-playlist-manager.js         │
│  - getDefaultPlaylist(): lê e valida a lista do config      │
│  - isDefaultPlaylistLocked(): valida se listas extras estão │
│    bloqueadas                                               │
│  - syncDefaultPlaylistIfChanged(): detecta atualizações de  │
│    configuração e atualiza o estado local                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   src/scripts/lib/creds.js                  │
│  - Injeta a lista padrão como playlist ativa                │
│  - Previne persistência de listas manuais quando trancado   │
│  - Garante auto-seleção e warming do catálogo               │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐┌─────────────────────────────┐
│  Sidebar / PlaylistSwitcher  ││  Páginas (/login, /settings)│
│  - Oculta botões de add list ││  - Redireciona /login       │
│  - Exibe nome da lista ativa ││  - Oculta formulário de add │
└──────────────────────────────┘└─────────────────────────────┘
```

---

## 3. Estrutura do Arquivo de Configuração

O arquivo `src/config/default-playlist.json` terá uma estrutura intuitiva e comentada:

### Exemplo 1: Para Lista M3U / M3U8 (Link direto)
```json
{
  "enabled": true,
  "lockToDefault": true,
  "version": 1,
  "entry": {
    "type": "m3u",
    "title": "Minha Lista IPTV",
    "url": "https://exemplo.com/lista.m3u"
  }
}
```

### Exemplo 2: Para Servidor Xtream Codes (Usuário e Senha)
```json
{
  "enabled": true,
  "lockToDefault": true,
  "version": 1,
  "entry": {
    "type": "xtream",
    "title": "Meu Servidor Xtream",
    "serverUrl": "http://servidor.exemplo.com:8080",
    "username": "meu_usuario",
    "password": "minha_senha"
  }
}
```

---

## 4. Etapas de Execução

1. **Aprimorar o Gerenciador de Lista Padrão (`default-playlist-manager.js`)**:
   - Implementar suporte completo para tipos `"m3u"` e `"xtream"`.
   - Adicionar função de detecção de mudanças (comparando `version` e credenciais) para forçar atualização no cache de usuários existentes quando o JSON for modificado.
   - Adicionar helper `isDefaultPlaylistLocked()` para consulta nos componentes.

2. **Integrar ao Fluxo Central de Credenciais (`creds.js`)**:
   - No `ensureMigrated()` e `getState()`, caso `lockToDefault` esteja ativo, definir a lista do JSON como única e ativa.
   - Se o administrador alterar o JSON e subir a versão, atualizar os dados da lista mantendo o cache e histórico em conformidade.

3. **Bloquear Adição Manual e Ajustar a Interface**:
   - **`/login`**: Adicionar guarda de rota para redirecionar para `/` quando a lista padrão estiver configurada e travada.
   - **`PlaylistSwitcher.svelte`**: Ocultar o botão `+ Adicionar lista` e opções de remoção quando estiver travado no modo padrão.
   - **`WelcomeCard.astro`**: Ocultar os botões de adicionar lista e exibir estado de carregamento do catálogo da lista padrão.
   - **`/settings`**: Ocultar área de adicionar novas credenciais ou exibir aviso informativo de que a lista é gerenciada pela aplicação.

4. **Criar Modelo Padrão e Documentação de Uso**:
   - Deixar `src/config/default-playlist.json` pronto com campos de exemplo claros para preenchimento.
   - Fornecer instruções objetivas de como alterar a lista quando desejar.
