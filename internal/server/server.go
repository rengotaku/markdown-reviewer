// Package server boots the API server.
//
// Run() is split out of cmd/server/main.go so the same lifecycle can be
// reused from a cobra subcommand: main() handles signal wiring, while Run()
// owns config loading, DB setup, HTTP listener, and graceful shutdown.
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/lmittmann/tint"
	"github.com/sethvargo/go-envconfig"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/handler"
	"markdown-reviewer/internal/model"
	"markdown-reviewer/internal/repository"
	"markdown-reviewer/internal/service"
	"markdown-reviewer/internal/static"
)

type Config struct {
	Port        string `env:"PORT,default=8080"`
	DatabaseDSN string `env:"DATABASE_DSN,default=app.db"`
	JWTSecret   string `env:"JWT_SECRET,default=change-me-in-production"`
	// ReviewRoots is a JSON array of {name, path} entries describing every
	// directory the /api/files endpoints will browse. Takes precedence over
	// the legacy single REVIEW_ROOT when both are set.
	//
	//   REVIEW_ROOTS='[{"name":"works","path":"/Users/x/ot/works"},{"name":"rooms","path":"/Users/x/ot/rooms"}]'
	ReviewRoots string `env:"REVIEW_ROOTS"`
	// ReviewRoot is the legacy single-directory env var, retained for
	// backward compatibility. When REVIEW_ROOTS is empty and this is set, a
	// single-root config is built using filepath.Base(REVIEW_ROOT) as the
	// tab name. Leave both empty to disable the files API entirely
	// (handlers respond with 500).
	ReviewRoot      string        `env:"REVIEW_ROOT"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT,default=10s"`
	JWTTTL          time.Duration `env:"JWT_TTL,default=24h"`
}

// Run boots the API server and blocks until ctx is canceled (graceful
// shutdown, returns nil) or the underlying http.Server returns a fatal
// error (returns that error).
//
// Resource ownership — logger / DB / HTTP server — is intentionally kept
// inside Run() so cobra integrations don't have to thread anything in:
//
//	RunE: func(cmd *cobra.Command, _ []string) error {
//	    return server.Run(cmd.Context())
//	}
func Run(ctx context.Context) error {
	setupLogger()

	var cfg Config
	if err := envconfig.Process(ctx, &cfg); err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	db, err := gorm.Open(sqlite.Open(cfg.DatabaseDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	if err = db.AutoMigrate(&model.User{}); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}

	if os.Getenv("APP_ENV") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	repo := repository.NewUserRepository(db)
	svc := service.NewUserService(repo)

	roots, err := buildRoots(cfg)
	if err != nil {
		return fmt.Errorf("init files roots: %w", err)
	}
	if roots != nil {
		for _, root := range roots.List() {
			slog.Info("files API enabled", "name", root.Name, "path", root.Resolver.Root())
		}
	} else {
		slog.Warn("neither REVIEW_ROOTS nor REVIEW_ROOT set; /api/files endpoints will return 500")
	}

	h := handler.NewHandler(svc, roots)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      h.Routes(static.Handler()),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// The server runs in a goroutine; its terminal state — either a real
	// error or http.ErrServerClosed after Shutdown — is funneled back
	// through errCh so the select below is the single decision point.
	errCh := make(chan error, 1)
	go func() {
		slog.Info("starting server", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
		slog.Info("shutting down server")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("server shutdown: %w", err)
		}
		// Drain the goroutine so the test (and any caller) can rely on
		// Run() not leaving a server-side goroutine alive after return.
		<-errCh
		slog.Info("server stopped")
		return nil
	case err := <-errCh:
		return err
	}
}

// buildRoots resolves the configured roots from cfg. REVIEW_ROOTS (JSON
// array) wins when present; REVIEW_ROOT is the single-root fallback. Both
// empty → (nil, nil) so the caller can disable the files API entirely.
func buildRoots(cfg Config) (*files.Roots, error) {
	if cfg.ReviewRoots != "" {
		specs, err := files.ParseRootsJSON(cfg.ReviewRoots)
		if err != nil {
			return nil, err
		}
		return files.NewRoots(specs)
	}
	if cfg.ReviewRoot == "" {
		return nil, nil
	}
	return files.NewRoots([]files.RootSpec{
		{Name: filepath.Base(cfg.ReviewRoot), Path: cfg.ReviewRoot},
	})
}

func setupLogger() {
	var logLevel slog.LevelVar
	if l := os.Getenv("LOG_LEVEL"); l != "" {
		_ = logLevel.UnmarshalText([]byte(l))
	}

	var logHandler slog.Handler
	if os.Getenv("APP_ENV") == "production" {
		logHandler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: &logLevel})
	} else {
		logHandler = tint.NewHandler(os.Stderr, &tint.Options{
			Level:      &logLevel,
			TimeFormat: time.Kitchen,
		})
	}
	slog.SetDefault(slog.New(logHandler))
}
