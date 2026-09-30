// Shared / Default Playlist Manager
import defaultPlaylistConfig from "@/config/default-playlist.json"

const DEFAULT_PLAYLIST_KEY = "xt_default_playlist"
const DEFAULT_PLAYLIST_ID = "default-project-playlist"

export function getDefaultPlaylistConfig() {
  return defaultPlaylistConfig || { enabled: false }
}

export function isDefaultPlaylistEnabled() {
  if (
    (typeof process !== "undefined" && process.env?.NODE_ENV === "test") ||
    (typeof import.meta !== "undefined" && import.meta.env?.MODE === "test") ||
    (typeof navigator !== "undefined" && navigator.webdriver)
  ) {
    return false
  }
  return !!(
    defaultPlaylistConfig &&
    defaultPlaylistConfig.enabled &&
    defaultPlaylistConfig.entry
  )
}

export function isDefaultPlaylistLocked() {
  return !!(
    isDefaultPlaylistEnabled() &&
    defaultPlaylistConfig.lockToDefault === true
  )
}

export function getDefaultPlaylistVersion() {
  return defaultPlaylistConfig?.version || 1
}

export function getDefaultPlaylist() {
  if (!isDefaultPlaylistEnabled()) return null

  const rawEntry = defaultPlaylistConfig.entry
  if (!rawEntry || typeof rawEntry !== "object") return null

  // Ensure normalized entry object
  const normalized = {
    _id: DEFAULT_PLAYLIST_ID,
    addedAt: 0,
    ...rawEntry,
  }

  if (normalized.type === "xtream") {
    normalized.serverUrl = (normalized.serverUrl || "").replace(/\/+$/, "")
  } else if (normalized.type === "m3u") {
    normalized.url = (normalized.url || "").trim()
  }

  return normalized
}

export function saveDefaultPlaylist(entry) {
  try {
    if (!entry) {
      localStorage.removeItem(DEFAULT_PLAYLIST_KEY)
    } else {
      localStorage.setItem(DEFAULT_PLAYLIST_KEY, JSON.stringify(entry))
    }
    return true
  } catch {
    return false
  }
}
