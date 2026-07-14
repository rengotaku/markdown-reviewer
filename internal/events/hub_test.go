package events_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/events"
)

func TestHub_SubscribeReceivesBroadcast(t *testing.T) {
	t.Parallel()
	hub := events.NewHub()

	ch, unsubscribe := hub.Subscribe()
	defer unsubscribe()
	require.Equal(t, 1, hub.SubscriberCount())

	want := events.Event{Kind: events.KindTree, Root: "works", Path: "a.md", Mtime: "2026-05-20T00:00:00Z"}
	hub.Broadcast(want)

	select {
	case got := <-ch:
		assert.Equal(t, want, got)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast")
	}
}

func TestHub_MultipleSubscribersAllReceive(t *testing.T) {
	t.Parallel()
	hub := events.NewHub()

	ch1, unsub1 := hub.Subscribe()
	defer unsub1()
	ch2, unsub2 := hub.Subscribe()
	defer unsub2()
	require.Equal(t, 2, hub.SubscriberCount())

	want := events.Event{Kind: events.KindComments, Root: "works", Path: "b.md"}
	hub.Broadcast(want)

	for _, ch := range []<-chan events.Event{ch1, ch2} {
		select {
		case got := <-ch:
			assert.Equal(t, want, got)
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for broadcast")
		}
	}
}

func TestHub_UnsubscribeStopsDelivery(t *testing.T) {
	t.Parallel()
	hub := events.NewHub()

	ch, unsubscribe := hub.Subscribe()
	unsubscribe()
	assert.Equal(t, 0, hub.SubscriberCount())

	// The channel is closed on unsubscribe, so a receive must return the
	// zero value with ok=false rather than block.
	select {
	case v, ok := <-ch:
		assert.False(t, ok)
		assert.Equal(t, events.Event{}, v)
	case <-time.After(time.Second):
		t.Fatal("channel was not closed on unsubscribe")
	}

	// Broadcasting after unsubscribe must not panic (no send on closed chan).
	assert.NotPanics(t, func() {
		hub.Broadcast(events.Event{Kind: events.KindFile, Root: "works", Path: "c.md"})
	})
}

func TestHub_SlowSubscriberDropsInsteadOfBlocking(t *testing.T) {
	t.Parallel()
	hub := events.NewHub()

	slow, unsubSlow := hub.Subscribe()
	defer unsubSlow()
	fast, unsubFast := hub.Subscribe()
	defer unsubFast()

	// Flood well past the internal buffer without draining `slow` so its
	// buffer fills; `fast` must still receive its own broadcasts promptly.
	for i := 0; i < 200; i++ {
		hub.Broadcast(events.Event{Kind: events.KindTree, Root: "works", Path: "flood.md"})
	}

	select {
	case <-fast:
	case <-time.After(time.Second):
		t.Fatal("fast subscriber was blocked by a slow one")
	}

	// Drain slow without asserting count — the point is only that Broadcast
	// above did not block/panic despite the full buffer.
	drained := 0
	for {
		select {
		case <-slow:
			drained++
		default:
			assert.Greater(t, drained, 0)
			return
		}
	}
}

func TestEvent_Marshal(t *testing.T) {
	t.Parallel()
	ev := events.Event{Kind: events.KindFile, Root: "works", Path: "a.md", Mtime: "2026-05-20T00:00:00Z"}
	data, err := ev.Marshal()
	require.NoError(t, err)
	assert.JSONEq(t, `{"kind":"file","root":"works","path":"a.md","mtime":"2026-05-20T00:00:00Z"}`, string(data))
}
