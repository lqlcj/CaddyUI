package store

import (
	"path/filepath"
	"testing"
)

func TestFailedVersionsPreserveVisibleRollback(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	good, err := s.AddConfigVersion("good", true, "initial", "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 80; i++ {
		if _, err := s.AddConfigVersion("bad", false, "retry", "rejected"); err != nil {
			t.Fatal(err)
		}
	}
	last, err := s.LastGoodConfig()
	if err != nil || last.ID != good {
		t.Fatalf("last good: %v, %v", last, err)
	}
	for _, limit := range []int{1, 30, 50} {
		versions, err := s.ConfigVersions(limit)
		if err != nil {
			t.Fatal(err)
		}
		if len(versions) != limit+1 || versions[len(versions)-1].ID != good {
			t.Fatalf("limit %d did not include the retained rollback", limit)
		}
		seen := map[int64]bool{}
		for _, v := range versions {
			if seen[v.ID] {
				t.Fatal("duplicate history entry")
			}
			seen[v.ID] = true
		}
	}
	newGood, err := s.AddConfigVersion("new good", true, "fixed", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfigVersionByID(good); err != ErrNotFound {
		t.Fatalf("obsolete good snapshot retained: %v", err)
	}
	versions, err := s.ConfigVersions(30)
	if err != nil || len(versions) != 30 || versions[0].ID != newGood {
		t.Fatalf("recent success: %v, %v", versions, err)
	}
}
