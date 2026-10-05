package store

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestOnlyOneInitialAdministratorAcrossConnections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "panel.db")
	first, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i, db := range []*Store{first, second} {
		wg.Add(1)
		go func(i int, db *Store) {
			defer wg.Done()
			_, err := db.CreateUser([]string{"owner@example.com", "other@example.com"}[i], "TestPassword123!")
			results <- err
		}(i, db)
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrAlreadyInitialized) {
			t.Fatal(err)
		}
	}
	if successes != 1 || first.UserCount() != 1 {
		t.Fatalf("successes=%d users=%d", successes, first.UserCount())
	}
}

func TestPasswordAndSessionRevocationAreAtomic(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	user, err := db.CreateUser("owner@example.com", "OriginalPassword123!")
	if err != nil {
		t.Fatal(err)
	}
	session, err := db.CreateSession(user.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate storage failure during session revocation.
	if _, err := db.db.Exec("CREATE TRIGGER deny_revoke BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'blocked'); END"); err != nil {
		t.Fatal(err)
	}
	if err := db.ChangePassword(user.ID, "OriginalPassword123!", "NewPassword123!"); err == nil {
		t.Fatal("reported success despite failed revocation")
	}
	if _, err := db.Authenticate(user.Username, "OriginalPassword123!"); err != nil {
		t.Fatal("password changed despite transaction rollback", err)
	}
	if _, err := db.db.Exec("DROP TRIGGER deny_revoke"); err != nil {
		t.Fatal(err)
	}
	if err := db.ChangePassword(user.ID, "OriginalPassword123!", "NewPassword123!"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.LookupSession(session.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old session survived: %v", err)
	}
	if _, err := db.Authenticate(user.Username, "OriginalPassword123!"); !errors.Is(err, ErrBadCredentials) {
		t.Fatal("old password survived", err)
	}
}

func TestUserCountFailsClosed(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if db.UserCount() == 0 {
		t.Fatal("database failure reopened setup")
	}
}
