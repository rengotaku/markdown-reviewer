package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"markdown-reviewer/internal/server"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := server.Run(ctx); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
