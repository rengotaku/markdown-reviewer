package service

import (
	"errors"
	"fmt"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/go-ozzo/ozzo-validation/v4/is"

	"markdown-reviewer/internal/model"
	"markdown-reviewer/internal/repository"
)

var (
	ErrUserNotFound = errors.New("user not found")
	ErrValidation   = errors.New("validation error")
)

type UserService struct {
	repo *repository.UserRepository
}

func NewUserService(repo *repository.UserRepository) *UserService {
	return &UserService{repo: repo}
}

func (s *UserService) ListUsers() ([]*model.User, error) {
	return s.repo.FindAll()
}

func (s *UserService) GetUser(id string) (*model.User, error) {
	user, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}
	return user, nil
}

func (s *UserService) CreateUser(name, email string) (*model.User, error) {
	if err := s.validateUser(name, email); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	return s.repo.Create(&model.User{Name: name, Email: email, PasswordHash: ""})
}

func (s *UserService) UpdateUser(id, name, email string) (*model.User, error) {
	if err := s.validateUser(name, email); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrValidation, err)
	}

	user, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}
	user.Name = name
	user.Email = email
	return s.repo.Update(user)
}

func (s *UserService) DeleteUser(id string) error {
	err := s.repo.Delete(id)
	if errors.Is(err, repository.ErrNotFound) {
		return ErrUserNotFound
	}
	return err
}

func (s *UserService) validateUser(name, email string) error {
	return validation.Errors{
		"name":  validation.Validate(name, validation.Required, validation.Length(1, 100)),
		"email": validation.Validate(email, validation.Required, is.Email),
	}.Filter()
}
