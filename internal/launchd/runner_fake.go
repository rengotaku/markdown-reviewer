package launchd

// FakeRunner is an in-memory Runner double for tests. It tracks the calls
// made to it and a simple loaded/not-loaded state per target so
// install/uninstall/status flows can be exercised without launchd.
//
// Bootstrap only receives (domain, path) — real launchctl derives the
// target from the plist's own Label key at load time. The fake mirrors
// that: it reads the plist file at path, extracts Label, and marks
// domain+"/"+Label as loaded. Tests that want Bootstrap to fail without a
// real plist file should set BootstrapErr instead.
type FakeRunner struct {
	// BootoutErr, BootstrapErr, KickstartErr, PrintErr let tests inject
	// failures for a specific call.
	BootoutErr   error
	BootstrapErr error
	KickstartErr error
	PrintErr     error
	// Loaded tracks which target keys (domain + "/" + label) are currently
	// "bootstrapped".
	Loaded map[string]bool
	// PrintOutput is returned by Print when the target is loaded.
	PrintOutput string
	// Calls records every method invocation, in order, as
	// "method:arg1:arg2" strings for assertions in tests.
	Calls []string
}

// NewFakeRunner returns a FakeRunner with no agents loaded.
func NewFakeRunner() *FakeRunner {
	return &FakeRunner{Loaded: make(map[string]bool)}
}

func (f *FakeRunner) Bootout(target string) error {
	f.Calls = append(f.Calls, "bootout:"+target)
	if f.BootoutErr != nil {
		return f.BootoutErr
	}
	if !f.Loaded[target] {
		return errNotLoaded
	}
	delete(f.Loaded, target)
	return nil
}

func (f *FakeRunner) Bootstrap(domain, path string) error {
	f.Calls = append(f.Calls, "bootstrap:"+domain+":"+path)
	if f.BootstrapErr != nil {
		return f.BootstrapErr
	}
	label, err := labelFromPlistFile(path)
	if err != nil {
		return err
	}
	f.Loaded[domain+"/"+label] = true
	return nil
}

func (f *FakeRunner) Kickstart(target string) error {
	f.Calls = append(f.Calls, "kickstart:"+target)
	return f.KickstartErr
}

func (f *FakeRunner) Print(target string) (string, error) {
	f.Calls = append(f.Calls, "print:"+target)
	if f.PrintErr != nil {
		return "", f.PrintErr
	}
	if !f.Loaded[target] {
		return "", errNotLoaded
	}
	return f.PrintOutput, nil
}
