package handler

import (
	"net/http"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/service"
)

type Handler struct {
	userService *service.UserService
	roots       *files.Roots
}

// NewHandler builds a Handler. roots may be nil when the files API is not
// configured (e.g. user-CRUD-only tests); the files endpoints respond with
// 500 in that case.
func NewHandler(userService *service.UserService, roots *files.Roots) *Handler {
	return &Handler{userService: userService, roots: roots}
}

func (h *Handler) Routes(staticHandler http.Handler) http.Handler {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), corsMiddleware())

	r.GET("/health", h.Health)

	apiV1 := r.Group("/api/v1")
	{
		users := apiV1.Group("/users")
		users.GET("", h.ListUsers)
		users.POST("", h.CreateUser)
		users.GET("/:id", h.GetUser)
		users.PUT("/:id", h.UpdateUser)
		users.DELETE("/:id", h.DeleteUser)
	}

	// /api/files is intentionally outside /api/v1 because that's how the
	// parent issue (#1) specified the API surface.
	api := r.Group("/api")
	{
		api.GET("/help", h.Help)
		api.GET("/config", h.Config)
		api.GET("/dirs", h.ListDir)
		api.GET("/files", h.ListFiles)
		api.GET("/files/*path", h.ReadFile)
		api.PUT("/files/*path", h.WriteFile)
		api.GET("/stat/*path", h.StatFile)
		api.GET("/comments/*path", h.ListComments)
		api.POST("/comments/*path", h.CreateComment)
		api.PATCH("/comments/*path", h.UpdateComment)
		api.DELETE("/comments/*path", h.DeleteComment)
		api.POST("/replies/*path", h.AddReply)
		api.GET("/review/*path", h.ReviewMarkdown)
		api.POST("/ingest/*path", h.IngestFile)
		api.GET("/revisions/*path", h.Revisions)
	}

	r.NoRoute(gin.WrapH(staticHandler))

	return r
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ReviewRootJSON is the public shape returned in /api/config under
// `review_roots`. Kept as its own type so the JSON surface is explicit and
// doesn't drift if files.Root grows internal fields.
type ReviewRootJSON struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// Config exposes the configured roots so the UI can render the root-tab bar.
// The legacy `review_root_name` / `review_root` fields are kept and point at
// the default (first) root so older clients keep working.
func (h *Handler) Config(c *gin.Context) {
	if h.roots == nil {
		c.JSON(http.StatusOK, gin.H{
			"review_root_name": "",
			"review_root":      "",
			"review_roots":     []ReviewRootJSON{},
		})
		return
	}
	list := h.roots.List()
	out := make([]ReviewRootJSON, len(list))
	for i, root := range list {
		out[i] = ReviewRootJSON{Name: root.Name, Path: root.Resolver.Root()}
	}
	def, defName := h.roots.Default()
	defPath := ""
	if def != nil {
		defPath = def.Root()
	}
	legacyName := defName
	if legacyName == "" && defPath != "" {
		legacyName = filepath.Base(defPath)
	}
	c.JSON(http.StatusOK, gin.H{
		"review_root_name": legacyName,
		"review_root":      defPath,
		"review_roots":     out,
	})
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type")
		c.Header("Access-Control-Max-Age", "300")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
