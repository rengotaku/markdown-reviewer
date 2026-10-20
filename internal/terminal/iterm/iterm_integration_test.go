package iterm

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Opt in because this opens one temporary iTerm2 window. It records actual
// terminal input bytes without sending anything to an existing Claude session.
func TestWriteTextIntegration(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getenv("MR_ITERM_INTEGRATION") != "1" {
		t.Skip("set MR_ITERM_INTEGRATION=1 on macOS to verify real iTerm2 input")
	}
	dir := t.TempDir()
	receiver := filepath.Join(dir, "receiver.py")
	require.NoError(t, os.WriteFile(receiver, []byte(`import json, os, pathlib, signal, sys, termios, time, tty
root = pathlib.Path(sys.argv[1])
original = termios.tcgetattr(sys.stdin.fileno())
signal.alarm(10)
try:
    tty.setraw(sys.stdin.fileno())
    sys.stdout.write("\x1b[?2004h")
    sys.stdout.flush()
    (root / "ready").write_text(os.ttyname(sys.stdin.fileno()))
    received = bytearray()
    timestamps = []
    while True:
        value = os.read(sys.stdin.fileno(), 1)
        received.extend(value)
        timestamps.append(time.monotonic())
        if value == b"\r":
            break
    (root / "result").write_text(json.dumps({"hex": received.hex(), "gap": timestamps[-1] - timestamps[-2]}))
finally:
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, original)
`), 0600))
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	window, err := exec.CommandContext(ctx, "/usr/bin/osascript", "-e", `on run argv
tell application "iTerm2"
set w to create window with default profile command (item 1 of argv)
return id of w as text
end tell
end run`, "/usr/bin/python3 "+quote(receiver)+" "+quote(dir)).CombinedOutput()
	require.NoError(t, err, string(window))
	t.Cleanup(func() {
		_ = exec.Command("/usr/bin/osascript", "-e", `on run argv
tell application "iTerm2"
try
close window id (item 1 of argv as integer)
end try
end tell
end run`, strings.TrimSpace(string(window))).Run()
	})
	var terminal []byte
	require.Eventually(t, func() bool {
		terminal, err = os.ReadFile(filepath.Join(dir, "ready"))
		return err == nil
	}, 5*time.Second, 25*time.Millisecond)
	command := "mr comments '/tmp/mr-enter-check.md'"
	require.NoError(t, (Writer{}).WriteText(ctx, string(terminal), command))
	var raw []byte
	require.Eventually(t, func() bool {
		raw, err = os.ReadFile(filepath.Join(dir, "result"))
		return err == nil
	}, 5*time.Second, 25*time.Millisecond)
	var result struct {
		Hex string  `json:"hex"`
		Gap float64 `json:"gap"`
	}
	require.NoError(t, json.Unmarshal(raw, &result))
	bytes, err := hex.DecodeString(result.Hex)
	require.NoError(t, err)
	require.Equal(t, command+"\r", string(bytes), "submit must use CR, without an extra LF")
	require.GreaterOrEqual(t, result.Gap, 0.1, "submit must arrive separately from the pasted text")
}
