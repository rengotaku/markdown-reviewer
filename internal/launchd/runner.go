package launchd

import "os/exec"

// Runner executes launchctl subcommands. It's an interface so
// install/uninstall/status flows are testable without touching the real
// launchd (see FakeRunner in runner_fake.go, used by service_test.go).
type Runner interface {
	// Bootout unloads the agent identified by target (e.g.
	// "gui/501/com.user.markdown-reviewer"). Returns an error if launchctl
	// exits non-zero; callers treat "not loaded" as a tolerable failure per
	// launchctl's own semantics.
	Bootout(target string) error
	// Bootstrap loads the plist at path into the given domain (e.g.
	// "gui/501").
	Bootstrap(domain, path string) error
	// Kickstart force-starts the agent identified by target.
	Kickstart(target string) error
	// Print returns launchctl's human-readable status dump for target, or an
	// error if the agent isn't currently loaded.
	Print(target string) (string, error)
}

// execRunner is the production Runner: it shells out to the real launchctl.
type execRunner struct{}

// NewRunner returns the production Runner backed by the system's launchctl.
func NewRunner() Runner {
	return execRunner{}
}

func (execRunner) Bootout(target string) error {
	return exec.Command("launchctl", "bootout", target).Run()
}

func (execRunner) Bootstrap(domain, path string) error {
	return exec.Command("launchctl", "bootstrap", domain, path).Run()
}

func (execRunner) Kickstart(target string) error {
	return exec.Command("launchctl", "kickstart", target).Run()
}

func (execRunner) Print(target string) (string, error) {
	out, err := exec.Command("launchctl", "print", target).Output()
	return string(out), err
}
