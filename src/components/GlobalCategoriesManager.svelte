<script>
  import { onMount, tick } from "svelte"
  import { getActiveEntry } from "@/scripts/lib/creds.js"
  import { getCached, hydrate as hydrateCache } from "@/scripts/lib/cache.js"
  import {
    getGlobalHiddenCategories,
    setGlobalHiddenCategories,
  } from "@/scripts/lib/preferences.js"
  import { xtreamApiFetch } from "@/scripts/lib/xtream-api.js"
  import { toastSuccess, toastError } from "@/scripts/lib/toast.ts"
  import { IconEyeOff, IconSearch, IconX, IconCheck, IconLock, IconEye, IconDownload, IconCopy } from "@tabler/icons-svelte"
  import defaultPlaylistConfig from "@/config/default-playlist.json"

  const ADMIN_PASSWORD = "2702"

  let isOpen = $state(false)
  let isUnlocked = $state(false)
  let showExportModal = $state(false)
  let passwordInput = $state("")
  let passwordError = $state("")
  let showPassword = $state(false)
  let passwordInputEl = $state(null)

  let activeTab = $state("vod")
  let searchQuery = $state("")
  let saving = $state(false)
  let loading = $state(true)

  let categories = $state({
    live: [],
    vod: [],
    series: [],
  })

  let hiddenSet = $state({
    live: new Set(),
    vod: new Set(),
    series: new Set(),
  })

  export async function open() {
    isOpen = true
    showExportModal = false
    passwordError = ""
    passwordInput = ""
    if (isUnlocked) {
      loadData()
    } else {
      await tick()
      passwordInputEl?.focus()
    }
  }

  export function close() {
    isOpen = false
    isUnlocked = false
    showExportModal = false
    passwordInput = ""
    passwordError = ""
    document.dispatchEvent(new CustomEvent("xt:admin-locked"))
  }

  function verifyPassword() {
    if (passwordInput.trim() === ADMIN_PASSWORD) {
      isUnlocked = true
      passwordError = ""
      passwordInput = ""
      document.dispatchEvent(new CustomEvent("xt:admin-authenticated", { detail: { authenticated: true } }))
      loadData()
    } else {
      passwordError = "Senha incorreta. Apenas o administrador com a senha correta pode acessar."
      passwordInput = ""
      passwordInputEl?.focus()
    }
  }

  function lockAdmin() {
    isUnlocked = false
    passwordInput = ""
    passwordError = ""
    document.dispatchEvent(new CustomEvent("xt:admin-locked"))
    tick().then(() => passwordInputEl?.focus())
  }

  function generateFullConfig() {
    const base = JSON.parse(JSON.stringify(defaultPlaylistConfig))
    base.hiddenCategories = {
      live: Array.from(hiddenSet.live),
      vod: Array.from(hiddenSet.vod),
      series: Array.from(hiddenSet.series),
    }
    return JSON.stringify(base, null, 2)
  }

  function downloadConfigFile() {
    const content = generateFullConfig()
    const blob = new Blob([content], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "default-playlist.json"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toastSuccess("Arquivo default-playlist.json baixado!", {
      description: "Substitua esse arquivo em src/config/default-playlist.json no seu repositório GitHub.",
    })
  }

  async function copyJsonConfig() {
    const content = generateFullConfig()
    try {
      await navigator.clipboard.writeText(content)
      toastSuccess("Configuração JSON copiada!", {
        description: "Cole no arquivo src/config/default-playlist.json no GitHub.",
      })
    } catch {
      toastError("Não foi possível copiar automaticamente")
    }
  }

  async function loadData() {
    loading = true
    try {
      const active = await getActiveEntry()
      const pid = active?._id || ""

      // Fetch saved global hidden categories from server API
      let remoteHidden = {}
      try {
        const res = await fetch("/api/admin/categories")
        if (res.ok) {
          const json = await res.json()
          if (json.hiddenCategories) remoteHidden = json.hiddenCategories
        }
      } catch {}

      hiddenSet = {
        live: new Set(remoteHidden.live || [...getGlobalHiddenCategories("live")]),
        vod: new Set(remoteHidden.vod || [...getGlobalHiddenCategories("vod")]),
        series: new Set(remoteHidden.series || [...getGlobalHiddenCategories("series")]),
      }

      if (pid) {
        await Promise.all([
          hydrateCache(pid, "vod").catch(() => {}),
          hydrateCache(pid, "series").catch(() => {}),
          hydrateCache(pid, "live").catch(() => {}),
          hydrateCache(pid, "m3u").catch(() => {}),
        ])

        const vodData = getCached(pid, "vod")?.data || []
        const seriesData = getCached(pid, "series")?.data || []
        const liveData = getCached(pid, "live")?.data || getCached(pid, "m3u")?.data || []

        categories = {
          vod: extractCategoryList(vodData),
          series: extractCategoryList(seriesData),
          live: extractCategoryList(liveData),
        }

        // If cached items are not yet populated, fetch categories directly via Xtream API
        if (categories.vod.length === 0) {
          try {
            const r = await xtreamApiFetch("get_vod_categories", {}, { entryId: pid })
            if (r.ok) {
              const data = await r.json()
              if (Array.isArray(data)) {
                for (const item of data) {
                  const name = String(item.category_name || "").trim()
                  if (name && !categories.vod.some((c) => c.name === name)) {
                    categories.vod.push({ name, count: 0 })
                  }
                }
              }
            }
          } catch {}
        }

        if (categories.series.length === 0) {
          try {
            const r = await xtreamApiFetch("get_series_categories", {}, { entryId: pid })
            if (r.ok) {
              const data = await r.json()
              if (Array.isArray(data)) {
                for (const item of data) {
                  const name = String(item.category_name || "").trim()
                  if (name && !categories.series.some((c) => c.name === name)) {
                    categories.series.push({ name, count: 0 })
                  }
                }
              }
            }
          } catch {}
        }

        if (categories.live.length === 0) {
          try {
            const r = await xtreamApiFetch("get_live_categories", {}, { entryId: pid })
            if (r.ok) {
              const data = await r.json()
              if (Array.isArray(data)) {
                for (const item of data) {
                  const name = String(item.category_name || "").trim()
                  if (name && !categories.live.some((c) => c.name === name)) {
                    categories.live.push({ name, count: 0 })
                  }
                }
              }
            }
          } catch {}
        }

        // Ensure any previously hidden category is in the list
        for (const kind of ["vod", "series", "live"]) {
          for (const hiddenName of hiddenSet[kind]) {
            if (!categories[kind].some((c) => c.name === hiddenName)) {
              categories[kind].push({ name: hiddenName, count: 0 })
            }
          }
          categories[kind].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
        }
      }
    } catch (e) {
      toastError("Erro ao carregar categorias", { description: e?.message })
    } finally {
      loading = false
    }
  }

  function extractCategoryList(items) {
    const counts = new Map()
    for (const item of items) {
      if (!item) continue
      const cat = String(item.category || "").trim()
      if (cat) {
        counts.set(cat, (counts.get(cat) || 0) + 1)
      }
      if (Array.isArray(item.categories)) {
        for (const c of item.categories) {
          const sc = String(c || "").trim()
          if (sc && sc !== cat) counts.set(sc, (counts.get(sc) || 0) + 1)
        }
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
  }

  function toggleHidden(name) {
    const set = hiddenSet[activeTab]
    if (set.has(name)) {
      set.delete(name)
    } else {
      set.add(name)
    }
    hiddenSet = { ...hiddenSet }
  }

  function hideAllFiltered() {
    const currentList = filteredCategories
    const set = hiddenSet[activeTab]
    for (const item of currentList) {
      set.add(item.name)
    }
    hiddenSet = { ...hiddenSet }
  }

  function showAllInTab() {
    hiddenSet[activeTab] = new Set()
    hiddenSet = { ...hiddenSet }
  }

  async function save() {
    saving = true
    try {
      const payload = {
        password: ADMIN_PASSWORD,
        hiddenCategories: {
          live: Array.from(hiddenSet.live),
          vod: Array.from(hiddenSet.vod),
          series: Array.from(hiddenSet.series),
        },
      }

      // 1. Always apply immediately to user preferences and local session
      setGlobalHiddenCategories(payload.hiddenCategories)

      // 2. Attempt saving to backend API (Node / Vite proxy)
      let savedOnServer = false
      try {
        const res = await fetch("/api/admin/categories", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-password": ADMIN_PASSWORD,
          },
          body: JSON.stringify(payload),
        })

        if (res.ok) {
          savedOnServer = true
        }
      } catch {
        // Network or static host environment
      }

      if (savedOnServer) {
        toastSuccess("Categorias salvas e atualizadas no projeto!", {
          description: "O arquivo default-playlist.json foi atualizado com sucesso.",
        })
        isOpen = false
        isUnlocked = false
      } else {
        // When running on static hosting without a Node backend (e.g. GitHub Pages)
        showExportModal = true
      }
    } catch (e) {
      toastError("Falha ao salvar categorias", { description: e?.message })
    } finally {
      saving = false
    }
  }

  let filteredCategories = $derived(
    categories[activeTab].filter((item) =>
      item.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )
  )

  let hiddenCountInTab = $derived(
    categories[activeTab].filter((item) => hiddenSet[activeTab].has(item.name)).length
  )

  onMount(() => {
    // Listen for custom open event
    const onOpenEvent = () => open()
    const onAdminAuth = (ev) => {
      if (ev.detail?.authenticated) {
        isUnlocked = true
        passwordError = ""
      }
    }
    const onAdminLock = () => {
      isUnlocked = false
      passwordInput = ""
      passwordError = ""
    }

    document.addEventListener("xt:open-global-categories-manager", onOpenEvent)
    document.addEventListener("xt:admin-authenticated", onAdminAuth)
    document.addEventListener("xt:admin-locked", onAdminLock)
    return () => {
      document.removeEventListener("xt:open-global-categories-manager", onOpenEvent)
      document.removeEventListener("xt:admin-authenticated", onAdminAuth)
      document.removeEventListener("xt:admin-locked", onAdminLock)
    }
  })
</script>

{#if isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-labelledby={isUnlocked ? "global-cat-title" : "admin-auth-title"}>

    {#if !isUnlocked}
      <!-- Password Gate Card -->
      <div
        class="flex flex-col w-full max-w-md rounded-2xl border border-line bg-surface text-fg p-6 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        <div class="flex items-start justify-between gap-4 mb-4">
          <div class="size-12 rounded-2xl bg-accent-soft/50 border border-accent/40 flex items-center justify-center text-accent shrink-0 shadow-inner">
            <IconLock class="size-6 stroke-2" />
          </div>
          <button
            type="button"
            onclick={close}
            aria-label="Fechar"
            class="rounded-lg p-1.5 text-fg-3 hover:text-fg hover:bg-surface-2 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent">
            <IconX class="size-5" />
          </button>
        </div>

        <div class="flex flex-col gap-1 mb-5">
          <h2 id="admin-auth-title" class="text-lg font-semibold text-fg">
            Acesso de Administrador
          </h2>
          <p class="text-xs text-fg-3 leading-relaxed">
            Digite a senha de administrador para acessar e gerenciar as categorias ocultas para todos os visitantes do site.
          </p>
        </div>

        <form
          onsubmit={(e) => { e.preventDefault(); verifyPassword(); }}
          class="flex flex-col gap-4">
          
          <div class="flex flex-col gap-1.5">
            <label for="admin-pin-input" class="text-xs font-medium text-fg-2">
              Senha de Acesso
            </label>
            <div class="relative">
              <input
                id="admin-pin-input"
                bind:this={passwordInputEl}
                type={showPassword ? "text" : "password"}
                inputmode="numeric"
                maxlength="12"
                autocomplete="off"
                placeholder="Digite a senha..."
                bind:value={passwordInput}
                class="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-xl border bg-bg text-fg placeholder:text-fg-4 transition-colors outline-none {passwordError ? 'border-red-500 focus:border-red-500 ring-1 ring-red-500/20' : 'border-line focus:border-accent'}"
              />
              <button
                type="button"
                onclick={() => { showPassword = !showPassword }}
                tabindex="-1"
                aria-label={showPassword ? "Ocultar senha" : "Exibir senha"}
                class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-fg-3 hover:text-fg transition-colors">
                {#if showPassword}
                  <IconEyeOff class="size-4" />
                {:else}
                  <IconEye class="size-4" />
                {/if}
              </button>
            </div>
            
            {#if passwordError}
              <div class="text-xs text-red-400 font-medium flex items-center gap-1.5 mt-0.5 animate-in fade-in duration-150">
                <span>{passwordError}</span>
              </div>
            {/if}
          </div>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onclick={close}
              class="px-4 py-2 rounded-xl border border-line bg-surface hover:bg-surface-2 text-sm text-fg font-medium transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              class="px-5 py-2 rounded-xl bg-accent hover:opacity-90 text-bg text-sm font-semibold transition-opacity flex items-center gap-1.5 shadow-sm cursor-pointer">
              <IconLock class="size-4" />
              <span>Entrar</span>
            </button>
          </div>
        </form>
      </div>

    {:else}
      <!-- Full Category Management Dialog -->
      <div
        class="flex flex-col w-full max-w-3xl h-[88vh] max-h-[780px] rounded-2xl border border-line bg-surface text-fg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <IconEyeOff class="size-5 text-accent shrink-0" />
              <h2 id="global-cat-title" class="text-base font-semibold text-fg">
                Gerenciador Global de Categorias
              </h2>
              <span class="text-3xs px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold uppercase tracking-wider">Admin</span>
            </div>
            <p class="text-xs text-fg-3">
              Selecione as categorias que deseja <strong>ocultar</strong> para todos os visitantes do site.
            </p>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onclick={lockAdmin}
              title="Bloquear painel de administrador"
              class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-line bg-surface-2 hover:bg-surface-3 text-fg-3 hover:text-fg transition-colors cursor-pointer">
              <IconLock class="size-3.5" />
              <span class="hidden sm:inline">Bloquear</span>
            </button>
            <button
              type="button"
              onclick={close}
              aria-label="Fechar"
              class="rounded-lg p-1.5 text-fg-3 hover:text-fg hover:bg-surface-2 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer">
              <IconX class="size-5" />
            </button>
          </div>
        </div>

        <!-- Media Type Tabs -->
        <div class="flex px-5 pt-3 border-b border-line gap-2 shrink-0 bg-surface-2/40">
          <button
            type="button"
            onclick={() => { activeTab = "vod"; searchQuery = "" }}
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors outline-none {activeTab === 'vod' ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-3 hover:text-fg'}">
            Filmes ({categories.vod.length})
          </button>
          <button
            type="button"
            onclick={() => { activeTab = "series"; searchQuery = "" }}
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors outline-none {activeTab === 'series' ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-3 hover:text-fg'}">
            Séries ({categories.series.length})
          </button>
          <button
            type="button"
            onclick={() => { activeTab = "live"; searchQuery = "" }}
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors outline-none {activeTab === 'live' ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-3 hover:text-fg'}">
            TV ao Vivo ({categories.live.length})
          </button>
        </div>

        <!-- Toolbar: Search + Batch Actions -->
        <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between px-5 py-3 border-b border-line shrink-0 bg-surface">
          <div class="relative flex-1 max-w-md">
            <IconSearch class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-3 pointer-events-none" />
            <input
              type="search"
              bind:value={searchQuery}
              placeholder="Buscar categorias..."
              class="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-line bg-bg text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none transition-colors"
            />
          </div>

          <div class="flex items-center gap-2 text-xs">
            <button
              type="button"
              onclick={hideAllFiltered}
              class="px-2.5 py-1.5 rounded-lg border border-line bg-surface-2 hover:bg-surface-3 text-fg font-medium transition-colors cursor-pointer">
              Ocultar Filtradas
            </button>
            <button
              type="button"
              onclick={showAllInTab}
              class="px-2.5 py-1.5 rounded-lg border border-line bg-surface-2 hover:bg-surface-3 text-fg-3 hover:text-fg transition-colors cursor-pointer">
              Exibir Todas
            </button>
            <span class="ml-2 text-2xs text-fg-3 tabular-nums font-mono">
              {hiddenCountInTab} ocultas / {categories[activeTab].length}
            </span>
          </div>
        </div>

        <!-- Category List -->
        <div class="flex-1 min-h-0 overflow-y-auto custom-scroll p-5">
          {#if loading}
            <div class="flex items-center justify-center h-48 text-sm text-fg-3">
              Carregando catálogo e categorias...
            </div>
          {:else if filteredCategories.length === 0}
            <div class="flex flex-col items-center justify-center h-48 text-center text-sm text-fg-3 gap-1">
              <span>Nenhuma categoria encontrada.</span>
              {#if searchQuery}
                <span class="text-xs text-fg-4">Tente buscar por outro termo.</span>
              {/if}
            </div>
          {:else}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              {#each filteredCategories as item (item.name)}
                {@const isHidden = hiddenSet[activeTab].has(item.name)}
                <label
                  class="flex items-center justify-between gap-3 p-2.5 rounded-xl border transition-colors cursor-pointer select-none {isHidden ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-line bg-surface-2/60 hover:bg-surface-2 text-fg'}">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div
                      class="size-4.5 rounded flex items-center justify-center border transition-colors shrink-0 {isHidden ? 'bg-red-500 border-red-500 text-white' : 'border-line bg-bg'}">
                      {#if isHidden}
                        <IconCheck class="size-3.5 stroke-3" />
                      {/if}
                    </div>
                    <span class="text-xs sm:text-sm font-medium truncate">
                      {item.name}
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-2xs px-1.5 py-0.5 rounded bg-bg/60 text-fg-3 tabular-nums font-mono">
                      {item.count}
                    </span>
                    {#if isHidden}
                      <span class="text-2xs font-semibold uppercase tracking-wider text-red-400">
                        Oculta
                      </span>
                    {/if}
                  </div>
                  <input
                    type="checkbox"
                    checked={isHidden}
                    onchange={() => toggleHidden(item.name)}
                    class="sr-only"
                  />
                </label>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Footer -->
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-5 py-4 border-t border-line shrink-0 bg-surface-2/30">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={downloadConfigFile}
              title="Baixar default-playlist.json com as categorias ocultas para enviar ao GitHub"
              class="px-3 py-2 rounded-xl border border-line bg-surface hover:bg-surface-2 text-xs text-fg-2 hover:text-fg font-medium transition-colors flex items-center gap-1.5 cursor-pointer">
              <IconDownload class="size-4" />
              <span>Baixar para GitHub</span>
            </button>
            <button
              type="button"
              onclick={copyJsonConfig}
              title="Copiar JSON configurado para colar no GitHub"
              class="px-3 py-2 rounded-xl border border-line bg-surface hover:bg-surface-2 text-xs text-fg-2 hover:text-fg font-medium transition-colors flex items-center gap-1.5 cursor-pointer">
              <IconCopy class="size-4" />
              <span>Copiar JSON</span>
            </button>
          </div>

          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              onclick={close}
              class="px-4 py-2 rounded-xl border border-line bg-surface hover:bg-surface-2 text-sm text-fg font-medium transition-colors cursor-pointer">
              Cancelar
            </button>
            <button
              type="button"
              onclick={save}
              disabled={saving}
              class="px-4 py-2 rounded-xl bg-accent hover:opacity-90 text-bg text-sm font-semibold transition-opacity disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
              {#if saving}
                <span>Salvando...</span>
              {:else}
                <IconCheck class="size-4" />
                <span>Salvar para Todos os Visitantes</span>
              {/if}
            </button>
          </div>
        </div>

      </div>
    {/if}
  </div>
{/if}

{#if showExportModal}
  <!-- Modal para ambiente estático/GitHub Pages -->
  <div class="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
    <div class="flex flex-col w-full max-w-lg rounded-2xl border border-line bg-surface text-fg p-6 shadow-2xl gap-4 animate-in fade-in zoom-in-95 duration-150">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <div class="size-10 rounded-xl bg-accent-soft/50 border border-accent/40 flex items-center justify-center text-accent">
            <IconDownload class="size-5" />
          </div>
          <div class="flex flex-col">
            <h3 class="text-base font-semibold text-fg">Atualizar no GitHub</h3>
            <span class="text-xs text-green-400">✓ Categorias já ativas neste navegador!</span>
          </div>
        </div>
        <button
          type="button"
          onclick={() => { showExportModal = false; isOpen = false; isUnlocked = false; }}
          class="p-1.5 rounded-lg text-fg-3 hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer">
          <IconX class="size-5" />
        </button>
      </div>

      <p class="text-xs text-fg-3 leading-relaxed">
        Como o site no GitHub é hospedado de forma estática, o navegador do visitante não pode gravar arquivos no GitHub sem autenticação. Para que <strong>todos os visitantes de qualquer lugar</strong> recebam essas categorias ocultas por padrão, basta atualizar o arquivo <code>src/config/default-playlist.json</code> no seu repositório:
      </p>

      <div class="flex flex-col sm:flex-row gap-2 pt-1">
        <button
          type="button"
          onclick={downloadConfigFile}
          class="flex-1 px-4 py-2.5 rounded-xl bg-accent hover:opacity-90 text-bg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-opacity">
          <IconDownload class="size-4" />
          <span>Baixar default-playlist.json</span>
        </button>
        <button
          type="button"
          onclick={copyJsonConfig}
          class="flex-1 px-4 py-2.5 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 text-fg text-xs font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors">
          <IconCopy class="size-4" />
          <span>Copiar Conteúdo JSON</span>
        </button>
      </div>

      <div class="flex justify-end pt-2 border-t border-line/40">
        <button
          type="button"
          onclick={() => { showExportModal = false; isOpen = false; isUnlocked = false; }}
          class="px-4 py-1.5 rounded-lg bg-surface hover:bg-surface-2 border border-line text-xs text-fg font-medium cursor-pointer">
          Concluir
        </button>
      </div>
    </div>
  </div>
{/if}
