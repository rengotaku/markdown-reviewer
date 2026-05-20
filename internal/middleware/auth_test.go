package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/middleware"
)

const testSecret = "test-secret"

func init() {
	gin.SetMode(gin.TestMode)
}

func newAuthRouter() *gin.Engine {
	r := gin.New()
	r.GET("/private", middleware.RequireAuth(testSecret), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"user_id": c.GetString(middleware.ContextUserIDKey)})
	})
	return r
}

func doRequest(r http.Handler, header string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/private", nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestGenerateToken(t *testing.T) {
	token, err := middleware.GenerateToken("user-123", testSecret, time.Hour)
	require.NoError(t, err)
	assert.NotEmpty(t, token)
}

func TestRequireAuth(t *testing.T) {
	r := newAuthRouter()

	t.Run("valid token", func(t *testing.T) {
		token, _ := middleware.GenerateToken("user-abc", testSecret, time.Hour)
		rec := doRequest(r, "Bearer "+token)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "user-abc")
	})

	t.Run("missing header", func(t *testing.T) {
		rec := doRequest(r, "")
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("invalid format", func(t *testing.T) {
		rec := doRequest(r, "Token abc123")
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("expired token", func(t *testing.T) {
		token, _ := middleware.GenerateToken("user-abc", testSecret, -time.Hour)
		rec := doRequest(r, "Bearer "+token)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("wrong secret", func(t *testing.T) {
		token, _ := middleware.GenerateToken("user-abc", "other-secret", time.Hour)
		rec := doRequest(r, "Bearer "+token)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})
}
