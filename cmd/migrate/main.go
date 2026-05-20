package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/glebarez/sqlite"
	"github.com/sethvargo/go-envconfig"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"markdown-reviewer/internal/model"
)

type Config struct {
	DatabaseDSN string `env:"DATABASE_DSN,default=app.db"`
}

func main() {
	var cfg Config
	if err := envconfig.Process(context.Background(), &cfg); err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	db, err := gorm.Open(sqlite.Open(cfg.DatabaseDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}

	if err := db.AutoMigrate(&model.User{}); err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}

	slog.Info("migration completed", "dsn", cfg.DatabaseDSN)
}
