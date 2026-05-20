//go:build dev

package static

import "net/http"

// Dev mode: Vite serves the frontend on its own port; Go only handles /api/*,
// so the static fallback is intentionally a 404.
func Handler() http.Handler {
	return http.NotFoundHandler()
}
