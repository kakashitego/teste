import { getProgress, isCompleted, setProgress } from "@/scripts/lib/preferences.js"
import { flattenSeriesEpisodes, type SeriesEpisodeEntry } from "@/scripts/lib/tv-cast-next.ts"
import { requestSeriesInfo } from "@/scripts/lib/series-seasons.ts"
import { log } from "@/scripts/lib/log.js"

export interface EpisodeExtras {
  seriesId?: number | string | null
  season?: number | string | null
  episodeNum?: number | string | null
  episodeTitle?: string | null
  seriesName?: string | null
  seriesLogo?: string | null
  [key: string]: any
}

/**
 * Traverses a sorted list of episodes for a series, finds the one matching currentEpisodeId,
 * and finds the next unwatched episode.
 */
export function findNextUnwatchedEpisode(
  episodes: SeriesEpisodeEntry[],
  currentEpisodeId: string | number,
  isEpisodeCompleted: (id: string | number) => boolean
): SeriesEpisodeEntry | null {
  if (!episodes.length) return null
  const ordered = [...episodes].sort((a, b) => a.season - b.season || a.episodeNum - b.episodeNum)
  const currentIdx = ordered.findIndex((ep) => String(ep.id) === String(currentEpisodeId))
  const startIdx = currentIdx >= 0 ? currentIdx + 1 : 0

  for (let i = startIdx; i < ordered.length; i++) {
    const candidate = ordered[i]
    if (!isEpisodeCompleted(candidate.id)) {
      return candidate
    }
  }
  return null
}

/**
 * When an episode is marked as watched or finishes playing:
 * Automatically seeds the NEXT episode into "Continue Watching" with position: 0 and isNextUp: true.
 */
export async function promoteNextEpisodeOnCompleted(
  playlistId: string,
  episodeId: string | number,
  extras?: EpisodeExtras,
  knownEpisodesByKey?: Record<string, any[]> | null
): Promise<boolean> {
  if (!playlistId || episodeId == null) return false

  const existingProg = getProgress(playlistId, "episode", episodeId)
  const seriesId = extras?.seriesId ?? existingProg?.seriesId
  if (seriesId == null) return false

  let allEpisodes: SeriesEpisodeEntry[] = []

  // 1. If caller provided in-memory episodesByKey (e.g. from series/detail.ts)
  if (knownEpisodesByKey && typeof knownEpisodesByKey === "object") {
    for (const [seasonKey, eps] of Object.entries(knownEpisodesByKey)) {
      if (!Array.isArray(eps)) continue
      for (const ep of eps) {
        allEpisodes.push({
          season: Number(ep.season ?? seasonKey) || 1,
          episodeNum: Number(ep.episode_num) || 0,
          id: ep.id,
          containerExt: ep.container_extension || null,
          title: ep.title || null,
        })
      }
    }
  }

  // 2. Otherwise fetch or read cached series info
  if (!allEpisodes.length) {
    try {
      const data = await requestSeriesInfo(playlistId, seriesId)
      if (data) {
        allEpisodes = flattenSeriesEpisodes(data)
      }
    } catch (err) {
      log.warn("[xt:series-next] failed to load series info for next up:", err)
    }
  }

  if (!allEpisodes.length) return false

  const nextEp = findNextUnwatchedEpisode(allEpisodes, episodeId, (id) =>
    isCompleted(playlistId, "episode", id)
  )

  if (!nextEp) return false

  const nextExtras = {
    seriesId: Number(seriesId),
    season: nextEp.season,
    episodeNum: nextEp.episodeNum,
    episodeTitle: nextEp.title || `Episode ${nextEp.episodeNum}`,
    seriesName: extras?.seriesName || existingProg?.seriesName || "",
    seriesLogo: extras?.seriesLogo || existingProg?.seriesLogo || null,
    isNextUp: true,
  }

  setProgress(playlistId, "episode", nextEp.id, 0, 0, nextExtras)
  log.info(
    `[xt:series-next] Queued next episode in Continue Watching: S${nextEp.season}E${nextEp.episodeNum} (ID: ${nextEp.id})`
  )
  return true
}
