//go:build ignore

package main

import (
	"fmt"
	"os"

	"ariga.io/atlas-provider-gorm/gormschema"

	"markdown-reviewer/internal/model"
)

func main() {
	stmts, err := gormschema.New("sqlite").Load(&model.User{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load gorm schema: %v\n", err)
		os.Exit(1)
	}
	fmt.Print(stmts)
}
