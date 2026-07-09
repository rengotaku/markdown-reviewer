package main

import (
	"flag"
	"fmt"
	"os"

	"markdown-reviewer/internal/launchd"
)

// runService dispatches the "service install/uninstall/status" subcommands
// to internal/launchd. It's the only thing main.go delegates to for the
// service subcommand; all the actual logic (plist rendering, launchctl
// invocation, validation) lives in internal/launchd so it's unit-testable
// without touching the real launchd.
func runService(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: %s service <install|uninstall|status> [flags]", os.Args[0])
	}

	action, rest := args[0], args[1:]
	runner := launchd.NewRunner()

	switch action {
	case "install":
		fs := flag.NewFlagSet("service install", flag.ContinueOnError)
		port := fs.String("port", "", "PORT to run the server on (default: "+launchd.DefaultPort+")")
		reviewRoots := fs.String("review-roots", "", "REVIEW_ROOTS JSON array (falls back to the REVIEW_ROOTS env var)")
		reviewRoot := fs.String("review-root", "", "REVIEW_ROOT single directory (falls back to the REVIEW_ROOT env var)")
		label := fs.String("label", "", "launchd agent label (default: "+launchd.DefaultLabel+")")
		var root launchd.RootFlag
		fs.Var(&root, "root", "review root as [name=]path (repeatable, e.g. --root notes=~/notes)")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		rootJSON, err := root.JSON()
		if err != nil {
			return err
		}
		if rootJSON != "" && (*reviewRoots != "" || *reviewRoot != "") {
			return fmt.Errorf("--root cannot be combined with --review-roots/--review-root")
		}
		opts := launchd.Options{
			Label:       *label,
			Port:        *port,
			ReviewRoots: *reviewRoots,
			ReviewRoot:  *reviewRoot,
		}
		if rootJSON != "" {
			opts.ReviewRoots = rootJSON
		}
		return launchd.Install(opts, os.Args[0], runner, os.Stdout)

	case "uninstall":
		fs := flag.NewFlagSet("service uninstall", flag.ContinueOnError)
		label := fs.String("label", "", "launchd agent label (default: "+launchd.DefaultLabel+")")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		return launchd.Uninstall(*label, runner, os.Stdout)

	case "status":
		fs := flag.NewFlagSet("service status", flag.ContinueOnError)
		label := fs.String("label", "", "launchd agent label (default: "+launchd.DefaultLabel+")")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		return launchd.Status(*label, runner, os.Stdout)

	default:
		return fmt.Errorf("unknown service subcommand %q (want install, uninstall, or status)", action)
	}
}
