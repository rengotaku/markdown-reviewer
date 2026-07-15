package handler

// Package-internal test for statReadFileError so the ErrNotExist→404
// classification used by StatFile's post-Stat os.ReadFile call can be
// verified directly, without needing to reproduce the actual Stat/ReadFile
// delete race (a window a few nanoseconds wide that a test can't reliably
// hit by timing alone).

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestStatReadFileError_NotExist_Returns404(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	// A real StatFile call gets exactly this wrapped error shape from
	// os.ReadFile when the file vanished between its earlier os.Stat and
	// this read (a delete racing the request).
	_, statErr := os.Stat("/nonexistent/path/for/test/does-not-exist.md")

	statReadFileError(c, statErr)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestStatReadFileError_OtherError_Returns500(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	statReadFileError(c, errors.New("some unrelated read failure"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
}
