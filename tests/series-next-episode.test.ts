import { describe, it, expect, beforeEach } from "vitest"
import {
  findNextUnwatchedEpisode,
  promoteNextEpisodeOnCompleted,
} from "@/scripts/lib/series-next-episode.ts"
import {
  setProgress,
  markCompleted,
  getContinueWatching,
  clearProgress,
  getProgress,
} from "@/scripts/lib/preferences.js"

describe("Series next episode promotion & Continue Watching", () => {
  const playlistId = "test-playlist-series-next"
  const episodes = [
    { season: 1, episodeNum: 1, id: 101, title: "Pilot" },
    { season: 1, episodeNum: 2, id: 102, title: "Episode 2" },
    { season: 1, episodeNum: 3, id: 103, title: "Episode 3" },
    { season: 2, episodeNum: 1, id: 201, title: "Season 2 Premiere" },
  ]

  it("findNextUnwatchedEpisode finds the subsequent episode", () => {
    const completedMap = new Set([101])
    const next = findNextUnwatchedEpisode(episodes, 101, (id) => completedMap.has(Number(id)))
    expect(next?.id).toBe(102)
    expect(next?.episodeNum).toBe(2)
  })

  it("findNextUnwatchedEpisode skips already completed episodes", () => {
    const completedMap = new Set([101, 102])
    const next = findNextUnwatchedEpisode(episodes, 101, (id) => completedMap.has(Number(id)))
    expect(next?.id).toBe(103)
    expect(next?.episodeNum).toBe(3)
  })

  it("findNextUnwatchedEpisode crosses into the next season if current season is complete", () => {
    const completedMap = new Set([101, 102, 103])
    const next = findNextUnwatchedEpisode(episodes, 103, (id) => completedMap.has(Number(id)))
    expect(next?.id).toBe(201)
    expect(next?.season).toBe(2)
    expect(next?.episodeNum).toBe(1)
  })

  it("promoteNextEpisodeOnCompleted seeds next episode into Continue Watching", async () => {
    const knownByKey = {
      "1": [
        { id: 101, season: 1, episode_num: 1, title: "Pilot" },
        { id: 102, season: 1, episode_num: 2, title: "Episode 2" },
      ],
    }

    markCompleted(playlistId, "episode", 101, {
      seriesId: 999,
      seriesName: "Breaking Code",
      season: 1,
      episodeNum: 1,
    })

    const promoted = await promoteNextEpisodeOnCompleted(
      playlistId,
      101,
      { seriesId: 999, seriesName: "Breaking Code" },
      knownByKey
    )

    expect(promoted).toBe(true)

    // Check progress entry for episode 102
    const ep2Prog = getProgress(playlistId, "episode", 102)
    expect(ep2Prog).toBeTruthy()
    expect(ep2Prog?.isNextUp).toBe(true)
    expect(ep2Prog?.position).toBe(0)

    // Check getContinueWatching: ep1 is completed so it shouldn't show; ep2 should show!
    const cw = getContinueWatching(playlistId, 10)
    const seriesItems = cw.filter((i) => i.seriesId === 999)
    expect(seriesItems.length).toBe(1)
    expect(seriesItems[0].id).toBe("102")
    expect(seriesItems[0].isNextUp).toBe(true)
  })
})
