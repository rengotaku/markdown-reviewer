package static

import (
	"io/fs"
	"net/http"
)

// SPA history routing: any path not present in fsys falls back to index.html
// so client-side routes like /users/42 work on a hard refresh.
func handlerForFS(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleaned := r.URL.Path
		if len(cleaned) > 0 && cleaned[0] == '/' {
			cleaned = cleaned[1:]
		}
		if cleaned == "" {
			cleaned = "index.html"
		}
		if _, err := fs.Stat(fsys, cleaned); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
