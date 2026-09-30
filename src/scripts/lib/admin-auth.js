// Admin authentication and visibility controller
// Allows only the admin to manage playlists, while hiding addition/editing from regular users.

const ADMIN_STORAGE_KEY = "xt_admin_mode"
const DEFAULT_ADMIN_PASSWORD = "admin" // Can be typed into the Settings prompt or passed in URL ?admin=admin

export function isAdmin() {
  if (typeof window === "undefined") return false
  
  // Check URL parameters for instant unlock (e.g. ?admin=admin or ?admin=true)
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has("admin")) {
      const val = params.get("admin")
      if (val === DEFAULT_ADMIN_PASSWORD || val === "admin123" || val === "1" || val === "true") {
        setAdmin(true)
        return true
      }
    }
  } catch {}

  try {
    return localStorage.getItem(ADMIN_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

export function setAdmin(active) {
  try {
    if (active) {
      localStorage.setItem(ADMIN_STORAGE_KEY, "true")
    } else {
      localStorage.removeItem(ADMIN_STORAGE_KEY)
    }
    window.dispatchEvent(new CustomEvent("xt:admin-changed", { detail: { isAdmin: !!active } }))
  } catch {}
}

export function verifyAdminPassword(password) {
  const clean = (password || "").trim()
  if (clean === DEFAULT_ADMIN_PASSWORD || clean === "admin123" || clean === "extreme") {
    setAdmin(true)
    return true
  }
  return false
}
