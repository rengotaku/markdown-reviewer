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
	resolver    *files.Resolver
}

// NewHandler builds a Handler. resolver may be nil when the files API is
// not configured (e.g. user-CRUD-only tests); the files endpoints respond
// with 500 in that case.
func NewHandler(userService *service.UserService, resolver *files.Resolver) *Handler {
	return &Handler{userService: userService, resolver: resolver}
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
		api.GET("/config", h.Config)
		api.GET("/dirs", h.ListDir)
		api.GET("/files", h.ListFiles)
		api.GET("/files/*path", h.ReadFile)
		api.PUT("/files/*path", h.WriteFile)
	}

	r.NoRoute(gin.WrapH(staticHandler))

	return r
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Config exposes the basename of REVIEW_ROOT for the sidebar header label,
// plus the absolute path so the UI can build a clipboard-friendly full path
// for "copy path" actions.
func (h *Handler) Config(c *gin.Context) {
	if h.resolver == nil {
		c.JSON(http.StatusOK, gin.H{
			"review_root_name": "",
			"review_root":      "",
		})
		return
	}
	root := h.resolver.Root()
	c.JSON(http.StatusOK, gin.H{
		"review_root_name": filepath.Base(root),
		"review_root":      root,
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
