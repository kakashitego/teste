// Shared per-tab guard for the tmdb backfill (see rowsNeedTmdbBackfill in catalog-mappers.js).
import { cachedFetch, CACHE_REVALIDATED_EVENT } from "@/scripts/lib/cache.js"
import { log } from "@/scripts/lib/log.js"

const tmdbBackfillTriggered = new Set<string>()
const SESSION_BACKFILL_PREFIX = "xt_backfill_checked:"

export function triggerTmdbBackfillOnce(
  playlistId: string,
  kind: string,
  ttlMs: number,
  fetcher: () => Promise<unknown>
): void {
  const key = `${playlistId}:${kind}`
  if (tmdbBackfillTriggered.has(key)) return
  try {
    if (sessionStorage.getItem(SESSION_BACKFILL_PREFIX + key) === "1") return
  } catch {}
  tmdbBackfillTriggered.add(key)
  try {
    sessionStorage.setItem(SESSION_BACKFILL_PREFIX + key, "1")
  } catch {}

  cachedFetch(playlistId, kind, ttlMs, fetcher, { force: true })
    .then(() => {
      document.dispatchEvent(new CustomEvent(CACHE_REVALIDATED_EVENT, { detail: { entryId: playlistId, kind } }))
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : err
      log.warn("[xt:tmdb-backfill] backfill fetch failed:", kind, message)
    })
}
