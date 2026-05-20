package model_test

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"markdown-reviewer/internal/model"
)

func TestUser_BeforeCreate_AssignsUUID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))

	u := &model.User{Name: "John", Email: "john@example.com", PasswordHash: "x"}
	require.NoError(t, db.Create(u).Error)
	assert.NotEmpty(t, u.ID)
}

func TestUser_BeforeCreate_PreservesExistingID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))

	u := &model.User{ID: "fixed-id", Name: "Jane", Email: "jane@example.com", PasswordHash: "x"}
	require.NoError(t, db.Create(u).Error)
	assert.Equal(t, "fixed-id", u.ID)
}
