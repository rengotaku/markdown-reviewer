// Package serverdefaults holds the defaults markdown-review-server applies to
// its environment variables, as plain constants.
//
// It exists so a caller that must reproduce a server default — the mr CLI,
// which builds web UI URLs without being able to ask the running server —
// shares one source of truth with internal/server instead of hard-coding a
// second copy. Keeping it a leaf package (no imports) also keeps the CLI from
// linking the server's dependency tree just to read a constant.
package serverdefaults

// Port is the port markdown-review-server listens on when PORT is unset.
//
// internal/server.Config declares the same value in an `env:"PORT,default=..."`
// struct tag; struct tags cannot reference constants, so the pair is kept in
// sync by TestConfigPortDefaultMatchesServerDefaults in internal/server.
const Port = "8080"
