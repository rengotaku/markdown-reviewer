package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/repository"
	"markdown-reviewer/internal/service"
	"markdown-reviewer/internal/testutil"
)

func newService(t *testing.T) *service.UserService {
	t.Helper()
	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	return service.NewUserService(repo)
}

func TestUserService_CreateUser(t *testing.T) {
	tests := []struct {
		name    string
		uname   string
		email   string
		wantErr bool
	}{
		{"valid user", "John Doe", "john@example.com", false},
		{"empty name", "", "john@example.com", true},
		{"invalid email", "John Doe", "invalid", true},
		{"empty email", "John Doe", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := newService(t)
			user, err := svc.CreateUser(tt.uname, tt.email)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, user)
			assert.Equal(t, tt.uname, user.Name)
		})
	}
}

func TestUserService_GetUser(t *testing.T) {
	svc := newService(t)
	created, err := svc.CreateUser("John Doe", "john@example.com")
	require.NoError(t, err)

	user, err := svc.GetUser(created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, user.ID)

	_, err = svc.GetUser("non-existing-id")
	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestUserService_UpdateUser(t *testing.T) {
	svc := newService(t)
	created, err := svc.CreateUser("John Doe", "john@example.com")
	require.NoError(t, err)

	updated, err := svc.UpdateUser(created.ID, "Jane Doe", "jane@example.com")
	require.NoError(t, err)
	assert.Equal(t, "Jane Doe", updated.Name)

	_, err = svc.UpdateUser("non-existing-id", "Jane Doe", "jane@example.com")
	assert.ErrorIs(t, err, service.ErrUserNotFound)

	_, err = svc.UpdateUser(created.ID, "Jane Doe", "invalid")
	require.Error(t, err)
	assert.ErrorIs(t, err, service.ErrValidation)
}

func TestUserService_DeleteUser(t *testing.T) {
	svc := newService(t)
	created, err := svc.CreateUser("John Doe", "john@example.com")
	require.NoError(t, err)

	require.NoError(t, svc.DeleteUser(created.ID))

	err = svc.DeleteUser("non-existing-id")
	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestUserService_ListUsers(t *testing.T) {
	svc := newService(t)

	users, err := svc.ListUsers()
	require.NoError(t, err)
	assert.Empty(t, users)

	_, _ = svc.CreateUser("John Doe", "john@example.com")
	_, _ = svc.CreateUser("Jane Doe", "jane@example.com")

	users, err = svc.ListUsers()
	require.NoError(t, err)
	assert.Len(t, users, 2)
}
