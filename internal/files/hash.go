package files

import (
	"crypto/sha256"
	"encoding/hex"
)

// Sha256Hex returns the lowercase hex-encoded sha256 digest of data. This is
// the single place the "sha" surfaced on FileStatResponse / FileReadResponse
// / events.Event is computed, so every caller hashes file content the exact
// same way (issue #119: mtime alone can't detect a same-second double-save,
// but the content hash always changes when the bytes do).
func Sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
