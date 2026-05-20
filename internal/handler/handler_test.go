package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/handler"
	"markdown-reviewer/internal/model"
	"markdown-reviewer/internal/repository"
	"markdown-reviewer/internal/service"
	"markdown-reviewer/internal/testutil"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestHandler(t *testing.T) *handler.Handler {
	t.Helper()
	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	return handler.NewHandler(svc, nil)
}

func serve(h *handler.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.Routes(http.NotFoundHandler()).ServeHTTP(rec, req)
	return rec
}

func TestHandler_Health(t *testing.T) {
	h := setupTestHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/health", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp map[string]string
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "ok", resp["status"])
}

func TestHandler_CreateUser(t *testing.T) {
	h := setupTestHandler(t)

	body := `{"name": "John Doe", "email": "john@example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusCreated, rec.Code)

	var user model.User
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&user))
	assert.Equal(t, "John Doe", user.Name)
	assert.NotEmpty(t, user.ID)
}

func TestHandler_CreateUser_InvalidBody(t *testing.T) {
	h := setupTestHandler(t)

	body := `{"name": "", "email": "invalid"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandler_CreateUser_InvalidJSON(t *testing.T) {
	h := setupTestHandler(t)

	body := `{invalid json}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandler_GetUser(t *testing.T) {
	h := setupTestHandler(t)

	createBody := `{"name": "John", "email": "john@example.com"}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewBufferString(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := serve(h, createReq)
	var created model.User
	require.NoError(t, json.NewDecoder(createRec.Body).Decode(&created))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/v1/users/"+created.ID, nil))
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestHandler_GetUser_NotFound(t *testing.T) {
	h := setupTestHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/v1/users/non-existing-id", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandler_ListUsers(t *testing.T) {
	h := setupTestHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/v1/users", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var users []model.User
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&users))
	assert.Empty(t, users)
}

func TestHandler_UpdateUser(t *testing.T) {
	h := setupTestHandler(t)

	createBody := `{"name": "John", "email": "john@example.com"}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewBufferString(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := serve(h, createReq)
	var created model.User
	require.NoError(t, json.NewDecoder(createRec.Body).Decode(&created))

	updateBody := `{"name": "Jane", "email": "jane@example.com"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/"+created.ID, bytes.NewBufferString(updateBody))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var updated model.User
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&updated))
	assert.Equal(t, "Jane", updated.Name)
}

func TestHandler_UpdateUser_NotFound(t *testing.T) {
	h := setupTestHandler(t)

	body := `{"name": "Jane", "email": "jane@example.com"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/non-existing-id", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandler_UpdateUser_InvalidBody(t *testing.T) {
	h := setupTestHandler(t)

	createBody := `{"name": "John", "email": "john@example.com"}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewBufferString(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := serve(h, createReq)
	var created model.User
	require.NoError(t, json.NewDecoder(createRec.Body).Decode(&created))

	updateBody := `{"name": "", "email": "invalid"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/"+created.ID, bytes.NewBufferString(updateBody))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandler_UpdateUser_InvalidJSON(t *testing.T) {
	h := setupTestHandler(t)

	body := `{invalid json}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/some-id", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandler_DeleteUser(t *testing.T) {
	h := setupTestHandler(t)

	createBody := `{"name": "John", "email": "john@example.com"}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewBufferString(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := serve(h, createReq)
	var created model.User
	require.NoError(t, json.NewDecoder(createRec.Body).Decode(&created))

	rec := serve(h, httptest.NewRequest(http.MethodDelete, "/api/v1/users/"+created.ID, nil))
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestHandler_DeleteUser_NotFound(t *testing.T) {
	h := setupTestHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodDelete, "/api/v1/users/non-existing-id", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandler_StaticFallback(t *testing.T) {
	h := setupTestHandler(t)

	stubBody := "stub-spa-content"
	stubHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(stubBody))
	})

	req := httptest.NewRequest(http.MethodGet, "/some/spa/route", nil)
	rec := httptest.NewRecorder()
	h.Routes(stubHandler).ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, stubBody, rec.Body.String())
}
