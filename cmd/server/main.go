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
	if len(os.Args) > 1 && os.Args[1] == "service" {
		if err := runService(os.Args[2:]); err != nil {
			slog.Error("service command failed", "error", err)
			os.Exit(1)
		}
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := server.Run(ctx); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
