import {
  getProgress,
  isCompleted,
  setProgress,
  getFollowedSeriesWaitingForEpisodes,
  getSeriesEpisodeProgress,
} from "@/scripts/lib/preferences.js"
import { flattenSeriesEpisodes, type SeriesEpisodeEntry } from "@/scripts/lib/tv-cast-next.ts"
import { requestSeriesInfo } from "@/scripts/lib/series-seasons.ts"
import { xtreamApiFetch } from "@/scripts/lib/xtream-api.js"
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

/**
 * Checks a specific series payload (e.g. when fresh get_series_info data arrives).
 * If the user has watched this series and completed the last known episode, but was waiting
 * for new episodes (none was active), this checks if newly added episodes exist and promotes the first one.
 */
export function checkAndPromoteNewEpisodesForSeries(
  playlistId: string,
  seriesId: string | number,
  seriesInfoData: any
): boolean {
  if (!playlistId || seriesId == null || !seriesInfoData) return false
  const sid = Number(seriesId)
  if (!Number.isFinite(sid)) return false

  // Find if this series has progress and is waiting for new episodes
  const waitingList = getFollowedSeriesWaitingForEpisodes(playlistId)
  const target = waitingList.find((w) => w.seriesId === sid)
  if (!target) return false

  // All watched episodes were completed. Check if seriesInfoData has a new episode after lastEpisodeId!
  let allEpisodes: SeriesEpisodeEntry[] = []
  if (
    seriesInfoData?.episodes &&
    typeof seriesInfoData.episodes === "object" &&
    !Array.isArray(seriesInfoData.episodes)
  ) {
    for (const [seasonKey, eps] of Object.entries(seriesInfoData.episodes as Record<string, any[]>)) {
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
  } else {
    allEpisodes = flattenSeriesEpisodes(seriesInfoData)
  }

  if (!allEpisodes.length) return false

  const nextEp = findNextUnwatchedEpisode(allEpisodes, target.lastEpisodeId, (id) =>
    isCompleted(playlistId, "episode", id)
  )

  if (!nextEp) return false

  const nextExtras = {
    seriesId: sid,
    season: nextEp.season,
    episodeNum: nextEp.episodeNum,
    episodeTitle: nextEp.title || `Episode ${nextEp.episodeNum}`,
    seriesName: target.lastWatched?.seriesName || "",
    seriesLogo: target.lastWatched?.seriesLogo || null,
    isNextUp: true,
  }

  setProgress(playlistId, "episode", nextEp.id, 0, 0, nextExtras)
  log.info(
    `[xt:series-next] Detected new episode added for series ${sid}: S${nextEp.season}E${nextEp.episodeNum} (ID: ${nextEp.id})`
  )
  return true
}

const lastSeriesCheckTime = new Map<string, number>()
const CHECK_COOLDOWN_MS = 60 * 1000 // Check at most once a minute per playlist

/**
 * Inspects all series currently followed by the user where the user has completed all episodes.
 * Fetches updated series info in the background and promotes new episodes if any have been added.
 */
export async function checkForNewEpisodesInFollowedSeries(
  playlistId: string,
  force = false
): Promise<number> {
  if (!playlistId) return 0

  const now = Date.now()
  const lastCheck = lastSeriesCheckTime.get(playlistId) || 0
  if (!force && now - lastCheck < CHECK_COOLDOWN_MS) {
    return 0
  }
  lastSeriesCheckTime.set(playlistId, now)

  const seriesToCheck = getFollowedSeriesWaitingForEpisodes(playlistId)
  if (!seriesToCheck.length) return 0

  // Check up to the 8 most recently watched completed series
  const topToCheck = seriesToCheck.slice(0, 8)
  let newlyPromotedCount = 0

  for (const item of topToCheck) {
    try {
      const response = await xtreamApiFetch("get_series_info", {
        series_id: String(item.seriesId),
        series: String(item.seriesId),
      })
      if (!response.ok) continue
      const data = await response.json()
      if (checkAndPromoteNewEpisodesForSeries(playlistId, item.seriesId, data)) {
        newlyPromotedCount++
      }
    } catch {
      // Ignore background network errors
    }
  }

  return newlyPromotedCount
}
