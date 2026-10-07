<script>
  import { onMount, tick } from "svelte"
  import { getActiveEntry } from "@/scripts/lib/creds.js"
  import {
    ensureLoaded as ensurePrefsLoaded,
    getHiddenCategories,
    getGlobalHiddenCategories,
    setCategoryHidden,
  } from "@/scripts/lib/preferences.js"
  import { kindLabelPlural, KIND_ORDER } from "@/scripts/lib/kinds.js"
  import { t, LOCALE_EVENT } from "@/scripts/lib/i18n.js"
  import { IconLock, IconEye, IconEyeOff, IconCheck } from "@tabler/icons-svelte"

  const ADMIN_PASSWORD = "2702"

  let isUnlocked = $state(false)
  let passwordInput = $state("")
  let passwordError = $state("")
  let showPassword = $state(false)
  let showInlinePrompt = $state(false)
  let pinInputEl = $state(null)

  /** @type {string} */
  let activePlaylistId = $state("")
  /** @type {{ live: string[], vod: string[], series: string[] }} */
  let lists = $state({ live: [], vod: [], series: [] })
  let locale = $state(0)
  const tr = (key, params) => (locale, t(key, params))
  const klp = (kind) => (locale, kindLabelPlural(kind))

  function isGlobal(kind, name) {
    return getGlobalHiddenCategories(kind).has(name)
  }

  async function reload() {
    const active = await getActiveEntry()
    activePlaylistId = active?._id || ""
    if (!activePlaylistId) {
      lists = { live: [], vod: [], series: [] }
      return
    }
    await ensurePrefsLoaded()
    lists = {
      live: [...getHiddenCategories(activePlaylistId, "live")].sort(sortStrings),
      vod: [...getHiddenCategories(activePlaylistId, "vod")].sort(sortStrings),
      series: [...getHiddenCategories(activePlaylistId, "series")].sort(sortStrings),
    }
  }

  function sortStrings(left, right) {
    return left.localeCompare(right, "en", { sensitivity: "base" })
  }

  function unhide(kind, name) {
    if (isGlobal(kind, name)) {
      document.dispatchEvent(new CustomEvent("xt:open-global-categories-manager"))
      return
    }
    if (!activePlaylistId) return
    setCategoryHidden(activePlaylistId, kind, name, false)
  }

  function verifyPassword() {
    if (passwordInput.trim() === ADMIN_PASSWORD) {
      isUnlocked = true
      passwordError = ""
      passwordInput = ""
      showInlinePrompt = false
      document.dispatchEvent(new CustomEvent("xt:admin-authenticated", { detail: { authenticated: true } }))
      reload()
    } else {
      passwordError = "Senha incorreta. Apenas o administrador pode ver as categorias ocultas."
      passwordInput = ""
      pinInputEl?.focus()
    }
  }

  function lock() {
    isUnlocked = false
    passwordInput = ""
    passwordError = ""
    showInlinePrompt = false
    document.dispatchEvent(new CustomEvent("xt:admin-locked"))
  }

  function openPasswordPrompt() {
    showInlinePrompt = true
    passwordError = ""
    passwordInput = ""
    tick().then(() => pinInputEl?.focus())
  }

  onMount(() => {
    reload()
    const onLocale = () => { locale++ }
    const onAdminAuth = (ev) => {
      if (ev.detail?.authenticated) {
        isUnlocked = true
        passwordError = ""
        showInlinePrompt = false
        reload()
      }
    }
    const onAdminLock = () => {
      isUnlocked = false
      showInlinePrompt = false
      passwordInput = ""
      passwordError = ""
    }

    const handlers = {
      "xt:active-changed": reload,
      "xt:hidden-categories-changed": reload,
      "xt:global-hidden-changed": reload,
      "xt:admin-authenticated": onAdminAuth,
      "xt:admin-locked": onAdminLock,
      [LOCALE_EVENT]: onLocale,
    }
    for (const [eventName, handler] of Object.entries(handlers)) {
      document.addEventListener(eventName, handler)
    }
    return () => {
      for (const [eventName, handler] of Object.entries(handlers)) {
        document.removeEventListener(eventName, handler)
      }
    }
  })

  let total = $derived(lists.live.length + lists.vod.length + lists.series.length)
</script>

