// Package iterm submits terminal input through iTerm2 AppleScript.
package iterm

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type Writer struct{}

// Values are argv data, never interpolated into AppleScript source. No shell
// invocation, clipboard access, session activation, or new terminal is needed.
const sendScript = `on run argv
 if application "iTerm2" is not running then return "missing"
 tell application "iTerm2"
  repeat with w in windows
   repeat with t in tabs of w
    repeat with s in sessions of t
     if tty of s is item 1 of argv then
      tell s
       write text (item 2 of argv) newline NO
       delay 0.2
       write text (ASCII character 13) newline NO
      end tell
      return "sent"
     end if
    end repeat
   end repeat
  end repeat
 end tell
 return "missing"
end run`

func (Writer) WriteText(ctx context.Context, tty, command string) error {
	if runtime.GOOS != "darwin" {
		return errors.New("unsupported platform")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	raw, err := exec.CommandContext(ctx, "/usr/bin/osascript", "-e", sendScript, tty, command).Output()
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(raw)) != "sent" {
		return errors.New("terminal not found")
	}
	return nil
}
