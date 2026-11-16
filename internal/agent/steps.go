package agent

import (
	"context"
	"sync"
	"time"
)

// steps records how long each part of one send took (#402), so the log line
// for a slow send says where the time went. Adapters mark their own parts
// through the context with TimeStep; the selector never needs to know them.
type steps struct {
	items []step
	mu    sync.Mutex
}

type step struct {
	name string
	took time.Duration
}

type stepsKey struct{}

func withSteps(ctx context.Context) (context.Context, *steps) {
	s := &steps{}
	return context.WithValue(ctx, stepsKey{}, s), s
}

// TimeStep starts timing the named part of a send and returns the function
// that ends it. With a context that carries no recorder it records nothing,
// so adapters can call it unconditionally.
func TimeStep(ctx context.Context, name string) func() {
	s, _ := ctx.Value(stepsKey{}).(*steps)
	if s == nil {
		return func() {}
	}
	start := time.Now()
	return func() { s.add(name, time.Since(start)) }
}

func (s *steps) add(name string, took time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, step{name: name, took: took})
}

// attrs returns the recorded parts as slog key-value pairs, "<name>_ms", in
// the order they ended.
func (s *steps) attrs() []any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]any, 0, 2*len(s.items))
	for _, it := range s.items {
		out = append(out, it.name+"_ms", it.took.Milliseconds())
	}
	return out
}