{#if !isUnlocked}
  <!-- Locked State: Absolutely NO category names shown! -->
  <div class="rounded-xl border border-line bg-surface-2/40 p-4 flex flex-col gap-3">
    <div class="flex items-start gap-3">
      <div class="size-9 rounded-xl bg-accent-soft/40 border border-accent/30 flex items-center justify-center text-accent shrink-0">
        <IconLock class="size-4.5 stroke-2" />
      </div>
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-xs font-semibold text-fg flex items-center gap-1.5">
          <span>Lista Protegida por Senha</span>
          <span class="text-3xs px-1.5 py-0.2 rounded bg-accent/20 text-accent font-semibold uppercase tracking-wider">Admin</span>
        </span>
        <span class="text-2xs text-fg-3">
          As categorias ocultas não são visíveis para visitantes. Digite a senha de administrador para visualizar quais estão ocultas.
        </span>
      </div>
    </div>

    {#if !showInlinePrompt}
      <div class="flex items-center gap-2 pt-1">
        <button
          type="button"
          onclick={openPasswordPrompt}
          class="px-3.5 py-1.5 rounded-lg bg-surface border border-line hover:border-accent hover:text-fg text-fg-2 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer">
          <IconLock class="size-3.5" />
          <span>Ver Categorias Ocultas</span>
        </button>
      </div>
    {:else}
      <form
        onsubmit={(e) => { e.preventDefault(); verifyPassword(); }}
        class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 animate-in fade-in duration-150">
        <div class="relative flex-1 max-w-xs">
          <input
            bind:this={pinInputEl}
            type={showPassword ? "text" : "password"}
            inputmode="numeric"
            placeholder="Digite a senha..."
            bind:value={passwordInput}
            class="w-full pl-3 pr-8 py-1.5 text-xs rounded-lg border bg-bg text-fg placeholder:text-fg-4 transition-colors outline-none {passwordError ? 'border-red-500 focus:border-red-500 ring-1 ring-red-500/20' : 'border-line focus:border-accent'}"
          />
          <button
            type="button"
            onclick={() => { showPassword = !showPassword }}
            tabindex="-1"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg">
            {#if showPassword}
              <IconEyeOff class="size-3.5" />
            {:else}
              <IconEye class="size-3.5" />
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            type="submit"
            class="px-3 py-1.5 rounded-lg bg-accent hover:opacity-90 text-bg text-xs font-semibold transition-opacity flex items-center gap-1 cursor-pointer">
            <IconCheck class="size-3.5" />
            <span>Desbloquear</span>
          </button>
          <button
            type="button"
            onclick={() => { showInlinePrompt = false; passwordError = ""; }}
            class="px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-2 text-fg-3 hover:text-fg text-xs transition-colors cursor-pointer">
            Cancelar
          </button>
        </div>
      </form>
      {#if passwordError}
        <span class="text-3xs text-red-400 font-medium animate-in fade-in duration-150">
          {passwordError}
        </span>
      {/if}
    {/if}
  </div>

{:else}
  <!-- Unlocked State: Category list visible exclusively to authenticated admin -->
  <div class="flex flex-col gap-3 overflow-x-clip">
    <div class="flex items-center justify-between pb-1 border-b border-line/40">
      <div class="flex items-center gap-1.5">
        <span class="text-3xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-semibold uppercase tracking-wider">
          Admin Desbloqueado
        </span>
        <span class="text-2xs text-fg-3 tabular-nums">
          {total === 0
            ? tr("settings.hiddenCategories.empty")
            : tr("settings.hiddenCategories.count", { n: total })}
        </span>
      </div>
      <button
        type="button"
        onclick={lock}
        class="text-2xs text-fg-3 hover:text-fg flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-2 transition-colors cursor-pointer">
        <IconLock class="size-3" />
        <span>Bloquear</span>
      </button>
    </div>

    {#if total === 0}
      <div class="text-xs text-fg-3 italic">
        {tr("settings.hiddenCategories.emptyState")}
      </div>
    {:else}
      <div class="flex flex-col gap-3 max-h-[50vh] overflow-y-auto overflow-x-hidden custom-scroll pr-1 -mr-1">
      {#each KIND_ORDER as kind}
        {#if lists[kind].length}
          <div class="flex flex-col gap-1.5">
            <div class="sticky top-0 z-10 -mx-5 sm:-mx-6 px-5 sm:px-6 py-1.5 bg-surface/95 backdrop-blur-sm border-b border-line/60 text-eyebrow font-semibold uppercase tracking-wide text-fg-3">
              {klp(kind)}
            </div>
            <ul class="flex flex-wrap gap-1.5">
              {#each lists[kind] as name (name)}
                <li>
                  <button
                    type="button"
                    onclick={() => unhide(kind, name)}
                    class="inline-flex items-center gap-1.5 min-h-9 pointer-coarse:min-h-11 rounded-lg border border-line bg-surface-2 hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:border-accent text-fg px-3 text-xs transition-colors outline-none"
                    aria-label={tr("settings.hiddenCategories.unhideAria", { name })}
                    title={tr("settings.hiddenCategories.clickToUnhide")}>
                    <span class="truncate max-w-[16rem]">{name}</span>
                    {#if isGlobal(kind, name)}
                      <span class="text-3xs px-1 py-0.5 rounded bg-accent/20 text-accent font-semibold uppercase tracking-wider" title="Oculta globalmente (requer senha do administrador)">Global</span>
                    {/if}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="0.875em"
                      height="0.875em"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true">
                      <path d="M2 12s3-7 10-7 10 7 10 7"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/each}
      </div>
    {/if}
  </div>
{/if}
