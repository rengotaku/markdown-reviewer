package repository_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/model"
	"markdown-reviewer/internal/repository"
	"markdown-reviewer/internal/testutil"
)

func TestUserRepository_Create(t *testing.T) {
	repo := repository.NewUserRepository(testutil.NewTestDB(t))

	user, err := repo.Create(&model.User{Name: "John Doe", Email: "john@example.com", PasswordHash: "x"})
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.NotEmpty(t, user.ID)
	assert.Equal(t, "John Doe", user.Name)
	assert.Equal(t, "john@example.com", user.Email)
	assert.False(t, user.CreatedAt.IsZero())
	assert.False(t, user.UpdatedAt.IsZero())
}

func TestUserRepository_FindAll(t *testing.T) {
	repo := repository.NewUserRepository(testutil.NewTestDB(t))

	users, err := repo.FindAll()
	require.NoError(t, err)
	assert.Empty(t, users)

	_, _ = repo.Create(&model.User{Name: "John", Email: "john@example.com", PasswordHash: "x"})
	_, _ = repo.Create(&model.User{Name: "Jane", Email: "jane@example.com", PasswordHash: "x"})

	users, err = repo.FindAll()
	require.NoError(t, err)
	assert.Len(t, users, 2)
}

func TestUserRepository_FindByID(t *testing.T) {
	repo := repository.NewUserRepository(testutil.NewTestDB(t))

	created, err := repo.Create(&model.User{Name: "John", Email: "john@example.com", PasswordHash: "x"})
	require.NoError(t, err)

	user, err := repo.FindByID(created.ID)
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, created.ID, user.ID)

	missing, err := repo.FindByID("non-existing-id")
	require.NoError(t, err)
	assert.Nil(t, missing)
}

func TestUserRepository_Update(t *testing.T) {
	repo := repository.NewUserRepository(testutil.NewTestDB(t))

	created, err := repo.Create(&model.User{Name: "John", Email: "john@example.com", PasswordHash: "x"})
	require.NoError(t, err)

	created.Name = "Jane"
	created.Email = "jane@example.com"
	updated, err := repo.Update(created)
	require.NoError(t, err)
	assert.Equal(t, "Jane", updated.Name)
	assert.Equal(t, "jane@example.com", updated.Email)
}

func TestUserRepository_Delete(t *testing.T) {
	repo := repository.NewUserRepository(testutil.NewTestDB(t))

	created, err := repo.Create(&model.User{Name: "John", Email: "john@example.com", PasswordHash: "x"})
	require.NoError(t, err)

	require.NoError(t, repo.Delete(created.ID))

	missing, err := repo.FindByID(created.ID)
	require.NoError(t, err)
	assert.Nil(t, missing)

	err = repo.Delete("non-existing-id")
	assert.ErrorIs(t, err, repository.ErrNotFound)
}
