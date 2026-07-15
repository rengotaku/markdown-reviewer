package files_test

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"

	"markdown-reviewer/internal/files"
)

func TestSha256Hex_MatchesStdlibDigest(t *testing.T) {
	t.Parallel()
	data := []byte("# hello\nsome markdown content\n")

	sum := sha256.Sum256(data)
	want := hex.EncodeToString(sum[:])

	assert.Equal(t, want, files.Sha256Hex(data))
	assert.Len(t, files.Sha256Hex(data), 64)
}

func TestSha256Hex_DifferentContentDifferentHash(t *testing.T) {
	t.Parallel()
	assert.NotEqual(t, files.Sha256Hex([]byte("a")), files.Sha256Hex([]byte("b")))
}

func TestSha256Hex_EmptyInput(t *testing.T) {
	t.Parallel()
	// Well-known sha256 of the empty string.
	assert.Equal(t, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", files.Sha256Hex(nil))
}
