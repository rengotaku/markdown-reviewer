//go:build !darwin

package handler

import (
	"os"
	"time"
)

// fileBirthTime returns no birth time on platforms where the stat struct
// doesn't expose one (most Linux filesystems via the standard stat(2)
// syscall). Callers must treat the zero return as "creation time unknown".
func fileBirthTime(_ os.FileInfo) (time.Time, bool) {
	return time.Time{}, false
}
