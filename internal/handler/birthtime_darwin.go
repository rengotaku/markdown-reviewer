//go:build darwin

package handler

import (
	"os"
	"syscall"
	"time"
)

// fileBirthTime returns the file's birth (creation) time when the platform
// records one. On darwin (HFS+ / APFS) this is exposed via the kernel-level
// stat struct's Birthtimespec field.
func fileBirthTime(info os.FileInfo) (time.Time, bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return time.Time{}, false
	}
	bt := st.Birthtimespec
	if bt.Sec == 0 && bt.Nsec == 0 {
		return time.Time{}, false
	}
	return time.Unix(bt.Sec, bt.Nsec), true
}
